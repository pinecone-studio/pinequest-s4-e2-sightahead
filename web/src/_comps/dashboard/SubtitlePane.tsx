"use client";

import { useMemo } from "react";
import type { Segment } from "@/lib/backend-api";

type SubtitlePaneProps = {
  segments: Segment[];
  currentTime: number; // seconds, from the YouTube player (player.time)
  loading?: boolean;
  error?: string;
};

// Shows the single subtitle line whose [start, start + duration) window contains
// the current playback time. It re-evaluates on every player tick (~4x/sec), so
// the line switches automatically as the video plays.
export function SubtitlePane({ segments, currentTime, loading, error }: SubtitlePaneProps) {
  const activeText = useMemo(() => {
    const active = segments.find(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    );
    if (!active) return "";
    // Prefer the Mongolian translation; fall back to the original caption.
    return active.translated_text?.trim() || active.text;
  }, [segments, currentTime]);

  if (activeText) {
    return (
      <div className="dashboard-subtitle-pane">
        <p className="dashboard-subtitle-text">{activeText}</p>
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
