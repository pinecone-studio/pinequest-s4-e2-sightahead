"use client";

// Test page: can OCR read YouTube captions off the screen instead of fetching
// them from YouTube (which keeps getting blocked)?
// Flow: user shares a screen/tab → we show it in a <video> → CaptionOCR reads
// a strip of each frame and reports any text it finds.

import { useEffect, useRef, useState } from "react";
import { CaptionOCR } from "./_comps/CaptionOcr";
import { useScreenShare } from "./_comps/ScreenShareProvider";

export default function TestDubPage() {
  const { stream, error, isSharing, requestShare, stopShare } =
    useScreenShare();

  // The <video> element that previews the shared screen.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Most recent text OCR pulled off the screen (shown for quick eyeballing).
  const [ocrText, setOcrText] = useState("");

  // Feed the shared stream into the preview <video> whenever it changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Screen-grab OCR test</h1>
        <p className="text-sm text-zinc-400">
          Share the tab/window playing a video with captions on, then watch the
          OCR output below.
        </p>
      </header>

      {/* Screen permission button: toggles the share prompt on/off. */}
      <div className="flex gap-2">
        {!isSharing ? (
          <button
            onClick={requestShare}
            className="rounded bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500"
          >
            Share screen
          </button>
        ) : (
          <button
            onClick={stopShare}
            className="rounded bg-red-600 px-4 py-2 font-semibold hover:bg-red-500"
          >
            Stop sharing
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Video player: previews whatever screen/tab the user shared. */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="w-full max-w-3xl rounded-lg border border-zinc-800 bg-black aspect-video"
      />

      {/* Latest OCR reading. */}
      <section className="max-w-3xl">
        <h2 className="text-sm text-zinc-400 mb-1">OCR output</h2>
        <div className="min-h-12 rounded bg-zinc-900 p-3 font-mono text-sm wrap-break-word">
          {ocrText || (
            <span className="text-zinc-600">
              {isSharing ? "Waiting for caption text…" : "Not sharing yet."}
            </span>
          )}
        </div>
      </section>

      {/* OCR worker runs only while sharing; it has no UI of its own. */}
      {isSharing && (
        <CaptionOCR
          onText={(text) => {
            console.log("OCR:", text);
            setOcrText(text);
          }}
        />
      )}
    </main>
  );
}
