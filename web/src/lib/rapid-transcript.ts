// Server-side transcript fetch via the RapidAPI "youtube-transcriptor".
//
// Used by /api/youtube/transcript.
//   Example data received:
// "title": "How I Made This Tiny Walking Robot From Scratch",
//     "description": "This is Sesame, a little walking robot friend that's super budget friendly. It's powered by eight servo motors and uses an OLED screen on the front to make endearing faces. Sesame may be simple, but its design is pretty smart. This video details how I came up with the Sesame Robot Project, its evolution into an Open-Source project, and a short dive into the tech-stack that makes it work. I spent over four months designing and researching this robot, and I'm super excited to share it.\n\nKit pre-orders are available now!\nhttps://www.doriantodd.com/sesame/kit/\n\nInterested in the design, code, or building your own? Check out the GitHub Repository, where I've poured hours into making high quality documentation that's easy to follow.\nhttps://github.com/dorianborian/sesame-robot/\n\nThank you to PCBway for sponsoring this project! If you need PCBs manufactured, they've got great services available.\nhttps://www.pcbway.com/\n\nThanks for watching. If you like my work and want to see more, check out my website:\nhttps://www.doriantodd.com/",
//     "availableLangs": [
//       "en"
//     ],
//     "lengthInSeconds": "678",
//     "thumbnails": [
//       {
//         "url": "https://i.ytimg.com/vi/1UDsWkcQZhc/hqdefault.jpg",
//         "width": 480,
//         "height": 360
//       },
//       {
//         "url": "https://i.ytimg.com/vi/1UDsWkcQZhc/sddefault.jpg",
//         "width": 640,
//         "height": 480
//       }
//     ],
//     "transcription": [
//       {
//         "subtitle": "This is Sesame.",
//         "start": 2.56,
//         "dur": 7.265
//       },
//       {
//         "subtitle": "Sesame is a robot that can walk around,",
//         "start": 5.759,
//         "dur": 6.086
//       }...
// RapidAPI host (bare, no scheme) + key. Mirrors the test page's env vars.
const RAPID_HOST =
  process.env.RAPID_API_HOST ?? "youtube-transcriptor.p.rapidapi.com";
const RAPID_KEY = process.env.RAPID_API_KEY ?? "";

// What downstream (the /api/youtube/transcript route → pipeline) consumes.
export type RapidSegment = { start: number; duration: number; text: string };

// ── Response schema (RapidAPI "youtube-transcriptor") ───────────────────────
// Each transcript item has a `subtitle`, a `start` (seconds), and a `dur`
// (duration in seconds). Older shapes (text/end/duration) are tolerated so a
// provider swap doesn't silently produce empty segments.
type RapidTranscriptItem = {
  subtitle?: string;
  text?: string; // tolerated (older provider used `text`)
  start?: number | string;
  dur?: number | string;
  duration?: number | string; // tolerated alias
  end?: number | string; // tolerated (older provider sent end timestamp)
};

type RapidVideo = {
  availableLangs?: string[];
  lengthInSeconds?: number | string;
  transcription?: RapidTranscriptItem[];
};

// The provider returns an array of one video object. Tolerate a couple of
// alternative shapes (bare object, or a flat {transcript:[...]}) just in case.
type RapidResponse =
  | RapidVideo[]
  | (RapidVideo & { transcript?: RapidTranscriptItem[] });

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

// Map raw items → clean {start, duration, text}. `dur` is the duration directly;
// fall back to (end - start) for the older shape; text is the subtitle, with
// whitespace collapsed and trimmed.
function toSegments(items: RapidTranscriptItem[]): RapidSegment[] {
  const segs: RapidSegment[] = items
    .map((it) => {
      const text = String(it.subtitle ?? it.text ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const start = num(it.start) ?? 0;
      const dur = num(it.dur) ?? num(it.duration);
      const end = num(it.end);
      let duration = dur ?? (end !== undefined ? end - start : 0);
      if (!(duration > 0)) duration = 0;
      return { start, duration, text };
    })
    .filter((s) => s.text.length > 0);

  // Backfill any missing duration from the next segment's start.
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].duration) {
      const next = segs[i + 1];
      segs[i].duration = next ? Math.max(0.5, next.start - segs[i].start) : 2;
    }
  }

  return segs;
}

export async function fetchRapidTranscript(
  videoId: string,
): Promise<{ segments: RapidSegment[]; source_lang: string }> {
  if (!RAPID_HOST || !RAPID_KEY) {
    throw new Error(
      "RapidAPI not configured: set RAPID_API_HOST and RAPID_API_KEY " +
        "in the server environment.",
    );
  }

  // youtube-transcriptor takes the video_id as a query param (not a URL/body).
  const endpoint = `https://${RAPID_HOST}/transcript?video_id=${encodeURIComponent(videoId)}&lang=en`;

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPID_KEY,
      "x-rapidapi-host": RAPID_HOST,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RapidAPI ${res.status}: ${text.slice(0, 300)}`);
  }

  let body: RapidResponse;
  try {
    body = JSON.parse(text) as RapidResponse;
  } catch {
    throw new Error("RapidAPI returned non-JSON response");
  }

  // Unwrap the array (or tolerate a bare object / flat shape).
  const video: RapidVideo & { transcript?: RapidTranscriptItem[] } =
    Array.isArray(body) ? (body[0] ?? {}) : body;

  const items = video.transcription ?? video.transcript ?? [];
  const segments = toSegments(items);
  const source_lang = video.availableLangs?.[0] || "en";

  if (!segments.length) {
    console.warn(
      "[rapid-transcript] parsed 0 segments — response keys:",
      Array.isArray(body) ? "array" : Object.keys(body ?? {}),
    );
  }

  return { segments, source_lang };
}
