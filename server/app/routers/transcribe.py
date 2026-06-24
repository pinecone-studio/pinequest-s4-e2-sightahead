#transcribe routes
from fastapi import APIRouter
from app.models.job import TranscribeRequest
from app.services.downloader import download_audio
from app.services.whisper import transcribe_audio
import os

router = APIRouter()

@router.post("/transcribe")
async def transcribe(payload: TranscribeRequest):
    audio_path = download_audio(payload.url)
    result = transcribe_audio(audio_path, payload.language)
    os.unlink(audio_path)
    return result