"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type LiveEngine = "gemini_azure" | "gemini_native"
export type LiveStep =
  | "idle"
  | "capturing"   // requesting tab audio
  | "connecting"  // WS handshake
  | "ready"       // translating live
  | "error"

export type WordEvent = {
  word: string
  offsetMs: number
  durationMs: number
}

export type UseLiveTranslateReturn = {
  step: LiveStep
  error: string | null
  words: string[]           // full translated word list so far
  activeWordIndex: number   // index currently being spoken
  start: () => Promise<void>
  stop: () => void
}

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000")
    .replace(/^http/, "ws")
    .replace(/\/$/, "")

export function useLiveTranslate(
  engine: LiveEngine,
  gender: "male" | "female",
  onAudioChunk: (pcmOrMp3: ArrayBuffer) => void,
): UseLiveTranslateReturn {
  const [step, setStep] = useState<LiveStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [words, setWords] = useState<string[]>([])
  const [activeWordIndex, setActiveWordIndex] = useState(-1)

  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const wordTimelineRef = useRef<WordEvent[]>([])   // absolute ms since start
  const startTimeRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  // Advance the active word index using requestAnimationFrame + word timeline
  const tickKaraoke = useCallback(() => {
    const elapsed = performance.now() - startTimeRef.current
    const timeline = wordTimelineRef.current
    let idx = -1
    for (let i = 0; i < timeline.length; i++) {
      if (elapsed >= timeline[i].offsetMs) idx = i
      else break
    }
    setActiveWordIndex(idx)
    rafRef.current = requestAnimationFrame(tickKaraoke)
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    wsRef.current?.close()
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    wordTimelineRef.current = []
    setStep("idle")
    setWords([])
    setActiveWordIndex(-1)
  }, [])

  const start = useCallback(async () => {
    stop()
    setError(null)
    setStep("capturing")

    // 1. Capture tab audio via getDisplayMedia.
    // Chrome requires video:true; we request minimal 1×1 video and discard it.
    // User must select "Chrome Tab" and tick "Share tab audio" in the dialog.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: true,
        // Chrome 105+: prefer system/tab audio over microphone
        ...(({ systemAudio: "include" }) as object),
      } as MediaStreamConstraints)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
        setError(
          'Цонх сонгоогүй эсвэл "Share tab audio" тэмдэглэгээгүй байна. ' +
          "Дахин дарж, Chrome Tab → Share tab audio-г идэвхжүүлнэ үү.",
        )
      } else {
        setError(`Аудио capture алдаа: ${msg}`)
      }
      setStep("error")
      return
    }

    // Drop the video track — we only need audio
    stream.getVideoTracks().forEach((t) => t.stop())

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) {
      setError(
        '"Share tab audio" сонгоогүй байна. ' +
        "Chrome Tab сонгохдоо доор байгаа 'Share tab audio' checkbox-г тэмдэглэнэ үү.",
      )
      setStep("error")
      return
    }
    streamRef.current = stream
    audioTrack.addEventListener("ended", stop)

    // 2. Resample to 16 kHz PCM via AudioWorklet
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioCtxRef.current = ctx

    await ctx.audioWorklet.addModule(
      "data:application/javascript," +
      encodeURIComponent(`
        class PcmCapture extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (ch) {
              const i16 = new Int16Array(ch.length);
              for (let i = 0; i < ch.length; i++)
                i16[i] = Math.max(-32768, Math.min(32767, ch[i] * 32768));
              this.port.postMessage(i16.buffer, [i16.buffer]);
            }
            return true;
          }
        }
        registerProcessor("pcm-capture", PcmCapture);
      `),
    )

    const src = ctx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(ctx, "pcm-capture")
    src.connect(worklet)

    // 3. Open backend WebSocket
    setStep("connecting")
    const ws = new WebSocket(`${WS_BASE}/ws/live-translate`)
    wsRef.current = ws

    ws.binaryType = "arraybuffer"

    ws.onopen = () => {
      ws.send(JSON.stringify({ engine, gender, target_lang: "mn" }))
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data) as {
          type: string
          message?: string
          text?: string
          word?: string
          offsetMs?: number
          durationMs?: number
        }

        if (msg.type === "ready") {
          setStep("ready")
          startTimeRef.current = performance.now()
          rafRef.current = requestAnimationFrame(tickKaraoke)

          // Start sending audio chunks once backend is ready
          worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(e.data)
            }
          }
        } else if (msg.type === "text" && msg.text) {
          // Append new words from translated text chunk
          const incoming = msg.text.trim().split(/\s+/).filter(Boolean)
          setWords((prev) => [...prev, ...incoming])
        } else if (msg.type === "word" && msg.word !== undefined) {
          // Track word boundaries from Azure TTS for karaoke timing
          const currentCursorMs =
            wordTimelineRef.current.length > 0
              ? wordTimelineRef.current[wordTimelineRef.current.length - 1].offsetMs +
                wordTimelineRef.current[wordTimelineRef.current.length - 1].durationMs
              : 0
          wordTimelineRef.current.push({
            word: msg.word,
            offsetMs: currentCursorMs + (msg.offsetMs ?? 0),
            durationMs: msg.durationMs ?? 200,
          })
        } else if (msg.type === "error") {
          setError(msg.message ?? "Алдаа гарлаа")
          setStep("error")
          stop()
        }
      } else if (ev.data instanceof ArrayBuffer) {
        // Binary: 0x01 prefix + audio bytes
        const view = new Uint8Array(ev.data)
        if (view[0] === 0x01) {
          onAudioChunk(ev.data.slice(1))
        }
      }
    }

    ws.onerror = () => {
      setError("WebSocket холболт тасарлаа")
      setStep("error")
    }

    ws.onclose = () => {
      if (step !== "error") setStep("idle")
    }
  }, [engine, gender, onAudioChunk, stop, tickKaraoke])

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop])

  return { step, error, words, activeWordIndex, start, stop }
}
