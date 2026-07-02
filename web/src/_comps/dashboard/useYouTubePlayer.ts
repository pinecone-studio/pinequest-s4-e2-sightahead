"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { loadYouTubeApi, type YouTubeEvent, type YouTubePlayer } from "./youtubeApi"

// Aggressively strip YouTube's built-in captions. `unloadModule` handles the
// common case, but a quality switch or ad boundary can re-inject the module,
// and setting the caption `track` to an empty object also un-picks whatever
// language the user's account had defaulted to. All calls are wrapped in
// try/catch because the API silently throws when the module isn't loaded yet.
function killCaptions(player: YouTubePlayer | null): void {
  if (!player) return
  const modules = ["captions", "cc"]
  for (const mod of modules) {
    try { player.unloadModule?.(mod) } catch { /* module not loaded */ }
    try { player.setOption?.(mod, "track", {}) } catch { /* not supported */ }
    try { player.setOption?.(mod, "reload", false) } catch { /* not supported */ }
    try { player.setOption?.(mod, "fontSize", -1) } catch { /* not supported */ }
  }
}

const QUALITY_LABELS: Record<string, string> = {
  auto:     "Авто",
  hd2160:   "4K",
  hd1440:   "1440p",
  hd1080:   "1080p",
  hd720:    "720p",
  large:    "480p",
  medium:   "360p",
  small:    "240p",
  tiny:     "144p",
}

export { QUALITY_LABELS }

export function useYouTubePlayer(videoId: string, fallbackDuration = 0) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [quality, setQualityState] = useState<string>("auto")
  const [availableQualities, setAvailableQualities] = useState<string[]>([])
  const [ccEnabled, setCcEnabled] = useState(false)

  useEffect(() => {
    if (!videoId) {
      queueMicrotask(() => {
        setReady(false)
        setPlaying(false)
        setTime(0)
        setDuration(fallbackDuration)
        setQualityState("auto")
        setAvailableQualities([])
        setCcEnabled(false)
      })
      return
    }

    let mounted = true
    const pollId = setInterval(() => {
      if (!mounted) return
      const player = playerRef.current
      if (player?.getCurrentTime) setTime(player.getCurrentTime() || 0)
      if (player?.getPlaybackRate) setPlaybackRate(player.getPlaybackRate() || 1)
      if (player?.getPlaybackQuality) setQualityState(player.getPlaybackQuality() || "auto")
      // Safety net: YouTube can silently re-load its caption module (quality
      // switch, ad boundary, buffered chunk). Nuke it every tick so our own
      // karaoke overlay is the only text on screen.
      killCaptions(player)
    }, 250)

    loadYouTubeApi().then((YT) => {
      if (!mounted || !containerRef.current) return

      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          controls: 1,
          enablejsapi: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          hl: "en",
          cc_load_policy: 0,
          iv_load_policy: 3,
          // Disable YouTube's own fullscreen button — we render a custom one on
          // the wrapper so the subtitle overlay is included in fullscreen.
          fs: 0,
        },
        events: {
          onReady: (event: YouTubeEvent) => {
            if (!mounted) return
            setReady(true)
            setDuration(event.target.getDuration?.() || fallbackDuration)
            styleIframe(event.target.getIframe?.())
            killCaptions(event.target)
          },
          onStateChange: (event: YouTubeEvent) => {
            if (!mounted) return
            setPlaying(event.data === YT.PlayerState.PLAYING)
            setDuration(event.target.getDuration?.() || fallbackDuration)
            const avail = event.target.getAvailableQualityLevels?.() ?? []
            if (avail.length) setAvailableQualities(avail)
            killCaptions(event.target)
          },
          onApiChange: (event: YouTubeEvent) => {
            if (!mounted) return
            killCaptions(event.target)
          },
        },
      })
    })

    return () => {
      mounted = false
      clearInterval(pollId)
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [fallbackDuration, videoId])

  const play = useCallback(() => playerRef.current?.playVideo?.(), [])
  const pause = useCallback(() => playerRef.current?.pauseVideo?.(), [])
  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing])
  const seek = useCallback((value: number) => {
    playerRef.current?.seekTo?.(value, true)
    setTime(value)
  }, [])
  const mute = useCallback(() => playerRef.current?.mute?.(), [])
  const unMute = useCallback(() => playerRef.current?.unMute?.(), [])
  const setVolume = useCallback((vol: number) => playerRef.current?.setVolume?.(vol), [])

  const setQuality = useCallback((q: string) => {
    playerRef.current?.setPlaybackQuality?.(q)
    setQualityState(q)
  }, [])

  const toggleCC = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    setCcEnabled((prev) => {
      if (prev) {
        player.unloadModule?.("captions")
      } else {
        player.loadModule?.("captions")
      }
      return !prev
    })
  }, [])

  return {
    containerRef, ready, playing, time, duration, playbackRate,
    quality, availableQualities, ccEnabled,
    play, pause, toggle, seek, mute, unMute, setVolume, setQuality, toggleCC,
  }
}

function styleIframe(iframe?: HTMLIFrameElement) {
  if (!iframe) return
  iframe.style.position = "absolute"
  iframe.style.inset = "0"
  iframe.style.width = "100%"
  iframe.style.height = "100%"
  iframe.style.border = "0"
}
