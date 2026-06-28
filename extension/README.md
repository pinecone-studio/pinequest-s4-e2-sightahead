# SightAhead Chrome Extension

Live Mongolian subtitles for YouTube. Instead of fetching caption tracks
(brittle, blocked from datacenter IPs), it **reads the captions YouTube
already paints on screen** with a `MutationObserver`, translates each line
through the backend, and overlays the Mongolian.

## Setup (takes 30 seconds)

1. Open Chrome → navigate to `chrome://extensions/`
2. Toggle **Developer mode** (top right corner)
3. Click **Load unpacked** → select this folder
4. Open any YouTube video → you should see a "🇲🇳 Монгол хадмал: OFF" button.
   Click it to turn on live translated subtitles.

## How the live-subtitle flow works

1. `content.js` ensures YouTube captions are on, then observes the player
   for changes to `.ytp-caption-segment` nodes.
2. Each line is debounced (so rolling auto-captions settle), deduped, and
   sent to `background.js`.
3. `background.js` POSTs it to the backend `POST /translate`
   (`{ text, source_lang, target_lang }` → `{ translated }`), caching repeats.
4. `content.js` paints the Mongolian into an overlay inside the player
   (visible in fullscreen). Native English captions are hidden via CSS.

**Tradeoff:** this is a live read, so the Mongolian line lands a beat after
the caption appears (one translation round-trip). No video plays ahead /
pre-buffering is done — keep `SETTLE_MS` low for snappier, higher for fewer
calls on word-by-word auto-captions.

## Configuration

- `background.js` `BACKEND_URL` — your backend origin. The same value must be
  listed in `manifest.json` `host_permissions` (so the worker can fetch it
  without CORS). Both the Render URL and `localhost:8000` are pre-listed.

## Dubbing (separate, legacy flow)

The "dub" path (`FETCH_CAPTIONS` / `TRANSLATE_AND_DUB` in `background.js`,
`/api/dub` on the backend) still exists but relies on caption-track scraping.
The live-subtitle flow above is the recommended path.

Your backend needs a `POST /api/dub` endpoint that accepts:
```json
{
  "video_id": "dQw4w9WgXcQ",
  "segments": [
    { "start": 0.0, "duration": 2.5, "text": "Hello world" },
    { "start": 2.5, "duration": 3.0, "text": "This is a test" }
  ]
}
```

And returns:
```json
{
  "audio_url": "https://your-storage.com/dubbed-audio.mp3"
}
```

## Debugging

- Extension console: `chrome://extensions/` → click "Inspect views: service worker" on your extension card
- Content script console: normal browser DevTools (F12) on the YouTube tab, look for `[SightAhead]` logs

## File overview

- `manifest.json` — tells Chrome what the extension does and what permissions it needs
- `background.js` — fetches captions from YouTube, sends to backend (runs headlessly, no DOM)
- `content.js` — injects UI into YouTube page, orchestrates the flow
- `content.css` — styles for the injected button
