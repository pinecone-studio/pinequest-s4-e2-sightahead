from youtube_transcript_api import YouTubeTranscriptApi

def fetch_caption(video_id):
    
    try:
        transcript = YouTubeTranscriptApi.get_transcript(
            video_id
        )
        return transcript
    except Exception:
        return None
    