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
  voiceId: string,
  playbackRate: number = 1,
  volume: number = 100,
) {
  const [segments, setSegments] = useState<DubSegment[]>([])
  const [step, setStep] = useState<DubStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeIdxRef = useRef<number>(-1)
  const prevTimeRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  const blobUrlsRef = useRef<string[]>([])
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flushRef.current) clearTimeout(flushRef.current)
      audioRef.current?.pause()
      audioRef.current = null
      abortRef.current?.abort()
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  // Fetch transcript + stream translate/TTS when enabled or voice changes
  useEffect(() => {
    if (!videoId || !enabled) return

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
          { video_id: videoId, source_lang: transcript.source_lang, segments: transcript.segments, voice: voiceId },
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
              // First segment: flush immediately so playback can start without delay.
              // Subsequent segments: batch into a single render every 80ms.
              if (ttsCompleted === 1) {
                if (flushRef.current) clearTimeout(flushRef.current)
                setSegments([...built])
                setProgress({ done: 1, total: segTotal })
                setStep("tts")
              } else {
                setProgress({ done: ttsCompleted, total: segTotal })
                if (flushRef.current) clearTimeout(flushRef.current)
                flushRef.current = setTimeout(() => setSegments([...built]), 80)
              }
            },
            onDone: () => {
              if (controller.signal.aborted) return
              if (flushRef.current) clearTimeout(flushRef.current)
              setSegments([...built])
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
      if (flushRef.current) clearTimeout(flushRef.current)
    }
  }, [videoId, enabled, voiceId])

  // Clear everything when dub mode is turned off
  useEffect(() => {
    if (enabled) return
    abortRef.current?.abort()
    abortRef.current = null
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    setSegments([])
    setError(null)
    setProgress(null)
    setStep("idle")
  }, [enabled])

  // Sync playbackRate and volume to currently playing audio
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume / 100))
  }, [volume])

  // Sync audio to video playback time
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    // Detect seek: if time jumped more than 1.5s, force segment re-evaluation
    const jumped = Math.abs(currentTime - prevTimeRef.current) > 1.5
    prevTimeRef.current = currentTime
    if (jumped) {
      audioRef.current?.pause()
      audioRef.current = null
      activeIdxRef.current = -1
    }

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
        audio.volume = Math.max(0, Math.min(1, volume / 100))
        audio.playbackRate = playbackRate
        audio.onended = () => { if (audioRef.current === audio) audioRef.current = null }
        audioRef.current = audio
        audio.play().catch((e) => {
          console.warn("[DubAudio] play() blocked:", e)
          if (audioRef.current === audio) audioRef.current = null
        })
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
    audio.volume = Math.max(0, Math.min(1, volume / 100))
    audio.playbackRate = playbackRate
    audio.onended = () => { if (audioRef.current === audio) audioRef.current = null }
    audioRef.current = audio
    audio.play().catch((e) => {
      console.warn("[DubAudio] play() blocked:", e)
      if (audioRef.current === audio) audioRef.current = null
    })
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

  return { step, error, progress, segmentCount: segments.length, translatedSegments }
}
