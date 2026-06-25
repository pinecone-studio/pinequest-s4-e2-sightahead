"use client"

import type { RefObject } from "react"
import { FALLBACK_DURATION, SOURCE_LINE, type Cue, type Note } from "./data"
import { VideoFrame } from "./VideoFrame"

type VideoPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  playing: boolean
  time: number
  duration: number
  toggle: () => void
  seek: (time: number) => void
  cues: Cue[]
  notes: Note[]
  showEnglish: boolean
  title: string
  speaker: string
  sourceLine?: string
}

export function VideoPane(props: VideoPaneProps) {
  const duration = props.duration || FALLBACK_DURATION
  const sortedNotes = [...props.notes].sort((a, b) => a.time - b.time)

  return (
    <section className="dashboard-video-pane">
      <div className="dashboard-video-meta">
        <span>{props.speaker}</span>
        <span />
        <span>{props.sourceLine ?? SOURCE_LINE}</span>
      </div>
      <h1>{props.title}</h1>
      <VideoFrame
        containerRef={props.containerRef}
        ready={props.ready}
        playing={props.playing}
        time={props.time}
        duration={duration}
        cues={props.cues}
        notes={sortedNotes}
        showEnglish={props.showEnglish}
        onToggle={props.toggle}
        onSeek={props.seek}
      />
      <div className="dashboard-saved-header">
        <span>ХАДГАЛСАН АГШИН</span>
        <span />
        <span>{sortedNotes.length} тэмдэглэгээ</span>
      </div>
    </section>
  )
}
