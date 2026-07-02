"use client";

import { useMemo } from "react";
import type { Segment } from "@/lib/backend-api";

type SubtitlePaneProps = {
  segments: Segment[];
  currentTime: number; // seconds, from the YouTube player (player.time)
  loading?: boolean;
  error?: string;
  // User's dub-speed pref (1 = default, 2 = 2× faster, 0.5 = half). Only
  // affects the karaoke-style highlight so it stays in sync with the audio.
  dubSpeed?: number;
  // Live position of the currently-playing TTS audio. When provided AND the
  // active segment matches, the karaoke highlight follows the audio clock
  // exactly (word progress = audioTime / audioSeconds) instead of a
  // video-time-based estimate.
  audioProgress?: {
    segmentStart: number;
    audioTime: number;
    audioSeconds: number;
  } | null;
  // True when Mongolian dub is on. In dub mode the subtitle appears only while
  // the TTS voice is actively speaking a segment (audioProgress matches) —
  // silence between segments hides the line. In non-dub mode we fall back to
  // showing the line for its entire video-time window.
  dubActive?: boolean;
};

// Shows the single subtitle line whose [start, start + duration) window contains
// the current playback time. It re-evaluates on every player tick (~4x/sec), so
// the line switches automatically as the video plays. Words are lit up
// progressively so the user can see roughly where Azure TTS is currently reading
// (karaoke-style — approximate; Azure Speech doesn't return word timings, so we
// scale by the TTS audio length + fitRate + dubSpeed instead).
export function SubtitlePane({
  segments,
  currentTime,
  loading,
  error,
  dubSpeed = 1,
  audioProgress,
  dubActive = false,
}: SubtitlePaneProps) {
  const active = useMemo(() => {
    // Dub mode: the voice is the source of truth. Show the segment currently
    // being spoken (by audioProgress), NOT whatever the video time is inside.
    // Silence between voice segments → no subtitle.
    if (dubActive) {
      if (!audioProgress || audioProgress.audioSeconds <= 0) return null;
      const seg = segments.find(
        (s) => Math.abs(s.start - audioProgress.segmentStart) < 0.01,
      );
      if (!seg) return null;
      const text = seg.translated_text?.trim() || seg.text;
      if (!text) return null;
      const progress = Math.max(
        0,
        Math.min(1, audioProgress.audioTime / audioProgress.audioSeconds),
      );
      return { text, progress };
    }

    // Non-dub mode: subtitle tracks video time (original behaviour). Karaoke
    // highlight can still use audio-time when a TTS audio happens to line up
    // with this segment (fallback for the translate-only pipeline).
    const seg = segments.find(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    );
    if (!seg) return null;
    const text = seg.translated_text?.trim() || seg.text;
    if (!text) return null;

    const videoElapsed = currentTime - seg.start;
    const dur = Math.max(0.1, seg.duration);
    let progress: number;
    if (
      audioProgress &&
      audioProgress.audioSeconds > 0 &&
      Math.abs(audioProgress.segmentStart - seg.start) < 0.01
    ) {
      progress = Math.max(
        0,
        Math.min(1, audioProgress.audioTime / audioProgress.audioSeconds),
      );
    } else if (seg.audio_ms && seg.audio_ms > 0) {
      const audioSeconds = seg.audio_ms / 1000;
      const fitRate =
        audioSeconds > dur
          ? Math.min(1.35, Math.max(1, audioSeconds / dur))
          : 1;
      const audioElapsed = videoElapsed * dubSpeed * fitRate;
      progress = Math.max(0, Math.min(1, audioElapsed / audioSeconds));
    } else {
      progress = Math.max(0, Math.min(1, videoElapsed / dur));
    }
    return { text, progress };
  }, [segments, currentTime, dubSpeed, audioProgress, dubActive]);

  if (active) {
    // Once the karaoke has swept through every word (voice finished reading
    // this line), hide the subtitle so the video breathes for a moment before
    // the next segment appears — otherwise a fully-lit line lingers on screen
    // even though nothing is being spoken.
    if (active.progress >= 0.999) return null;

    // Split on whitespace while keeping the spaces so the rendered layout is
    // unchanged. Only word tokens are counted / highlighted.
    const tokens = active.text.split(/(\s+)/);
    const wordCount = tokens.filter((t) => t.trim().length > 0).length;
    const litCount = Math.min(wordCount, Math.ceil(active.progress * wordCount));
    let wordIdx = 0;
    return (
      <div className="dashboard-subtitle-pane">
        <p className="dashboard-subtitle-text">
          {tokens.map((token, i) => {
            if (!token.trim()) return <span key={i}>{token}</span>;
            const isRead = wordIdx < litCount;
            wordIdx++;
            return (
              <span
                key={i}
                className={`dashboard-subtitle-word${isRead ? " is-read" : ""}`}
              >
                {token}
              </span>
            );
          })}
        </p>
      </div>
    );
  }

  // No active line yet — surface load/error status instead of an empty bar.
  const status = error || (loading ? "Хадмал ачааллаж байна..." : "");
  if (!status) return null;

  return (
    <div className="dashboard-subtitle-pane">
      <p className="dashboard-subtitle-status">{status}</p>
    </div>
  );
}
