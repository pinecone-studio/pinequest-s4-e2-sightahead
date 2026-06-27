"use client";

import { useEffect, useState } from "react";
import type { Segment } from "@/lib/backend-api";
import { fetchTranscript } from "@/lib/process-stream";

// Loads the caption transcript for a selected video and exposes it as Segment[].
//
// Path A only: we fetch captions from our own Vercel route
// (/api/youtube/transcript), which dodges the datacenter-IP block and is the
// flow proven to work in /test. The captions are shown as-is.
//
// NOTE: the old Python pipeline (streamProcess → backend /process for Mongolian
// translation + TTS dub) is intentionally DISCONNECTED here — it kept the UI
// empty whenever the backend was unreachable. streamProcess/base64ToBlobUrl
// still live in lib/process-stream.ts if we want to re-enable dubbing later.
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

    let active = true; // guards against state updates after the video changes

    setSegments([]);
    setError("");
    setLoading(true);
    console.log("[useProcessedVideo] fetching captions for", videoId);

    (async () => {
      try {
        const transcript = await fetchTranscript(videoId);
        if (!active) return;

        if (!transcript.segments.length) {
          setError("No transcript available for this video.");
          setLoading(false);
          return;
        }

        // Map the raw transcript into the Segment shape SubtitlePane expects.
        // No translation/dub yet: translated_text/audio stay null and the pane
        // falls back to the original caption text.
        const mapped: Segment[] = transcript.segments.map((s) => ({
          start: s.start,
          duration: s.duration,
          text: s.text,
          source: "youtube_captions",
          translated_text: null,
          audio_path: null,
          audio_ms: null,
        }));

        setSegments(mapped);
        setLoading(false);
        console.log(`[useProcessedVideo] loaded ${mapped.length} caption segments`);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Transcript fetch failed.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [videoId]);

  return { segments, loading, error };
}
