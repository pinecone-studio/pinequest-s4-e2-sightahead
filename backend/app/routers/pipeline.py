"""Synchronous dub pipeline: YouTube captions -> Mongolian translation -> TTS dub.

This is the original processing engine (caption_fetcher -> translator -> tts_service).
The Firestore-backed CRUD/persistence layer lives in routers/video.py and
routers/summary.py; this router owns the actual audio/dub generation.
"""

import asyncio
import json
import os
import queue as sync_queue
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from yt_dlp.utils import DownloadError

from app.config import get_settings, AUDIO_DIR
from app.utils.audio import save_audio, audio_duration_ms_from_bytes
from app.services.caption_fetcher import fetch_captions
from app.services.whisper_service import transcribe
from app.services.tts_service import synthesize
from app.services.summary_service import summarize
from app.services.cache_service import get_cached_video, cache_video
from app.utils.video import extract_video_id
from app.models.segment import Segment


def _save_audio_with_fallback(audio_bytes: bytes, video_id: str, segment_index: int) -> str:
    """Try Firebase Storage first; fall back to local static files on failure."""
    try:
        return save_audio(audio_bytes, video_id, segment_index)
    except Exception:
        dir_path = os.path.join(AUDIO_DIR, video_id)
        os.makedirs(dir_path, exist_ok=True)
        file_path = os.path.join(dir_path, f"segment_{segment_index}.mp3")
        with open(file_path, "wb") as f:
            f.write(audio_bytes)
        return f"/audio/{video_id}/segment_{segment_index}.mp3"

router = APIRouter(tags=["pipeline"])


class ProcessRequest(BaseModel):
    video_id: str
    gender: str = "male"


class SummaryRequest(BaseModel):
    video_id: str


def _empty_process_result(video_id: str) -> dict:
    return {"video_id": video_id, "segments": []}


def _local_processing_enabled() -> bool:
    return os.getenv("ENABLE_LOCAL_PROCESSING", "").strip().lower() in {"1", "true", "yes"}


@router.post("/process")
async def process_video(request: ProcessRequest):
    video_id = extract_video_id(request.video_id)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    cache_key = f"{video_id}_{request.gender}"
    cached = get_cached_video(cache_key)
    if cached:
        return cached

    if get_settings().environment == "local" and not _local_processing_enabled():
        result = _empty_process_result(video_id)
        cache_video(video_id, result)
        return result

    try:
        # PATH A: YouTube captions
        caption_result = fetch_captions(video_id)

        if caption_result:
            source_lang, segments = caption_result
        else:
            # PATH B: yt-dlp + Whisper fallback
            youtube_url = f"https://www.youtube.com/watch?v={video_id}"
            source_lang, segments = transcribe(youtube_url)

        # Translate segments in parallel
        def translate_one(args):
            i, seg = args
            from app.services.translator import translate
            if source_lang == "en":
                mn_text = translate(seg.text, "en", "mn")
            else:
                en_text = translate(seg.text, source_lang, "en")
                mn_text = translate(en_text, "en", "mn")
            return i, seg.model_copy(update={"translated_text": mn_text})

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(translate_one, (i, seg)): i for i, seg in enumerate(segments)}
            translated = [None] * len(segments)
            for future in as_completed(futures):
                i, seg = future.result()
                translated[i] = seg
        segments = translated

        # TTS for each segment in parallel
        def tts_one(args):
            i, seg = args
            audio_bytes = synthesize(seg.translated_text or seg.text, {"gender": request.gender})
            audio_ms = audio_duration_ms_from_bytes(audio_bytes)
            audio_path = _save_audio_with_fallback(audio_bytes, video_id, i)
            return i, seg.model_copy(update={"audio_path": audio_path, "audio_ms": audio_ms})

        result_segments = [None] * len(segments)
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(tts_one, (i, seg)): i for i, seg in enumerate(segments)}
            for future in as_completed(futures):
                i, seg = future.result()
                result_segments[i] = seg.model_dump()

    except DownloadError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not fetch audio from YouTube",
        ) from exc
    except Exception as exc:
        if get_settings().environment == "local":
            result = _empty_process_result(video_id)
            cache_video(video_id, result)
            return result
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Video processing is temporarily unavailable.",
        ) from exc

    result = {"video_id": video_id, "segments": result_segments}
    cache_video(cache_key, result)
    return result


@router.get("/process/stream")
async def process_video_stream(video_id: str, gender: str = "male"):
    extracted = extract_video_id(video_id)
    if not extracted:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    cache_key = f"{extracted}_{gender}"

    async def generate():
        cached = get_cached_video(cache_key)
        if cached:
            yield f"data: {json.dumps({'step': 'ready', 'result': cached})}\n\n"
            return

        if get_settings().environment == "local" and not _local_processing_enabled():
            empty = _empty_process_result(extracted)
            cache_video(cache_key, empty)
            yield f"data: {json.dumps({'step': 'ready', 'result': empty})}\n\n"
            return

        q: sync_queue.Queue = sync_queue.Queue()
        lock = threading.Lock()

        def pipeline():
            try:
                caption_result = fetch_captions(extracted)
                if caption_result:
                    source_lang, segments = caption_result
                else:
                    youtube_url = f"https://www.youtube.com/watch?v={extracted}"
                    source_lang, segments = transcribe(youtube_url)

                total = len(segments)
                q.put({"step": "translating", "done": 0, "total": total})

                translated = [None] * total
                done_count = [0]

                def translate_one(args):
                    i, seg = args
                    from app.services.translator import translate
                    if source_lang == "en":
                        mn_text = translate(seg.text, "en", "mn")
                    else:
                        en_text = translate(seg.text, source_lang, "en")
                        mn_text = translate(en_text, "en", "mn")
                    result = i, seg.model_copy(update={"translated_text": mn_text})
                    with lock:
                        done_count[0] += 1
                        q.put({"step": "translating", "done": done_count[0], "total": total})
                    return result

                with ThreadPoolExecutor(max_workers=8) as executor:
                    futures = {executor.submit(translate_one, (i, seg)): i for i, seg in enumerate(segments)}
                    for future in as_completed(futures):
                        i, seg = future.result()
                        translated[i] = seg
                segments = translated

                q.put({"step": "tts", "done": 0, "total": total})

                result_segments = [None] * total
                tts_done_count = [0]

                def tts_one(args):
                    i, seg = args
                    audio_bytes = synthesize(seg.translated_text or seg.text, {"gender": gender})
                    audio_ms = audio_duration_ms_from_bytes(audio_bytes)
                    audio_path = _save_audio_with_fallback(audio_bytes, extracted, i)
                    result = i, seg.model_copy(update={"audio_path": audio_path, "audio_ms": audio_ms})
                    with lock:
                        tts_done_count[0] += 1
                        q.put({"step": "tts", "done": tts_done_count[0], "total": total})
                    return result

                with ThreadPoolExecutor(max_workers=8) as executor:
                    futures = {executor.submit(tts_one, (i, seg)): i for i, seg in enumerate(segments)}
                    for future in as_completed(futures):
                        i, seg = future.result()
                        result_segments[i] = seg.model_dump()

                result = {"video_id": extracted, "segments": result_segments}
                cache_video(cache_key, result)
                q.put({"step": "ready", "result": result})

            except DownloadError:
                q.put({"step": "error", "detail": "Could not fetch audio from YouTube"})
            except Exception as e:
                q.put({"step": "error", "detail": str(e)})

        threading.Thread(target=pipeline, daemon=True).start()

        while True:
            try:
                event = q.get_nowait()
                yield f"data: {json.dumps(event)}\n\n"
                if event["step"] in ("ready", "error"):
                    break
            except sync_queue.Empty:
                await asyncio.sleep(0.1)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/summary")
async def get_summary(request: SummaryRequest):
    cached = get_cached_video(request.video_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Video not processed yet. Call POST /process first.",
        )

    segments = [Segment(**s) for s in cached.get("segments", [])]
    summary = summarize(segments)
    return {"video_id": request.video_id, "summary": summary}
