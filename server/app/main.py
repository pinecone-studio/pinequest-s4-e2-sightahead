from fastapi import FastAPI
from app.routers.transcribe import router as transcribe_router

app = FastAPI()

app.include_router(transcribe_router)

@app.get("/")
def root():
    return {"status": "ok"}