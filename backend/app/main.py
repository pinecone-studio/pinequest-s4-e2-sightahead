import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers.video import router as video_router
from app.routers.summary import router as summary_router
from app.routers.auth import router as auth_router
from app.config import AUDIO_DIR

app = FastAPI(title="Sightahead Backend")

os.makedirs(AUDIO_DIR, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

app.include_router(video_router)
app.include_router(summary_router)
app.include_router(auth_router)


@app.get("/")
def root():
    return {"status": "ok"}
