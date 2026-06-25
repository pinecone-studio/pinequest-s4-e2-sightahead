"use client"

import type { RefObject } from "react"
import type { Cue, Note } from "./data"
import { VideoControls } from "./VideoControls"

type VideoFrameProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  playing: boolean
  time: number
  duration: number
  cues: Cue[]
  notes: Note[]
  showEnglish: boolean
  onToggle: () => void
  onSeek: (time: number) => void
}

export function VideoFrame({
  containerRef,
  ready,
  playing,
  time,
  duration,
  cues,
  notes,
  showEnglish,
  onToggle,
  onSeek,
}: VideoFrameProps) {
  // Идэвхтэй хадмал — backend-ээс ирсэн жинхэнэ segment-үүдээс одоогийн цагт тааруулна.
  const cue = cues.length > 0
    ? [...cues].reverse().find((item) => item.start <= time) ?? cues[0]
    : null

  return (
    <div className="dashboard-video-frame">
      <div ref={containerRef} className="dashboard-youtube-container" />
      {!ready && <div className="dashboard-video-loading">АЧААЛЛАЖ БАЙНА...</div>}
      <div className="dashboard-video-grid" />
      <div className="dashboard-live-caption">
        <span />
        АМЬД ОРЧУУЛГА
      </div>
      <div className="dashboard-caption-panel">
        {cue && (
          <div key={cue.start} className="dashboard-cue">
            {showEnglish && cue.en && <div className="dashboard-cue-en">{cue.en}</div>}
            <div className="dashboard-cue-mn">{cue.mn}</div>
          </div>
        )}
        <VideoControls
          playing={playing}
          time={time}
          duration={duration}
          notes={notes}
          onToggle={onToggle}
          onSeek={onSeek}
        />
      </div>
    </div>
  )
}
