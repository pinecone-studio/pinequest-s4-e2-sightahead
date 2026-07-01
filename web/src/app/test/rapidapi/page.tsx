"use client";

// Small test page: hit the RapidAPI YouTube transcript scraper with a pasted
// URL and dump the raw response. (Test only — key is inline on purpose.)

import { useState } from "react";

// New provider: youtube-transcriptor — GET with the video_id as a query param.
const API_HOST = process.env.RAPID_API_HOST;
const API_KEY = process.env.RAPID_API_KEY;

// This provider takes video_id (not a URL), so pull the 11-char ID out of
// whatever the user pasted (full URL, youtu.be, shorts, or a raw ID).
function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get("v");
    if (v) return v;
    const last = u.pathname.split("/").filter(Boolean).at(-1);
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    // not a URL — fall through
  }
  return null;
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!url.trim()) {
      setError("Paste a YouTube URL first");
      return;
    }
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError("Could not parse a video ID from that input");
      return;
    }
    setLoading(true);
    setError("");
    setTranscript("");
    try {
      const endpoint = `https://${API_HOST}/transcript?video_id=${encodeURIComponent(
        videoId,
      )}&lang=en`;
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": API_HOST,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      // Pretty-print if it's JSON, otherwise show raw text.
      try {
        setTranscript(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setTranscript(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-screen h-screen p-10 flex flex-col gap-5">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="yt url paste"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded border px-4 py-2 hover:bg-slate-400/50 disabled:opacity-50"
          onClick={run}
          disabled={loading}
        >
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-xs text-zinc-100">
        {transcript || "No transcript yet."}
      </pre>
    </div>
  );
}
