"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchTranscript, streamProcess, base64ToBlobUrl, type StreamedSegment } from "@/lib/process-stream"
import { fetchCachedVideoTranscript, type Segment } from "@/lib/backend-api"

export type DubStep = "idle" | "fetching" | "translating" | "tts" | "ready" | "error"

type DubSegment = {
  start: number
  duration: number
  translatedText: string | null
  blobUrl: string | null
  audioMs: number
}

const MAX_OVERLAPPING_DUB_AUDIO = 2

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

  const activeAudiosRef = useRef<Map<number, HTMLAudioElement>>(new Map())
  const lastStartedIdxRef = useRef<number>(-1)
  const lastPlaybackTimeRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const blobUrlsRef = useRef<string[]>([])

  const stopAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.pause()
      audio.src = ""
    })
    activeAudiosRef.current.clear()
  }, [])

  const pruneOverlappingAudio = useCallback(() => {
    const entries = [...activeAudiosRef.current.entries()]
    while (entries.length > MAX_OVERLAPPING_DUB_AUDIO) {
      const [idx, audio] = entries.shift()!
      audio.pause()
      audio.src = ""
      activeAudiosRef.current.delete(idx)
    }
  }, [])

  useEffect(() => {
    return () => {
      stopAllAudio()
      abortRef.current?.abort()
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [stopAllAudio])

  // Fetch transcript + stream translate/TTS when enabled or gender changes
  useEffect(() => {
    if (!videoId || !enabled) return

    let active = true
    const controller = new AbortController()

    stopAllAudio()
    lastStartedIdxRef.current = -1
    lastPlaybackTimeRef.current = 0
    abortRef.current?.abort()
    abortRef.current = controller
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    queueMicrotask(() => {
      if (!active || controller.signal.aborted) return
      setSegments([])
      setError(null)
      setProgress(null)
      setStep("fetching")
    })

    void (async () => {
      try {
        const transcript =
          (await fetchCachedVideoTranscript(videoId).catch(() => null)) ??
          (await fetchTranscript(videoId))
        if (controller.signal.aborted) return

        if (!transcript.segments.length) {
          setError("No transcript available for this video.")
          setStep("error")
          return
        }

        const total = transcript.segments.length
        const built: DubSegment[] = []
        setStep("translating")
        setProgress({ done: 0, total })

        let ttsCompleted = 0

        await streamProcess(
          { video_id: videoId, source_lang: transcript.source_lang, segments: transcript.segments, gender },
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
                audioMs: seg.audio_ms,
              }
              setSegments(
                built
                  .filter(Boolean)
                  .sort((a, b) => a.start - b.start),
              )
              setProgress({ done: ttsCompleted, total: segTotal })
              if (index === 0) setStep("tts")
            },
            onDone: () => {
              if (controller.signal.aborted) return
              if (blobUrlsRef.current.length === 0) {
                setError("Azure TTS audio uusgej chadsangui. Backend credentials shalgana uu.")
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
        setError(err instanceof Error ? err.message : "Dub beldehed aldaa garlaa.")
        setStep("error")
        setProgress(null)
      }
    })()

    return () => {
      active = false
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [videoId, enabled, gender, stopAllAudio])

  // Clear everything when dub mode is turned off
  useEffect(() => {
    if (enabled) return
    let active = true
    abortRef.current?.abort()
    abortRef.current = null
    stopAllAudio()
    lastStartedIdxRef.current = -1
    lastPlaybackTimeRef.current = 0
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    queueMicrotask(() => {
      if (!active) return
      setSegments([])
      setError(null)
      setProgress(null)
      setStep("idle")
    })
    return () => {
      active = false
    }
  }, [enabled, stopAllAudio])

  // Apply playback rate changes to currently playing audio
  useEffect(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.playbackRate = playbackRate
    })
  }, [playbackRate])

  // Sync audio to video playback time
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    const jumped = Math.abs(currentTime - lastPlaybackTimeRef.current) > 1.5
    if (jumped) {
      stopAllAudio()
      lastStartedIdxRef.current = -1
    }
    lastPlaybackTimeRef.current = currentTime

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )

    // Between subtitle windows: let current audio finish, don't interrupt.
    if (idx === -1) return

    // Same segment already started for this playback pass; do not restart it.
    if (idx === lastStartedIdxRef.current) return

    const seg = segments[idx]
    if (!seg.blobUrl) return

    const audio = new Audio(seg.blobUrl)
    const offsetSeconds = Math.max(0, currentTime - seg.start)
    const audioSeconds = seg.audioMs > 0 ? seg.audioMs / 1000 : 0
    const targetSeconds = Math.max(0.1, seg.duration)
    const fitRate =
      audioSeconds > targetSeconds
        ? Math.min(1.35, Math.max(1, audioSeconds / targetSeconds))
        : 1

    try {
      audio.currentTime = offsetSeconds
    } catch {
      audio.currentTime = 0
    }
    audio.playbackRate = playbackRate * fitRate
    audio.onended = () => {
      activeAudiosRef.current.delete(idx)
    }

    activeAudiosRef.current.set(idx, audio)
    lastStartedIdxRef.current = idx
    pruneOverlappingAudio()
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
  }, [currentTime, segments, enabled, playbackRate, pruneOverlappingAudio, stopAllAudio])

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

  return { step, error, progress, segmentCount: segments.length, translatedSegments }
}
