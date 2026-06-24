from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled


def fetch_caption(video_id: str) -> dict | None:
    """
    Returns { "source_lang": str, "segments": [{ "text", "start", "duration" }] }
    or None if no captions are available.

    Language selection: tries English first; falls back to any available track.
    The detected source_lang is passed downstream so the translation stage knows
    whether a pivot through English is needed.
    """
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    except (TranscriptsDisabled, Exception):
        return None

    source_lang = "en"
    try:
        transcript = transcript_list.find_transcript(["en"])
    except NoTranscriptFound:
        try:
            transcript = next(iter(transcript_list))
            source_lang = transcript.language_code
        except StopIteration:
            return None

    try:
        data = transcript.fetch()
    except Exception:
        return None

    segments = [
        {"text": seg["text"], "start": seg["start"], "duration": seg["duration"]}
        for seg in data
    ]
    return {"source_lang": source_lang, "segments": segments}
