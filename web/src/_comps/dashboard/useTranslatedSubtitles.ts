"use client";

import { useEffect, useRef, useState } from "react";
import type { Segment } from "@/lib/backend-api";
import {
  streamProcess,
  type StreamedSegment,
  type TranscriptSegment,
} from "@/lib/process-stream";

// Takes the already-fetched (RapidAPI) caption segments, sends them to the
// backend /process pipeline in TRANSLATE-ONLY mode (no TTS), and returns the
// same segments with `translated_text` filled in — for the SubtitlePane to show
// Mongolian instead of the original English. Audio dubbing stays in useDubAudio.
export function useTranslatedSubtitles(
  videoId: string,
  sourceSegments: Segment[],
  sourceLang: string = "en",
) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!videoId || sourceSegments.length === 0) {
      setSegments([]);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    const controller = new AbortController();
    setSegments([]);
    setError("");
    setLoading(true);

    // Pre-build the result array so translations can be placed by index as the
    // SSE stream delivers them (out-of-order delivery is fine).
    const built: Segment[] = sourceSegments.map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text,
      source: "youtube_captions",
      translated_text: null,
      audio_path: null,
      audio_ms: null,
      audio_b64: null,
    }));

    const payload: TranscriptSegment[] = sourceSegments.map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text,
    }));

    // Schedule a batched flush — debounced at 80ms so rapid SSE bursts (e.g.
    // all 40 segments of a batch arriving in <10ms) collapse into 1 re-render.
    const scheduleFlush = (snapshot: Segment[], immediate: boolean) => {
      if (flushRef.current) clearTimeout(flushRef.current);
      if (immediate) {
        setSegments([...snapshot]);
      } else {
        flushRef.current = setTimeout(() => setSegments([...snapshot]), 80);
      }
    };

    let received = 0;

    void streamProcess(
      { video_id: videoId, source_lang: sourceLang, segments: payload, tts: false },
      {
        onSegment: (seg: StreamedSegment, index: number) => {
          if (!active) return;
          if (index >= 0 && index < built.length) {
            built[index] = {
              ...built[index],
              translated_text: seg.translated_text || null,
            };
          }
          received++;
          // Flush immediately for the very first translated segment so the
          // subtitle pane appears without waiting for the debounce window.
          scheduleFlush(built, received === 1);
        },
        onDone: () => {
          if (!active) return;
          if (flushRef.current) clearTimeout(flushRef.current);
          setSegments([...built]);
          setLoading(false);
        },
        onError: (msg) => {
          if (!active) return;
          setError(msg);
          setLoading(false);
        },
      },
      controller.signal,
    ).catch((err) => {
      if (!active || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Translation failed.");
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
      if (flushRef.current) clearTimeout(flushRef.current);
    };
  }, [videoId, sourceSegments, sourceLang]);

  return { segments, loading, error };
}
