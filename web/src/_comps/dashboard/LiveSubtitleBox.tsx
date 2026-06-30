"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLiveTranslate, type LiveEngine } from "./useLiveTranslate"

type Props = {
  /** Called when dub audio starts/stops so the parent can duck YouTube volume */
  onDubActive: (active: boolean) => void
}

export function LiveSubtitleBox({ onDubActive }: Props) {
  const [engine, setEngine] = useState<LiveEngine>("gemini_azure")
  const [gender, setGender] = useState<"male" | "female">("female")

  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const nextStartRef = useRef<number>(0)   // scheduled playback cursor (seconds)
  const activeRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeWordRef = useRef<HTMLSpanElement>(null)

  // ── Audio playback (MP3 chunks via Web Audio API) ────────────────────────
  const playAudioChunk = useCallback(
    async (buffer: ArrayBuffer) => {
      if (!audioCtxRef.current) {
        const ctx = new AudioContext()
        const gain = ctx.createGain()
        gain.gain.value = 1
        gain.connect(ctx.destination)
        audioCtxRef.current = ctx
        gainRef.current = gain
      }

      const ctx = audioCtxRef.current
      const gain = gainRef.current!

      try {
        const decoded = await ctx.decodeAudioData(buffer.slice(0))
        const src = ctx.createBufferSource()
        src.buffer = decoded
        src.connect(gain)

        const now = ctx.currentTime
        const start = Math.max(now, nextStartRef.current)
        src.start(start)
        nextStartRef.current = start + decoded.duration

        if (!activeRef.current) {
          activeRef.current = true
          onDubActive(true)
        }

        src.onended = () => {
          // If this was the last queued buffer, signal silence
          if (nextStartRef.current <= ctx.currentTime + 0.05) {
            activeRef.current = false
            onDubActive(false)
          }
        }
      } catch {
        // Ignore decode errors (e.g. incomplete chunk at stream start)
      }
    },
    [onDubActive],
  )

  const { step, error, words, activeWordIndex, start, stop } = useLiveTranslate(
    engine,
    gender,
    playAudioChunk,
  )

  // ── Auto-scroll active word to center ────────────────────────────────────
  useEffect(() => {
    if (!activeWordRef.current || !containerRef.current) return
    activeWordRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    })
  }, [activeWordIndex])

  // ── Cleanup audio context on unmount ─────────────────────────────────────
  useEffect(
    () => () => {
      audioCtxRef.current?.close()
      stop()
    },
    [stop],
  )

  const handleToggle = () => {
    if (step === "idle" || step === "error") {
      void start()
    } else {
      stop()
      onDubActive(false)
    }
  }

  const running = step === "ready" || step === "connecting" || step === "capturing"

  return (
    <div className="live-subtitle-shell">
      {/* ── Control bar ─────────────────────────────────────────────── */}
      <div className="live-subtitle-controls">
        <select
          className="live-engine-select"
          value={engine}
          onChange={(e) => setEngine(e.target.value as LiveEngine)}
          disabled={running}
        >
          <option value="gemini_azure">
            Gemini 3.5 + Azure TTS (Өндөр чанар / Монгол дуу)
          </option>
          <option value="gemini_native">
            Gemini 3.5 Native Audio (Хамгийн бага саатал)
          </option>
        </select>

        <select
          className="live-gender-select"
          value={gender}
          onChange={(e) => setGender(e.target.value as "male" | "female")}
          disabled={running}
        >
          <option value="female">Эмэгтэй дуу</option>
          <option value="male">Эрэгтэй дуу</option>
        </select>

        <button
          className={`live-dub-toggle ${running ? "live-dub-toggle--on" : ""}`}
          onClick={handleToggle}
        >
          {step === "capturing"
            ? "Таб сонгож байна…"
            : step === "connecting"
              ? "Холбогдож байна…"
              : running
                ? "⏹ Монгол Дуб Унтраах"
                : "▶ Монгол Дуб Асаах"}
        </button>
      </div>

      {/* ── Status / error ──────────────────────────────────────────── */}
      {error && <p className="live-subtitle-error">{error}</p>}

      {/* ── Karaoke word display ─────────────────────────────────────── */}
      {words.length > 0 && (
        <div className="live-subtitle-karaoke" ref={containerRef}>
          {words.map((word, i) => {
            const cls =
              i < activeWordIndex
                ? "passed-word"
                : i === activeWordIndex
                  ? "active-reading"
                  : "upcoming-word"
            return (
              <span
                key={i}
                className={`karaoke-word ${cls}`}
                ref={i === activeWordIndex ? activeWordRef : undefined}
              >
                {word}{" "}
              </span>
            )
          })}
        </div>
      )}

      {running && words.length === 0 && (
        <div className="live-subtitle-waiting">
          Орчуулга хүлээж байна…
        </div>
      )}
    </div>
  )
}
