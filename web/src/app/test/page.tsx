"use client";

import { useCallback, useState } from "react";

// Standalone diagnostic page (no auth) at /test.
// Goal: find out whether YouTube blocks transcript fetching, two ways:
//   A) SERVER route  → /api/youtube/transcript  (runs on Vercel's IP — the
//      datacenter IP that tends to get blocked; this is the real pipeline path)
//   B) DIRECT fetch  → https://www.youtube.com/watch?v=...  from the browser
//      (the extension-style residential-IP approach; from a normal web page
//      this usually fails CORS, which itself is the answer for "can a website
//      do this without an extension?")

type Segment = { start: number; duration: number; text: string };

type RunResult = {
  attempt: number;
  ok: boolean;
  status: number;
  tookMs: number;
  segmentCount: number;
  error?: string;
  detail?: string;
  sample?: Segment[];
};

type Mode = "server" | "direct";

// Accepts a raw 11-char ID or any common YouTube URL shape.
function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const v = url.searchParams.get("v");
    if (v) return v;
    // youtu.be/<id> or /shorts/<id> or /embed/<id>
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    // not a URL — fall through
  }
  return null;
}

// A) Hit our own Vercel API route (server-side youtube-transcript fetch).
async function fetchViaServer(videoId: string, attempt: number): Promise<RunResult> {
  const startedAt = performance.now();
  try {
    const res = await fetch(`/api/youtube/transcript?videoId=${encodeURIComponent(videoId)}`);
    const tookMs = Math.round(performance.now() - startedAt);
    const body = (await res.json().catch(() => null)) as
      | { segments?: Segment[]; error?: string; detail?: string }
      | null;

    return {
      attempt,
      ok: res.ok,
      status: res.status,
      tookMs,
      segmentCount: body?.segments?.length ?? 0,
      error: body?.error,
      detail: body?.detail,
      sample: body?.segments?.slice(0, 3),
    };
  } catch (err) {
    return {
      attempt,
      ok: false,
      status: 0,
      tookMs: Math.round(performance.now() - startedAt),
      segmentCount: 0,
      error: err instanceof Error ? err.message : String(err),
      detail: "NetworkError",
    };
  }
}

// B) Direct browser fetch to youtube.com (your original test/page.js snippet).
// Expect this to throw on CORS from a normal page — that result is informative.
async function fetchDirect(videoId: string, attempt: number): Promise<RunResult> {
  const startedAt = performance.now();
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const tookMs = Math.round(performance.now() - startedAt);
    const html = await res.text();
    // Use [\s\S] instead of the `s` (dotAll) flag — the project's TS target
    // predates es2018, and youtube-transcript's blob spans newlines.
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    const tracks = match
      ? JSON.parse(match[1])?.captions?.playerCaptionsTracklistRenderer?.captionTracks
      : null;

    return {
      attempt,
      ok: res.ok && !!tracks?.length,
      status: res.status,
      tookMs,
      segmentCount: tracks?.length ?? 0,
      error: tracks?.length
        ? undefined
        : "Page fetched but no caption tracks found in ytInitialPlayerResponse.",
      detail: tracks?.[0]?.baseUrl ? `baseUrl: ${tracks[0].baseUrl}` : "NoTracks",
    };
  } catch (err) {
    // Almost always a CORS / network failure from a normal web page.
    return {
      attempt,
      ok: false,
      status: 0,
      tookMs: Math.round(performance.now() - startedAt),
      segmentCount: 0,
      error: err instanceof Error ? err.message : String(err),
      detail: "CORS/NetworkError (expected from a website — needs the extension)",
    };
  }
}

export default function TestTranscriptPage() {
  const [input, setInput] = useState("dQw4w9WgXcQ");
  const [mode, setMode] = useState<Mode>("server");
  const [runs, setRuns] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);

  const run = useCallback(async () => {
    const videoId = extractVideoId(input);
    if (!videoId) {
      setResults([
        {
          attempt: 1,
          ok: false,
          status: 0,
          tookMs: 0,
          segmentCount: 0,
          error: "Could not parse a video ID from that input.",
          detail: "BadInput",
        },
      ]);
      return;
    }

    setBusy(true);
    setResults([]);
    const fetchOnce = mode === "server" ? fetchViaServer : fetchDirect;
    const collected: RunResult[] = [];
    for (let i = 1; i <= runs; i++) {
      const r = await fetchOnce(videoId, i);
      collected.push(r);
      setResults([...collected]); // update live as each attempt completes
      if (delayMs > 0 && i < runs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    setBusy(false);
  }, [input, mode, runs, delayMs]);

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-mono">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-xl font-bold">Transcript Block Tester</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Check whether YouTube blocks transcript fetching. Compare the{" "}
            <b>server</b> route (Vercel IP) against a <b>direct</b> browser fetch.
          </p>
        </header>

        <section className="space-y-3 bg-zinc-900 rounded-lg p-4">
          <div className="flex gap-2">
            {(["server", "direct"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1.5 text-sm ${
                  mode === m ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {m === "server" ? "A · Server route" : "B · Direct youtube.com"}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {mode === "server"
              ? "GET /api/youtube/transcript — runs on Vercel's datacenter IP (the real pipeline path)."
              : "fetch('https://www.youtube.com/watch?v=…') from the browser — expect CORS failure from a website."}
          </p>

          <label className="block text-sm">
            <span className="text-zinc-400">YouTube URL or video ID</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=… or 11-char ID"
              className="mt-1 w-full rounded bg-zinc-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="text-sm">
              <span className="text-zinc-400">Runs</span>
              <input
                type="number"
                min={1}
                max={50}
                value={runs}
                onChange={(e) => setRuns(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="mt-1 w-20 rounded bg-zinc-800 px-3 py-2 outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="text-zinc-400">Delay between runs (ms)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-28 rounded bg-zinc-800 px-3 py-2 outline-none"
              />
            </label>
          </div>

          <button
            onClick={run}
            disabled={busy}
            className="rounded bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Running…" : `Run ${runs} request${runs > 1 ? "s" : ""}`}
          </button>
        </section>

        {results.length > 0 && (
          <section className="space-y-3">
            <div className="text-sm text-zinc-400">
              <span className="text-green-400">{okCount} ok</span> ·{" "}
              <span className="text-red-400">{failCount} failed</span> · {results.length}/{runs}{" "}
              done
            </div>

            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.attempt}
                  className={`rounded-lg p-3 text-sm border ${
                    r.ok ? "border-green-800 bg-green-950/40" : "border-red-800 bg-red-950/40"
                  }`}
                >
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="text-zinc-400">#{r.attempt}</span>
                    <span className={r.ok ? "text-green-400" : "text-red-400"}>
                      HTTP {r.status || "—"}
                    </span>
                    <span>{r.tookMs} ms</span>
                    <span>
                      {r.segmentCount} {mode === "server" ? "segments" : "tracks"}
                    </span>
                  </div>

                  {!r.ok && (
                    <div className="mt-2 text-red-300 break-all">
                      <div>
                        <span className="text-zinc-500">error:</span> {r.error}
                      </div>
                      {r.detail && (
                        <div>
                          <span className="text-zinc-500">detail:</span> {r.detail}
                        </div>
                      )}
                    </div>
                  )}

                  {r.ok && r.detail && mode === "direct" && (
                    <div className="mt-2 text-zinc-300 break-all">{r.detail}</div>
                  )}

                  {r.ok && r.sample && r.sample.length > 0 && (
                    <ul className="mt-2 text-zinc-300 space-y-0.5">
                      {r.sample.map((s, i) => (
                        <li key={i}>
                          <span className="text-zinc-500">[{s.start.toFixed(1)}s]</span> {s.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-zinc-600">
          Reading results: a YouTube block on the <b>server</b> route usually shows as HTTP 502
          with a detail like &quot;TooManyRequests&quot; / &quot;TranscriptsDisabled&quot;, or
          failures that only appear after several rapid runs. The <b>direct</b> mode failing with
          a CORS error is expected from a website — that&apos;s exactly why the browser extension
          (residential IP, no CORS) exists.
        </p>
      </div>
    </main>
  );
}
