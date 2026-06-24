from fastapi import APIRouter
from pydantic import BaseModel

from app.services.caption_fetcher import fetch_caption
from app.services.downloader import download_audio
from app.services.whisper import transcribe_audio

router = APIRouter()

class DubRequest(BaseModel):
    url:str
    
@router.post("/dub")
async def dub_video(request:DubRequest):
    video_id: extract_video_id(
        request.url
    )
    
    captions = fetch_caption(
        video_id
    )
    
    if captions: 
        segments = captions
        source="youtube"
        
    else: 
        audio = download_audio(request.url)
        
        segments = transcribe_audio(audio)
        
        source = "whisper"
        
    return {
        "source": source,
        "segments": segments
    }