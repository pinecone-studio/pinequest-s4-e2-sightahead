from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")

def transcribe_audio(file_path: str, language: str = None):
    segments, info = model.transcribe(
        file_path,
        beam_size=5,
        language=language
    )
    
    result = []
    for segment in segments:
        result.append({
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip()
        })
    
    return {
        "language": info.language,
        "language_probablity": round(info.language_probability, 2),
        "segments": result
    }