"use client";

import { useEffect, useState } from "react";
import type { Segment } from "@/lib/backend-api";
import { base64ToBlobUrl, fetchTranscript, streamProcess } from "@/lib/process-stream";

// Full live pipeline for a selected video:
//   1. fetch the transcript from our Vercel route (client-side, dodges the
//      Render IP block),
//   2. POST it to the backend /process and consume the SSE stream,
//   3. append each translated + dubbed segment to state as it arrives, so the
//      transcript fills in live and subtitles can switch immediately.
// Audio dub (segment.audio_path = decoded blob URL) is attached but not yet
// auto-played — that's the next step.
export function useProcessedVideo(videoId: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId) {
      setSegments([]);
      setError("");
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const blobUrls: string[] = [];

    setSegments([]);
    setError("");
    setLoading(true);
    console.log("video started processing", videoId);

    (async () => {
      try {
        const transcript = await fetchTranscript(videoId);
        if (!active) return;
        if (!transcript.segments.length) {
          setError("No transcript available for this video.");
          setLoading(false);
          return;
        }

        await streamProcess(
          { source_lang: transcript.source_lang, segments: transcript.segments },
          {
            onSegment: (s) => {
              if (!active) return;
              const audioUrl = s.audio_b64 ? base64ToBlobUrl(s.audio_b64) : null;
              if (audioUrl) blobUrls.push(audioUrl);
              const seg: Segment = {
                start: s.offset,
                duration: s.duration,
                text: s.text,
                source: "youtube_captions",
                translated_text: s.translated_text,
                audio_path: audioUrl,
                audio_ms: s.audio_ms,
              };
              setSegments((prev) => [...prev, seg]);
            },
            onDone: () => {
              if (active) setLoading(false);
            },
            onError: (message) => {
              if (!active) return;
              setError(message);
              setLoading(false);
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Processing failed.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [videoId]);

  return { segments, loading, error };
}
