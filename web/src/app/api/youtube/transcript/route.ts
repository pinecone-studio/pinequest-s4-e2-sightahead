import type { NextRequest } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

// Fetches the YouTube transcript SERVER-SIDE on Vercel (different IP than the
// blocked Render backend, and same-origin to the browser so no CORS). The
// client then POSTs these segments to the backend /process for translate + TTS.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "[transcript-route]";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  console.log(`${LOG} ← request received`, {
    videoId,
    url: request.nextUrl.pathname + request.nextUrl.search,
  });

  if (!videoId) {
    console.warn(`${LOG} ✗ rejected: missing videoId`);
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    // youtube-transcript returns offset/duration in MILLISECONDS — convert to
    // seconds so they line up with the YouTube player's currentTime.
    const segments = raw.map((item) => ({
      start: item.offset / 1000,
      duration: item.duration / 1000,
      text: item.text,
    }));

    console.log(`${LOG} → responding 200`, {
      videoId,
      segmentCount: segments.length,
      tookMs: Date.now() - startedAt,
      firstSegment: segments[0] ?? null,
      lastSegment: segments.at(-1) ?? null,
    });

    return Response.json({ video_id: videoId, source_lang: "en", segments });
  } catch (error) {
    // Surface as much detail as possible: youtube-transcript throws typed
    // errors (disabled/unavailable/too-many-requests) with useful messages.
    const message = error instanceof Error ? error.message : "Transcript unavailable.";
    console.error(`${LOG} ✗ fetch failed`, {
      videoId,
      tookMs: Date.now() - startedAt,
      name: error instanceof Error ? error.name : typeof error,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json(
      { error: message, videoId, detail: error instanceof Error ? error.name : "UnknownError" },
      { status: 502 },
    );
  }
}
