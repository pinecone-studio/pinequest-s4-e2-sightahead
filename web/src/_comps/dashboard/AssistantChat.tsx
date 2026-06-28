"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  Bot,
  HelpCircle,
  NotebookPen,
  PanelRightClose,
  Send,
  Sparkles,
  TextSearch,
  type LucideIcon,
} from "lucide-react";
import {
  chatWithAssistant,
  type AssistantMode,
  type AssistantSegmentPayload,
  type Segment,
} from "@/lib/backend-api";

type AssistantChatProps = {
  open: boolean;
  videoId: string;
  currentTime: number;
  segments: Segment[];
  onClose: () => void;
  onCollapse: () => void;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const QUICK_ACTIONS: Array<{
  mode: AssistantMode;
  label: string;
  icon: LucideIcon;
  userText: string;
}> = [
  {
    mode: "help",
    label: "Заавар",
    icon: HelpCircle,
    userText: "Website ашиглах заавар өгөөч.",
  },
  {
    mode: "current_segment",
    label: "Тайлбар",
    icon: TextSearch,
    userText: "Одоо үзэж байгаа хэсгийг тайлбарла.",
  },
  {
    mode: "summary",
    label: "Summary",
    icon: Sparkles,
    userText: "Бичлэгийн нийт summary гарга.",
  },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function segmentTextLength(segment: Segment) {
  return (segment.translated_text || segment.text || "").length;
}

function compactSegments(
  segments: Segment[],
  mode: AssistantMode,
  currentTime: number,
): AssistantSegmentPayload[] {
  const source =
    mode === "current_segment"
      ? segments.filter(
          (segment) =>
            segment.start + segment.duration >= currentTime - 70 &&
            segment.start <= currentTime + 100,
        )
      : segments;
  const fallback = source.length ? source : segments;
  const maxChars = mode === "current_segment" ? 6000 : 18000;
  let used = 0;
  const compacted: AssistantSegmentPayload[] = [];

  for (const segment of fallback) {
    if (!segment.text.trim() && !segment.translated_text?.trim()) continue;
    const length = segmentTextLength(segment);
    if (used + length > maxChars) break;
    used += length;
    compacted.push({
      start: segment.start,
      duration: segment.duration,
      text: segment.text,
      translated_text: segment.translated_text,
    });
  }

  return compacted;
}

export function AssistantChat({
  open,
  videoId,
  currentTime,
  segments,
  onClose,
  onCollapse,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Сайн байна уу. Юу асуух вэ?",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);

  const hasTranscript = useMemo(() => segments.length > 0, [segments.length]);

  if (!open) return null;

  async function send(
    mode: AssistantMode,
    userText: string,
    question?: string,
  ) {
    const trimmedQuestion = question?.trim();
    if (mode === "question" && !trimmedQuestion) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: mode === "question" ? trimmedQuestion || userText : userText,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setLoading(true);

    try {
      const response = await chatWithAssistant({
        mode,
        question: trimmedQuestion,
        video_id: videoId || undefined,
        current_time: currentTime,
        segments: compactSegments(segments, mode, currentTime),
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: response.answer,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Туслах хариу өгөхөд алдаа гарлаа.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send("question", draft, draft);
  }

  return (
    <section
      className="dashboard-assistant-panel"
      role="dialog"
      aria-label="Assistant chat"
    >
      <div className="dashboard-assistant-header">
        <div className="dashboard-assistant-title">
          <span className="dashboard-assistant-avatar" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <strong>HELEX Assistant</strong>
            <small>
              {hasTranscript ? "Transcript ready" : "Transcript хүлээж байна"}
            </small>
          </div>
        </div>
        <div className="dashboard-panel-toggle" aria-label="Right panel view">
          <button type="button" onClick={onClose} aria-pressed="false">
            <NotebookPen size={14} aria-hidden="true" />
            <span>Notes</span>
          </button>
          <button type="button" className="is-active" aria-pressed="true">
            <Bot size={14} aria-hidden="true" />
            <span>AI Assistant</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="dashboard-notes-icon-button"
          aria-label="Collapse AI assistant"
          title="Collapse AI assistant"
        >
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="dashboard-assistant-actions">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const disabled =
            loading || (action.mode !== "help" && !hasTranscript);
          return (
            <button
              key={action.mode}
              type="button"
              disabled={disabled}
              onClick={() => void send(action.mode, action.userText)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      <div className="dashboard-assistant-messages dashboard-scroll">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "dashboard-assistant-message is-user"
                : "dashboard-assistant-message"
            }
          >
            {message.content}
          </div>
        ))}
        {loading && (
          <div className="dashboard-assistant-message is-loading">
            Хариу боловсруулж байна...
          </div>
        )}
      </div>

      <form className="dashboard-assistant-input-row" onSubmit={submitQuestion}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Асуух зүйлээ бич..."
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          aria-label="Send message"
          title="Send"
        >
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
