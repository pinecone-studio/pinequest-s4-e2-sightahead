from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.caption_fetcher import fetch_caption
from app.services.translator import to_mongolian
from app.services.tts_service import synthesize
from app.utils.video import extract_video_id
from app.utils.audio import save_audio, audio_url_path
from app.utils.job import get_cached_result, set_cached_result

router = APIRouter()


class DubRequest(BaseModel):
    url: str


@router.post("/dub")
async def dub_video(request: DubRequest):
    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    cached = get_cached_result(video_id)
    if cached:
        return cached

    result = fetch_caption(video_id)
    if not result:
        # EXTENSION POINT: Whisper-based transcription for videos without captions
        raise HTTPException(status_code=422, detail={
            "code": "NO_CAPTIONS",
            "message": "This video has no captions. Whisper fallback is not yet implemented.",
        })

    source_lang = result["source_lang"]
    translated = to_mongolian(result["segments"], source_lang)

    segments = []
    for i, seg in enumerate(translated):
        audio_bytes = synthesize(seg["text"])
        save_audio(audio_bytes, video_id, i)
        segments.append({
            "text": seg["text"],
            "start": seg["start"],
            "duration": seg["duration"],
            "audio_url": audio_url_path(video_id, i),
        })

    final = {"video_id": video_id, "segments": segments}
    set_cached_result(video_id, final)
    return final
