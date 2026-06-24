# yt-dlb logic

import yt_dlp
import uuid
import os

def download_audio(url: str) -> str:
    output_path = f"tmp/audio_{uuid.uuid4().hex}"
    
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_path,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
        }]
        "quiet": True
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
        
    return output_path + "mp3"