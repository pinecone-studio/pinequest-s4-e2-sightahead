import type { NextRequest } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

// Fetches the YouTube transcript SERVER-SIDE on Vercel (different IP than the
// blocked Render backend, and same-origin to the browser so no CORS). The
// client then POSTs these segments to the backend /process for translate + TTS.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  if (!videoId) {
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }

  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    // youtube-transcript returns offset/duration in MILLISECONDS — convert to
    // seconds so they line up with the YouTube player's currentTime.
    const segments = raw.map((item) => ({
      start: item.offset / 1000,
      duration: item.duration / 1000,
      text: item.text,
    }));

    return Response.json({ video_id: videoId, source_lang: "en", segments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript unavailable.";
    return Response.json({ error: message }, { status: 502 });
  }
}
