// Client-side transcript fetch (Vercel route) + SSE streaming of the backend
// /process pipeline (translate + TTS), yielding one segment at a time.

export type TranscriptSegment = { start: number; duration: number; text: string };
export type TranscriptResponse = {
  video_id: string;
  source_lang: string;
  segments: TranscriptSegment[];
};

// One segment as streamed back by the backend over SSE.
export type StreamedSegment = {
  offset: number; // seconds
  duration: number; // seconds
  text: string;
  translated_text: string;
  audio_b64: string; // MP3 bytes, base64
  audio_ms: number;
};

export type StreamHandlers = {
  onSegment: (segment: StreamedSegment, index: number, total: number) => void;
  onDone?: (total: number) => void;
  onError?: (message: string) => void;
};

function backendUrl(path: string): string {
  let base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  // Guarantee a scheme so the request actually leaves the frontend origin.
  if (base && !/^https?:\/\//.test(base)) base = `http://${base}`;
  return `${base}${path}`;
}

// Fetches the transcript from our own Vercel API route (same-origin, no CORS).
export async function fetchTranscript(videoId: string): Promise<TranscriptResponse> {
  const res = await fetch(`/api/youtube/transcript?videoId=${encodeURIComponent(videoId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Transcript fetch failed.");
  }
  return res.json();
}

// POSTs the segments to the backend and consumes the SSE stream, invoking
// handlers as each translated + dubbed segment arrives.
export async function streamProcess(
  payload: { source_lang: string; segments: TranscriptSegment[] },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(backendUrl("/process"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Process failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? ""; // keep the trailing incomplete chunk

    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (!line) continue;

      const msg = JSON.parse(line);
      if (msg.error) {
        handlers.onError?.(msg.error);
      } else if (msg.done) {
        handlers.onDone?.(msg.total);
      } else {
        handlers.onSegment(msg.segment, msg.index, msg.total);
      }
    }
  }
}

// Decodes base64 MP3 bytes into a playable object URL.
export function base64ToBlobUrl(b64: string, mime = "audio/mpeg"): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
