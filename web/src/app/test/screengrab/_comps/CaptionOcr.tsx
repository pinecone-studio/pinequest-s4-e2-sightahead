"use client";
import { useEffect, useRef, useCallback } from "react";
import { createWorker, type Worker } from "tesseract.js";
import { useScreenShare } from "./ScreenShareProvider";

type Props = {
  onText: (text: string) => void;
  intervalMS?: number;
  lang?: string;
  cropTop?: number;
  cropHeight?: number;
};

export function CaptionOCR({
  onText,
  intervalMS = 1200,
  lang = "eng",
  cropTop = 0.72,
  cropHeight = 0.22,
}: Props) {
  const { stream } = useScreenShare();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const lastTextRef = useRef("");

  const grab = useCallback(async () => {
    const video = videoRef.current;
    const worker = workerRef.current;

    if (!video || !worker || busyRef.current) return;
    if (!video.videoWidth) return;

    busyRef.current = true;
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;

      // Crop a horizontal strip where captions usually sit (lower part of the
      // frame): start at cropTop, take cropHeight of the total height.
      const stripY = Math.floor(h * cropTop);
      const stripH = Math.floor(h * cropHeight);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = stripH;
      const ctx = canvas.getContext("2d")!;

      ctx.drawImage(video, 0, stripY, w, stripH, 0, 0, w, stripH);

      const { data } = await worker.recognize(canvas);
      // Collapse runs of whitespace to a single space (keep word boundaries).
      const text = data.text.replace(/\s+/g, " ").trim();

      if (text && text !== lastTextRef.current) {
        lastTextRef.current = text;
        onText(text);
      }
    } catch (e) {
      console.log("OCR fail:", e);
    } finally {
      busyRef.current = false;
    }
  }, [cropTop, cropHeight, onText]);

  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      if (cancelled) return;
      videoRef.current = video;

      workerRef.current = await createWorker(lang);
      if (cancelled) return;

      timer = setInterval(grab, intervalMS);
    };
    setup();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      workerRef.current?.terminate();
      workerRef.current = null;
      videoRef.current?.pause();
      videoRef.current = null;
    };
  }, [stream, grab, intervalMS, lang]);

  return null;
}
