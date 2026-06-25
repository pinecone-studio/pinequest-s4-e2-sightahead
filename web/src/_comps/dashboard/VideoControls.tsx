"use client"

import type { MouseEvent } from "react"
import type { Note } from "./data"
import { fmtTime } from "./time"

type VideoControlsProps = {
  playing: boolean
  time: number
  duration: number
  notes: Note[]
  onToggle: () => void
  onSeek: (time: number) => void
}

export function VideoControls({ playing, time, duration, notes, onToggle, onSeek }: VideoControlsProps) {
  const progress = `${Math.min(100, (time / duration) * 100)}%`

  function onScrub(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    onSeek(Math.round(((event.clientX - rect.left) / rect.width) * duration))
  }

  return (
    <div className="dashboard-video-controls">
      <button onClick={onToggle} aria-label={playing ? "Түр зогсоох" : "Тоглуулах"} className="dashboard-play-button">
        {playing ? (
          <span className="dashboard-pause-icon">
            <span />
            <span />
          </span>
        ) : (
          <svg width="14" height="16" viewBox="0 0 14 16" style={{ marginLeft: 2 }} aria-hidden="true">
            <polygon points="1,1 13,8 1,15" fill="#18211C" />
          </svg>
        )}
      </button>
      <span className="dashboard-time-now">{fmtTime(time)}</span>
      <div onClick={onScrub} className="dashboard-scrubber">
        <div className="dashboard-scrubber-fill" style={{ width: progress }} />
        {notes.map((note) => (
          <div
            key={note.id}
            title={fmtTime(note.time)}
            className="dashboard-note-marker"
            style={{ left: `${(note.time / duration) * 100}%` }}
          />
        ))}
        <div className="dashboard-scrubber-handle" style={{ left: progress }} />
      </div>
      <span className="dashboard-time-total">{fmtTime(duration)}</span>
    </div>
  )
}
