import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "lucide-react";
import { PhotoImage } from "@/components/photo-image";
import { Button } from "@/components/ui/button";
import type { Photo } from "@/lib/types";

const INTERVAL = 4500;

export function Slideshow({
  photos,
  startIndex,
  onClose,
}: {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const photo = photos[index];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [paused, photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, photos.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!photo || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between px-3 py-2">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close slideshow">
          <X />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6">
        <PhotoImage
          key={photo.id}
          photo={photo}
          className="h-auto w-auto max-h-full max-w-full object-contain"
          priority
        />
      </div>
      <div className="px-6 pb-6 pt-3">
        <p className="font-display text-center text-2xl tracking-tight">{photo.title}</p>
        <div className="mx-auto mt-4 h-0.5 max-w-xs overflow-hidden bg-secondary">
          <div
            key={`${photo.id}-${paused}`}
            className="h-full bg-primary"
            style={{
              animation: paused ? undefined : `lumina-progress ${INTERVAL}ms linear`,
              width: paused ? "0%" : undefined,
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes lumina-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
