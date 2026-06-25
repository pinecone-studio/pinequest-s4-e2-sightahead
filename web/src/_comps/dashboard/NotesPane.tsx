"use client"

import { QUILL_DARK } from "./cursors"
import type { Note } from "./data"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./NoteList"
import { NotesHeader } from "./NotesHeader"
import { ReviewPane } from "./ReviewPane"

type NotesPaneProps = {
  notes: Note[]
  draft: string
  currentTime: number
  mode: "write" | "review"
  justAdded: number | null
  onDraftChange: (value: string) => void
  onAddNote: () => void
  onSetMode: (mode: "write" | "review") => void
  onJump: (time: number) => void
  onOpenSummary: () => void
}

export function NotesPane({
  notes,
  draft,
  currentTime,
  mode,
  justAdded,
  onDraftChange,
  onAddNote,
  onSetMode,
  onJump,
  onOpenSummary,
}: NotesPaneProps) {
  const sorted = [...notes].sort((a, b) => a.time - b.time)
  const isWrite = mode === "write"

  return (
    <div className="dashboard-notes-pane">
      <div className="dashboard-paper" />
      <div className="dashboard-paper-light" />
      <div className="dashboard-notes-content" style={{ cursor: QUILL_DARK }}>
        <NotesHeader count={sorted.length} mode={mode} onSetMode={onSetMode} onOpenSummary={onOpenSummary} />
        {isWrite && <NoteEditor draft={draft} currentTime={currentTime} onDraftChange={onDraftChange} onAddNote={onAddNote} />}
        <div className="dashboard-scroll dashboard-notes-scroll">
          {isWrite ? (
            <div style={{ padding: "4px 32px 40px" }}>
              <NoteList notes={sorted} justAdded={justAdded} onJump={onJump} />
            </div>
          ) : (
            <ReviewPane notes={sorted} onJump={onJump} />
          )}
        </div>
      </div>
    </div>
  )
}
