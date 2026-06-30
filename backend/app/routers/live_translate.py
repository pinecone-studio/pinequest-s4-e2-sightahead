"""
Real-time live translation via Gemini 3.5 Live Translate + optional Azure TTS.

Flow:
  Browser captures tab audio (getDisplayMedia) → PCM 16 kHz → WS to this endpoint
  → Gemini 3.5 Live Translate (WSS)
      Engine A  gemini_native : Gemini returns 24 kHz PCM → forward to browser
      Engine B  gemini_azure  : Gemini returns translated text
                               → Azure TTS WebSocket → MP3 chunks + WordBoundary
                               → both forwarded to browser

Browser-side binary frames are prefixed with a 1-byte type tag:
  0x01 = audio chunk (MP3 or raw PCM depending on engine)
"""

import asyncio
import base64
import json
import logging
import os
import uuid

import httpx
import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live-translate"])

_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
_AZURE_KEY = os.getenv("AZURE_SPEECH_KEY", "")
_AZURE_REGION = os.getenv("AZURE_SPEECH_REGION", "southeastasia")

_AZURE_VOICES = {"female": "mn-MN-YesuiNeural", "male": "mn-MN-BataaNeural"}

_GEMINI_WS = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    "?key={key}"
)
_AZURE_TTS_WS = (
    "wss://{region}.tts.speech.microsoft.com"
    "/cognitiveservices/websocket/v1"
    "?Authorization=bearer%20{token}&X-ConnectionId={conn_id}"
)


# ── Azure helpers ─────────────────────────────────────────────────────────────

async def _azure_token() -> str:
    url = f"https://{_AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, headers={"Ocp-Apim-Subscription-Key": _AZURE_KEY})
        r.raise_for_status()
        return r.text


def _ssml(text: str, gender: str) -> str:
    import xml.sax.saxutils as sax
    voice = _AZURE_VOICES.get(gender, _AZURE_VOICES["female"])
    return (
        '<speak version="1.0" '
        'xmlns="http://www.w3.org/2001/10/synthesis" '
        'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="mn-MN">'
        f'<voice name="{voice}">'
        '<mstts:silence type="Leading" value="50ms"/>'
        f'<prosody rate="+10%">{sax.escape(text)}</prosody>'
        '<mstts:silence type="Trailing" value="50ms"/>'
        "</voice></speak>"
    )


async def _azure_tts_stream(
    text: str,
    gender: str,
    on_audio: "Callable[[bytes], Coroutine]",
    on_word: "Callable[[str, int, int], Coroutine]",
) -> None:
    """Connect to Azure TTS WebSocket, stream audio chunks and word-boundary events."""
    token = await _azure_token()
    conn_id = uuid.uuid4().hex.upper()
    url = _AZURE_TTS_WS.format(region=_AZURE_REGION, token=token, conn_id=conn_id)

    async with websockets.connect(
        url,
        additional_headers={"User-Agent": "SightAhead/1.0"},
        ping_interval=None,
    ) as tts_ws:
        # Speech config — enable word-boundary metadata
        config_hdr = (
            f"Path: speech.config\r\n"
            f"X-RequestId: {conn_id}\r\n"
            f"X-Timestamp: 0\r\n"
            f"Content-Type: application/json\r\n\r\n"
        )
        config_body = json.dumps({
            "context": {
                "synthesis": {
                    "audio": {
                        "outputFormat": "audio-16khz-128kbitrate-mono-mp3",
                        "metadataoptions": {"wordBoundaryEnabled": "true"},
                    }
                }
            }
        })
        await tts_ws.send(config_hdr + config_body)

        # SSML synthesis request
        ssml_hdr = (
            f"Path: ssml\r\n"
            f"X-RequestId: {conn_id}\r\n"
            f"X-Timestamp: 0\r\n"
            f"Content-Type: application/ssml+xml\r\n\r\n"
        )
        await tts_ws.send(ssml_hdr + _ssml(text, gender))

        async for msg in tts_ws:
            if isinstance(msg, bytes):
                # First 2 bytes = header length (big-endian uint16)
                if len(msg) > 2:
                    header_len = int.from_bytes(msg[:2], "big")
                    audio = msg[2 + header_len:]
                    if audio:
                        await on_audio(audio)
            elif isinstance(msg, str) and "Path:audio.metadata" in msg:
                try:
                    body = msg.split("\r\n\r\n", 1)[1]
                    for item in json.loads(body).get("Metadata", []):
                        if item.get("Type") == "WordBoundary":
                            d = item["Data"]
                            await on_word(
                                d["text"]["Text"],
                                d["Offset"] // 10_000,    # 100 ns → ms
                                d["Duration"] // 10_000,
                            )
                except Exception:
                    pass
            elif isinstance(msg, str) and "Path:turn.end" in msg:
                break


# ── Main WebSocket endpoint ───────────────────────────────────────────────────

@router.websocket("/ws/live-translate")
async def live_translate_ws(ws: WebSocket) -> None:
    await ws.accept()

    # 1. Config handshake
    try:
        cfg = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except Exception:
        await ws.close(code=1008)
        return

    engine = cfg.get("engine", "gemini_azure")   # "gemini_native" | "gemini_azure"
    gender = cfg.get("gender", "female")
    target_lang = cfg.get("target_lang", "mn")

    if not _GEMINI_KEY:
        await ws.send_json({"type": "error", "message": "GEMINI_API_KEY not set on server"})
        await ws.close()
        return

    # Always request AUDIO — the model is audio-in / audio-out only.
    # gemini_azure engine discards Gemini's audio bytes and feeds the
    # outputTranscription text to Azure TTS instead.
    response_modalities = ["AUDIO"]
    gemini_url = _GEMINI_WS.format(key=_GEMINI_KEY)

    logger.info(
        "/ws/live-translate connected: engine=%s gender=%s target=%s",
        engine, gender, target_lang,
    )

    try:
        async with websockets.connect(
            gemini_url,
            ping_interval=20,
            ping_timeout=10,
        ) as gemini_ws:

            # 2. Gemini setup message
            # outputAudioTranscription lives directly under "setup", NOT inside
            # generationConfig. translationConfig IS inside generationConfig.
            await gemini_ws.send(json.dumps({
                "setup": {
                    "model": "models/gemini-3.5-live-translate-preview",
                    "outputAudioTranscription": {},
                    "generationConfig": {
                        "responseModalities": response_modalities,
                        "translationConfig": {
                            "targetLanguageCode": target_lang,
                            "echoTargetLanguage": False,
                        },
                    },
                    "realtimeInputConfig": {
                        "automaticActivityDetection": {"disabled": False},
                    },
                }
            }))
            # Wait for setupComplete
            await asyncio.wait_for(gemini_ws.recv(), timeout=15)
            await ws.send_json({"type": "ready"})

            # Queue for text-chunks awaiting Azure TTS (gemini_azure engine only)
            tts_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
            stop_event = asyncio.Event()

            # 3a. Client PCM → Gemini
            async def pump_client():
                try:
                    while not stop_event.is_set():
                        data = await ws.receive_bytes()
                        audio_b64 = base64.b64encode(data).decode()
                        await gemini_ws.send(json.dumps({
                            "realtimeInput": {
                                "audio": {
                                    "data": audio_b64,
                                    "mimeType": "audio/pcm;rate=16000",
                                }
                            }
                        }))
                except (WebSocketDisconnect, Exception):
                    stop_event.set()

            # 3b. Gemini → client (or → tts_queue)
            async def pump_gemini():
                try:
                    async for raw in gemini_ws:
                        if stop_event.is_set():
                            break
                        data = json.loads(raw)

                        server_content = data.get("serverContent", {})
                        parts = (
                            server_content.get("modelTurn", {})
                                         .get("parts", [])
                        )
                        for part in parts:
                            if "inlineData" in part:
                                audio_bytes = base64.b64decode(
                                    part["inlineData"]["data"]
                                )
                                # gemini_native: stream Gemini's PCM audio directly
                                # gemini_azure: discard — Azure TTS generates audio
                                if engine == "gemini_native":
                                    await ws.send_bytes(b"\x01" + audio_bytes)

                        # outputTranscription is nested under serverContent
                        out_tx = server_content.get("outputTranscription", {})
                        text = out_tx.get("text", "").strip()
                        if text:
                            await ws.send_json({"type": "text", "text": text})
                            if engine == "gemini_azure":
                                await tts_queue.put(text)
                except Exception:
                    stop_event.set()

            # 3c. tts_queue → Azure TTS WS → audio chunks + word boundaries
            async def pump_azure():
                while not stop_event.is_set():
                    try:
                        text = await asyncio.wait_for(tts_queue.get(), timeout=1)
                    except asyncio.TimeoutError:
                        continue
                    try:
                        async def _audio(chunk: bytes) -> None:
                            await ws.send_bytes(b"\x01" + chunk)

                        async def _word(word: str, offset_ms: int, dur_ms: int) -> None:
                            await ws.send_json({
                                "type": "word",
                                "word": word,
                                "offsetMs": offset_ms,
                                "durationMs": dur_ms,
                            })

                        await _azure_tts_stream(text, gender, _audio, _word)
                    except Exception as exc:
                        logger.warning("Azure TTS stream error: %s", exc)
                    finally:
                        tts_queue.task_done()

            coros = [pump_client(), pump_gemini()]
            if engine == "gemini_azure":
                coros.append(pump_azure())

            await asyncio.gather(*coros, return_exceptions=True)

    except Exception as exc:
        logger.exception("live-translate fatal: %s", exc)
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
        logger.info("/ws/live-translate disconnected")
