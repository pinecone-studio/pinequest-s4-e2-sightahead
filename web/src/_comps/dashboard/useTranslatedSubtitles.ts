"use client";

import { useEffect, useRef, useState } from "react";
import {
  saveCachedVideoTranscript,
  TRANSLATION_CACHE_VERSION,
  type Segment,
} from "@/lib/backend-api";
import {
  streamProcess,
  type StreamedSegment,
  type TranscriptSegment,
} from "@/lib/process-stream";

export function useTranslatedSubtitles(
  videoId: string,
  sourceSegments: Segment[],
  sourceLang: string = "en",
  translationVersion: string | null = null,
) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!videoId || sourceSegments.length === 0) {
      queueMicrotask(() => {
        setSegments([]);
        setLoading(false);
        setError("");
      });
      return;
    }

    let active = true;
    const controller = new AbortController();
    const canReuseTranslatedText = translationVersion === TRANSLATION_CACHE_VERSION;
    const cachedSegments: Segment[] = canReuseTranslatedText
      ? sourceSegments
          .filter((segment) => segment.translated_text?.trim())
          .map((segment) => ({
            start: segment.start,
            duration: segment.duration,
            text: segment.text,
            source: "youtube_captions",
            translated_text: segment.translated_text,
            audio_path: null,
            audio_ms: null,
            audio_b64: null,
          }))
      : [];

    if (cachedSegments.length > 0 && cachedSegments.length === sourceSegments.length) {
      queueMicrotask(() => {
        if (!active) return;
        setSegments(cachedSegments);
        setError("");
        setLoading(false);
      });
      return () => {
        active = false;
        controller.abort();
      };
    }

    queueMicrotask(() => {
      if (!active) return;
      setSegments([]);
      setError("");
      setLoading(true);
    });

    const built: Segment[] = [];
    const payload: TranscriptSegment[] = sourceSegments.map((segment) => ({
      start: segment.start,
      duration: segment.duration,
      text: segment.text,
    }));

    const sortedBuilt = () => built.filter(Boolean).sort((a, b) => a.start - b.start);

    // Debounced flush: first segment fires immediately, subsequent ones batch at 80ms.
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
          built[index] = {
            start: seg.offset,
            duration: seg.duration,
            text: seg.text,
            source: "youtube_captions",
            translated_text: seg.translated_text || null,
            audio_path: null,
            audio_ms: null,
            audio_b64: null,
          };
          received++;
          scheduleFlush(sortedBuilt(), received === 1);
        },
        onDone: () => {
          if (!active) return;
          if (flushRef.current) clearTimeout(flushRef.current);
          const finalSegments = sortedBuilt();
          setSegments(finalSegments);
          setLoading(false);
          void saveCachedVideoTranscript({
            video_id: videoId,
            source_lang: sourceLang,
            translation_version: TRANSLATION_CACHE_VERSION,
            translation_mode: "subtitle",
            segments: finalSegments.map((segment) => ({
              start: segment.start,
              duration: segment.duration,
              text: segment.text,
              translated_text: segment.translated_text,
            })),
          }).catch((saveError) => {
            console.warn("Translated transcript cache save failed:", saveError);
          });
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
  }, [videoId, sourceSegments, sourceLang, translationVersion]);

  return { segments, loading, error };
}
