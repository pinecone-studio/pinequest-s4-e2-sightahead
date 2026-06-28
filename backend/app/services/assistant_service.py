import os
from typing import Literal

from pydantic import BaseModel

from app.config import OPENAI_API_KEY


AssistantMode = Literal["help", "current_segment", "summary", "question"]


class AssistantSegment(BaseModel):
    start: float
    duration: float
    text: str
    translated_text: str | None = None


class AssistantRequestData(BaseModel):
    mode: AssistantMode
    question: str | None = None
    video_id: str | None = None
    current_time: float | None = None
    segments: list[AssistantSegment] = []


_HELP_TEXT = """HELEX ашиглах товч заавар:

1. Дээрх хайлтын хэсэгт YouTube URL эсвэл хайх үгээ оруулна.
2. Сонгосон видео dashboard дээр нээгдэж, хадмал автоматаар ачаална.
3. Видео тоглож байх үед баруун талын Notes хэсэгт тэмдэглэл бичвэл тухайн мөчийн цагтай хадгалагдана.
эд одоо үзэж байгаа хэсгийг тайлбарлуулах эсвэл нийт summary гаргуулж болно4. Тэмдэглэл дээр дарвал видео тэр агшин руу шууд очно.

"""


def answer_assistant(request: AssistantRequestData) -> str:
    if request.mode == "help":
        return _HELP_TEXT

    if not request.segments:
        return (
            "Энэ видеоны transcript хараахан ачаалагдаагүй байна. "
            "Видео сонгоод хадмал ачаалагдсаны дараа дахин асуугаарай."
        )

    prompt = _build_prompt(request)
    return _ask_openai(prompt)


def _ask_openai(prompt: str) -> str:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_ASSISTANT_MODEL", "gpt-4o-mini")
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are HELEX's Mongolian learning assistant. "
                    "Answer in clear, natural Mongolian. Be concise, practical, "
                    "and rely only on the transcript context provided."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.35,
    )
    return (response.choices[0].message.content or "").strip()


def _build_prompt(request: AssistantRequestData) -> str:
    if request.mode == "summary":
        transcript = _segments_to_text(request.segments, max_chars=12000)
        return (
            "Доорх видеоны transcript дээр үндэслээд монголоор 4-6 өгүүлбэрийн "
            "ойлгомжтой summary гарга. Гол санаа, хэрэгтэй дүгнэлтийг багтаа.\n\n"
            f"Transcript:\n{transcript}"
        )

    if request.mode == "current_segment":
        window = _current_window(request.segments, request.current_time)
        return (
            "Хэрэглэгч видеоны яг энэ хэсгийг ойлгохыг хүсэж байна. Доорх хэсэгт "
            "юу ярьж байгаа, яагаад чухал байж болохыг 2-4 өгүүлбэрээр тайлбарла.\n\n"
            f"Current time: {request.current_time or 0:.1f}s\n"
            f"Transcript window:\n{window}"
        )

    question = (request.question or "").strip()
    context = _question_context(request.segments, request.current_time)
    return (
        "Хэрэглэгчийн асуултад transcript context дээр үндэслэж хариул. "
        "Хэрэв context дотор хариулах мэдээлэл байхгүй бол түүнийгээ товч хэлээд, "
        "вебсайт ашиглахтай холбоотой бол шууд тусал.\n\n"
        f"Question: {question or 'Энэ видеоны талаар тайлбарла.'}\n\n"
        f"Context:\n{context}"
    )


def _segment_text(segment: AssistantSegment) -> str:
    return (segment.translated_text or segment.text).strip()


def _segments_to_text(segments: list[AssistantSegment], max_chars: int) -> str:
    lines: list[str] = []
    used = 0
    for segment in segments:
        text = _segment_text(segment)
        if not text:
            continue
        line = f"[{segment.start:.1f}s] {text}"
        if used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


def _current_window(
    segments: list[AssistantSegment],
    current_time: float | None,
    before_seconds: float = 35,
    after_seconds: float = 45,
) -> str:
    if current_time is None:
        return _segments_to_text(segments[:20], max_chars=4000)

    start_at = max(0.0, current_time - before_seconds)
    end_at = current_time + after_seconds
    window = [
        segment
        for segment in segments
        if segment.start + segment.duration >= start_at and segment.start <= end_at
    ]
    if not window:
        window = segments[:20]
    return _segments_to_text(window, max_chars=4500)


def _question_context(
    segments: list[AssistantSegment],
    current_time: float | None,
) -> str:
    current = _current_window(segments, current_time, before_seconds=45, after_seconds=60)
    overall = _segments_to_text(segments, max_chars=6000)
    return f"Nearby transcript:\n{current}\n\nOverall transcript excerpt:\n{overall}"
