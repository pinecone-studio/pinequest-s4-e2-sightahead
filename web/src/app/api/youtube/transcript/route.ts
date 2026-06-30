import type { NextRequest } from "next/server";
import { fetchCaptions } from "@/lib/captions";
import { fetchRapidTranscript } from "@/lib/rapid-transcript";

// Fetches the transcript SERVER-SIDE.
//
// Primary:  fetchCaptions (captions.ts) — InnerTube ANDROID → npm package →
//           watch-page scrape. Free, no quota.
// Fallback: RapidAPI scraper (lib/rapid-transcript.ts) — used only when the
//           primary path fails and the key is configured.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "[transcript-route]";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  console.log(`${LOG} ← request received`, { videoId });

  if (!videoId) {
    console.warn(`${LOG} ✗ rejected: missing videoId`);
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }

  const startedAt = Date.now();

  // ── Primary: captions.ts (free, no quota) ───────────────────────────────
  try {
    const result = await fetchCaptions(videoId, "en");

    if (result.segments.length > 0) {
      console.log(`${LOG} → 200 via ${result.strategy}`, {
        videoId,
        source_lang: result.languageCode,
        segmentCount: result.segments.length,
        tookMs: Date.now() - startedAt,
      });
      return Response.json({
        video_id: videoId,
        source_lang: result.languageCode,
        segments: result.segments,
      });
    }

    console.warn(`${LOG} primary returned 0 segments — trying RapidAPI fallback`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG} primary failed: ${msg} — trying RapidAPI fallback`);
  }

  // ── Fallback: RapidAPI ───────────────────────────────────────────────────
  const rapidKey =
    process.env.RAPIDAPI_KEY ?? process.env.NEXT_PUBLIC_RAPID_API_KEY ?? "";
  if (!rapidKey) {
    return Response.json(
      { error: "No transcript available for this video.", videoId, detail: "AllStrategiesFailed" },
      { status: 502 },
    );
  }

  try {
    const { segments, source_lang } = await fetchRapidTranscript(videoId);

    if (!segments.length) {
      console.warn(`${LOG} ✗ RapidAPI also returned 0 segments`, { videoId });
      return Response.json(
        { error: "No transcript available for this video.", videoId, detail: "EmptyTranscript" },
        { status: 502 },
      );
    }

    console.log(`${LOG} → 200 via RapidAPI fallback`, {
      videoId,
      source_lang,
      segmentCount: segments.length,
      tookMs: Date.now() - startedAt,
    });
    return Response.json({ video_id: videoId, source_lang, segments });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcript unavailable.";
    console.error(`${LOG} ✗ all strategies failed`, {
      videoId,
      tookMs: Date.now() - startedAt,
      message,
    });
    return Response.json(
      { error: message, videoId, detail: "AllStrategiesFailed" },
      { status: 502 },
    );
  }
}
