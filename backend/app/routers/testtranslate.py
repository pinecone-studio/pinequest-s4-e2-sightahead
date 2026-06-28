from fastapi import APIRouter, HTTPException
import edge_tts
import logging
import io
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/test", tags=["test"])

VOICE = "mn-MN-YesuiNeural"


class TTSrequest(BaseModel):
    text: str


@router.post("/tts")
async def test_tts(req: TTSrequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")

    communicate = edge_tts.Communicate(req.text, VOICE)
    buffer = io.BytesIO()

    try:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
    except Exception as e:
        logger.exception("edge-tts failed")
        raise HTTPException(status_code=502, detail=f"TTS FAILED: {e}")

    if buffer.getbuffer().nbytes == 0:
        raise HTTPException(status_code=502, detail="no audio produced")

    buffer.seek(0)
    # edge-tts streams MP3, not WAV.
    return StreamingResponse(buffer, media_type="audio/mpeg")
