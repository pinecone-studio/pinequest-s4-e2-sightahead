"use client";

import { useState } from "react";

// Simple test page: send Mongolian text to the edge-tts backend (/test/tts)
// and play the MP3 audio it streams back.

const testEndpoint = "http://localhost:8000";

export default function EdgeTTS() {
  const [text, setText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDub = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Текст оруулна уу");
      return;
    }

    setLoading(true);
    setError("");
    // Free the previous object URL before replacing it.
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      const res = await fetch(`${testEndpoint}/test/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`TTS failed (${res.status}): ${detail}`);
      }

      const blob = await res.blob(); // audio/mpeg (MP3)
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "TTS request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen p-10 flex flex-col gap-4">
      <textarea
        placeholder="Монгол текст"
        className="w-full h-50 resize-none border rounded p-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="rounded border hover:bg-slate-400/50 px-4 py-2 disabled:opacity-50 w-fit"
        disabled={loading}
        onClick={handleDub}
      >
        {loading ? "Үүсгэж байна..." : "Submit"}
      </button>

      {error && <p className="text-red-500">{error}</p>}

      {audioUrl && (
        <audio controls autoPlay src={audioUrl} className="w-full">
          Your browser does not support audio playback.
        </audio>
      )}
    </div>
  );
}
