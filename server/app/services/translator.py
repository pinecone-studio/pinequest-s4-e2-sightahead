import os
import httpx

PROVIDER = os.getenv("TRANSLATION_PROVIDER", "google")
GOOGLE_KEY = os.getenv("GOOGLE_TRANSLATE_API_KEY", "")
CHIMEGE_KEY = os.getenv("CHIMEGE_TRANSLATE_API_KEY", "")
CHIMEGE_URL = os.getenv("CHIMEGE_TRANSLATE_URL", "https://api.chimege.com/v1.0/translate")


def translate(text: str, source_lang: str, target_lang: str = "mn") -> str:
    if PROVIDER == "google":
        return _google_translate(text, source_lang, target_lang)
    if PROVIDER == "chimege":
        return _chimege_translate(text, source_lang, target_lang)
    raise ValueError(f"Unknown translation provider: {PROVIDER}")


def to_mongolian(segments: list, source_lang: str) -> list:
    """
    Translates segment texts to Mongolian, preserving start/duration.

    English source  → one step:  en → mn
    Any other source → two steps: source → en (Google), then en → mn
    """
    result = []
    for seg in segments:
        if source_lang == "en":
            mn_text = translate(seg["text"], "en", "mn")
        else:
            en_text = translate(seg["text"], source_lang, "en")
            mn_text = translate(en_text, "en", "mn")
        result.append({
            "text": mn_text,
            "start": seg["start"],
            "duration": seg["duration"],
        })
    return result


def _google_translate(text: str, source_lang: str, target_lang: str) -> str:
    url = "https://translation.googleapis.com/language/translate/v2"
    resp = httpx.post(url, params={"key": GOOGLE_KEY}, json={
        "q": text,
        "source": source_lang,
        "target": target_lang,
        "format": "text",
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()["data"]["translations"][0]["translatedText"]


def _chimege_translate(text: str, source_lang: str, target_lang: str) -> str:
    resp = httpx.post(CHIMEGE_URL, headers={
        "Authorization": f"Bearer {CHIMEGE_KEY}",
        "Content-Type": "application/json",
    }, json={"text": text, "source": source_lang, "target": target_lang}, timeout=15)
    resp.raise_for_status()
    return resp.json()["result"]
