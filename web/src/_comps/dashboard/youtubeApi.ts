export type YouTubePlayer = {
  destroy?: () => void
  getCurrentTime?: () => number
  getDuration?: () => number
  getPlaybackRate?: () => number
  getIframe?: () => HTMLIFrameElement
  mute?: () => void
  unMute?: () => void
  setVolume?: (volume: number) => void
  pauseVideo?: () => void
  playVideo?: () => void
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
  loadModule?: (module: string) => void
  unloadModule?: (module: string) => void
  setOption?: (module: string, option: string, value: unknown) => void
  getOption?: (module: string, option: string) => unknown
  getOptions?: (module?: string) => unknown
  setPlaybackQuality?: (quality: string) => void
  getPlaybackQuality?: () => string
  getAvailableQualityLevels?: () => string[]
}

export type YouTubeEvent = {
  data: number
  target: YouTubePlayer
}

export type YouTubeNamespace = {
  Player: new (
    element: HTMLDivElement,
    options: {
      videoId: string
      width: string
      height: string
      host?: string
      playerVars: Record<string, number | string>
      events: {
        onReady: (event: YouTubeEvent) => void
        onStateChange: (event: YouTubeEvent) => void
        onApiChange?: (event: YouTubeEvent) => void
      }
    },
  ) => YouTubePlayer
  PlayerState: { PLAYING: number }
}

declare global {
  interface Window {
    YT?: YouTubeNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YouTubeNamespace> | null = null

export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script")
      tag.src = "https://www.youtube.com/iframe_api"
      document.head.appendChild(tag)
    }
  })

  return apiPromise
}
