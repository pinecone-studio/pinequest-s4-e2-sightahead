"use client"

import { useEffect, useRef, useState } from "react"
import { fetchTranscript, streamProcess, base64ToBlobUrl, type StreamedSegment } from "@/lib/process-stream"
import type { Segment } from "@/lib/backend-api"

export type DubStep = "idle" | "fetching" | "translating" | "tts" | "ready" | "error"

type DubSegment = {
  start: number
  duration: number
  translatedText: string | null
  blobUrl: string | null
}

export function useDubAudio(
  videoId: string,
  currentTime: number,
  enabled: boolean,
  gender: "male" | "female",
  playbackRate: number = 1,
) {
  const [segments, setSegments] = useState<DubSegment[]>([])
  const [step, setStep] = useState<DubStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeIdxRef = useRef<number>(-1)
  const abortRef = useRef<AbortController | null>(null)
  const blobUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      abortRef.current?.abort()
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  // Build the dub in the BACKGROUND as soon as a video is selected (or the voice
  // changes) — independent of `enabled` — so the dub is ready (or already
  // streaming) the instant the user toggles it on. Playback and the reported
  // status stay gated on `enabled` (below), so the original audio keeps playing
  // and the UI stays quiet until the user actually switches to the dub.
  useEffect(() => {
    if (!videoId) return

    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
    abortRef.current?.abort()
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    setSegments([])
    setError(null)
    setProgress(null)
    setStep("fetching")

    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      try {
        const transcript = await fetchTranscript(videoId)
        if (controller.signal.aborted) return

        if (!transcript.segments.length) {
          setError("No transcript available for this video.")
          setStep("error")
          return
        }

        const total = transcript.segments.length
        const built: DubSegment[] = transcript.segments.map((s) => ({
          start: s.start,
          duration: s.duration,
          translatedText: null,
          blobUrl: null,
        }))
        setStep("translating")
        setProgress({ done: 0, total })

        let ttsCompleted = 0

        await streamProcess(
          { source_lang: transcript.source_lang, segments: transcript.segments, gender },
          {
            onSegment: (seg: StreamedSegment, index: number, segTotal: number) => {
              if (controller.signal.aborted) return
              const blobUrl = seg.audio_b64 ? base64ToBlobUrl(seg.audio_b64) : null
              if (blobUrl) blobUrlsRef.current.push(blobUrl)
              ttsCompleted++
              built[index] = {
                start: seg.offset,
                duration: seg.duration,
                translatedText: seg.translated_text ?? null,
                blobUrl,
              }
              setSegments([...built])
              setProgress({ done: ttsCompleted, total: segTotal })
              if (index === 0) setStep("tts")
            },
            onDone: () => {
              if (controller.signal.aborted) return
              if (blobUrlsRef.current.length === 0) {
                setError("Azure TTS audio үүсгэж чадсангүй. Backend credentials шалгана уу.")
                setStep("error")
              } else {
                setStep("ready")
              }
              setProgress(null)
            },
            onError: (msg: string) => {
              if (controller.signal.aborted) return
              setError(msg)
              setStep("error")
              setProgress(null)
            },
          },
          controller.signal,
        )
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Дуб бэлдэхэд алдаа гарлаа")
        setStep("error")
        setProgress(null)
      }
    })()

    return () => {
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [videoId, gender])

  // Pause (but DON'T discard) the dub when the user switches back to the original
  // audio, so re-enabling plays instantly from the already-built segments. The
  // background build is left running/complete and its blobs are kept alive.
  useEffect(() => {
    if (enabled) return
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
  }, [enabled])

  // Apply playback rate changes to currently playing audio
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // Sync audio to video playback time
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )

    // Between subtitle windows: let current audio finish, don't interrupt
    if (idx === -1) return

    if (idx === activeIdxRef.current) {
      // Same segment — audio is already playing or segment has no audio; either way do nothing
      if (!audioRef.current) {
        const seg = segments[idx]
        if (!seg.blobUrl) return
        const audio = new Audio(seg.blobUrl)
        audio.currentTime = 0
        audio.playbackRate = playbackRate
        audioRef.current = audio
        audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
      }
      return
    }

    // New segment — stop previous and start fresh
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = idx

    const seg = segments[idx]
    if (!seg.blobUrl) return

    const audio = new Audio(seg.blobUrl)
    audio.currentTime = 0
    audio.playbackRate = playbackRate
    audioRef.current = audio
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
  }, [currentTime, segments, enabled])

  // Build translated segments for SubtitlePane when dub mode is active
  const translatedSegments: Segment[] = segments
    .filter((s) => s.translatedText !== null)
    .map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.translatedText!,
      source: "youtube_captions" as const,
      translated_text: s.translatedText,
      audio_path: null,
      audio_ms: null,
      audio_b64: null,
    }))

  // Gate the reported status on `enabled`: while the dub builds silently in the
  // background (original audio playing), the UI shows nothing dub-related. The
  // instant the user toggles on, this reflects the real (often already "ready")
  // build state for an instant switch.
  return {
    step: enabled ? step : "idle",
    error: enabled ? error : null,
    progress: enabled ? progress : null,
    segmentCount: segments.length,
    translatedSegments,
  }
}
