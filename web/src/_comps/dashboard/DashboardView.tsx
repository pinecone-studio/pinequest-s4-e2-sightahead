"use client";

import { useEffect, useMemo, useState } from "react";
import { AmbientBackground } from "@/_comps/dashboard/AmbientBackground";
import { QUILL_LIGHT } from "@/_comps/dashboard/cursors";
import {
  buildScholarReply,
  FALLBACK_DURATION,
  HISTORY,
  type Cue,
  type HistoryItem,
  type Note,
} from "@/_comps/dashboard/data";
import { HistoryRail } from "@/_comps/dashboard/HistoryRail";
import { NotesPane } from "@/_comps/dashboard/NotesPane";
import { ScholarOverlay } from "@/_comps/dashboard/ScholarOverlay";
import { DashboardHeader } from "@/_comps/dashboard/DashboardHeader";
import { useYouTubePlayer } from "@/_comps/dashboard/useYouTubePlayer";
import { VideoPane } from "@/_comps/dashboard/VideoPane";
import { processVideo, type Segment } from "@/lib/backend-api";

function toCues(segments: Segment[]): Cue[] {
  return segments.map((s) => ({
    start: s.start,
    en: s.text,
    mn: s.translated_text ?? s.text,
  }));
}

export default function DashboardView({
  videoUrl,
  onBack,
  onSearch,
  onLogout,
}: {
  videoUrl: string;
  onBack: () => void;
  onSearch?: (url: string) => void;
  onLogout?: () => void;
}) {
  const videoId = videoUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1] ?? "";

  // ----- Backend data (жинхэнэ business logic — хэвээр) -----
  // Backend hadmal татаж чадахгүй байсан ч dashboard бүрэн харагдана —
  // алдаа гарвал зүгээр backend хадмал/дуб дутуу болохоос UI унахгүй.
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!videoId) return;
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const result = await processVideo(videoId);
        if (active) setSegments(result.segments);
      } catch (err) {
        // Backend ажиллахгүй байсан ч видео тоглуулагч + UI ажиллаж байх ёстой.
        // console.warn ашиглана — console.error нь Next dev улаан overlay өдөөдөг.
        console.warn("processVideo татаж чадсангүй (backend хадмал алгасав):", err);
        if (active) setSegments([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [videoId]);

  const cues = useMemo(() => toCues(segments), [segments]);
  const segmentDuration =
    segments.length > 0 ? segments[segments.length - 1].start + segments[segments.length - 1].duration : FALLBACK_DURATION;

  // ----- Жинхэнэ YouTube тоглуулагч (цаг/төлөв хадмалтай ижилтгэнэ) -----
  const player = useYouTubePlayer(videoId, segmentDuration);

  // ----- Notes / Scholar — local-only UI -----
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"write" | "review">("write");
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [showEnglish, setShowEnglish] = useState(true);
  const [query, setQuery] = useState("");
  const reply = useMemo(() => buildScholarReply(notes), [notes]);

  function addNote() {
    const text = draft.trim();
    if (!text) return;
    const id = Date.now();
    setNotes((previous) => [...previous, { id, time: Math.floor(player.time), text }]);
    setDraft("");
    setJustAdded(id);
  }

  // ----- Session history: жишээ түүх + одоо тоглож буй бичлэг -----
  const historyItems = useMemo<HistoryItem[]>(() => {
    if (!videoId || HISTORY.some((h) => h.id === videoId)) return HISTORY;
    return [{ id: videoId, title: "YouTube бичлэг", speaker: "", progress: 0, notes: 0 }, ...HISTORY];
  }, [videoId]);

  const activeItem = historyItems.find((h) => h.id === videoId);
  const title = activeItem?.title ?? "YouTube бичлэг";
  const speaker = activeItem?.speaker ?? "";

  function selectHistory(item: HistoryItem) {
    setSummaryOpen(false);
    if (item.id === videoId) return;
    onSearch?.(`https://www.youtube.com/watch?v=${item.id}`);
  }

  function submitSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    const directId = trimmed.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1] ?? trimmed;
    onSearch?.(`https://www.youtube.com/watch?v=${directId}`);
  }

  return (
    <div className="dashboard-app-shell" style={{ cursor: QUILL_LIGHT }}>
      <AmbientBackground />
      <DashboardHeader
        query={query}
        showEnglish={showEnglish}
        onQueryChange={setQuery}
        onToggleEnglish={() => setShowEnglish((value) => !value)}
        onSubmit={submitSearch}
        onBack={onBack}
        onLogout={onLogout}
      />
      <div className="dashboard-layout">
        <HistoryRail items={historyItems} activeId={videoId} onSelect={selectHistory} />
        <VideoPane
          containerRef={player.containerRef}
          ready={player.ready}
          playing={player.playing}
          time={player.time}
          duration={player.duration}
          toggle={player.toggle}
          seek={player.seek}
          cues={cues}
          notes={notes}
          showEnglish={showEnglish}
          title={title}
          speaker={speaker}
          sourceLine={isLoading ? "ХАДМАЛ БЭЛТГЭЖ БАЙНА..." : undefined}
        />
        <NotesPane
          notes={notes}
          draft={draft}
          currentTime={player.time}
          mode={mode}
          justAdded={justAdded}
          onDraftChange={setDraft}
          onAddNote={addNote}
          onSetMode={setMode}
          onJump={player.seek}
          onOpenSummary={() => setSummaryOpen(true)}
        />
      </div>
      <ScholarOverlay open={summaryOpen} reply={reply} onClose={() => setSummaryOpen(false)} />
    </div>
  );
}
