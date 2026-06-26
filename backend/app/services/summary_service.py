import os

from app.models.segment import Segment


def summarize(segments: list[Segment]) -> str:
    """Generate a Mongolian summary of the video using translated segment texts."""
    text = " ".join(
        seg.translated_text or seg.text
        for seg in segments
        if (seg.translated_text or seg.text).strip()
    )
    if not text:
        return ""

    # Lazy import so a missing/misconfigured OpenAI client can't break module
    # load (mirrors translator.py). Summary uses OpenAI for consistency with
    # translation quality.
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_SUMMARY_MODEL") or os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    prompt = (
        "Дараах видеоны агуулгыг монгол хэлээр товч тайлбарлана уу. "
        "3-5 өгүүлбэрт багтаана уу.\n\n" + text[:8000]
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()
