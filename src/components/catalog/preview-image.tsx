import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CatalogPhoto } from "@/lib/catalog/types";

// The viewer always requests the authorized watermarked derivative, never an original.
export function PreviewImage({ photo }: { photo: CatalogPhoto }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [zoom, setZoom] = useState(false);
  const source = `${photo.src}${photo.src.includes("?") ? "&" : "?"}previewAttempt=${attempt}`;
  return (
    <div className="space-y-2">
      <div className="max-h-[60svh] overflow-auto rounded" aria-busy={status === "loading"}>
        {status === "failed" ? (
          <div role="alert" className="p-8 text-center">
            <p>
              The preview could not load. Check your connection or reload the gallery if its access
              has changed.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => {
                setStatus("loading");
                setAttempt((n) => n + 1);
              }}
            >
              Retry preview
            </Button>
          </div>
        ) : (
          <img
            key={attempt}
            src={source}
            alt={photo.caption || photo.filename}
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("failed")}
            className={zoom ? "mx-auto max-w-none" : "max-h-[60svh] w-full object-contain"}
            draggable={false}
          />
        )}
      </div>
      {status === "loading" && (
        <p role="status" className="text-center text-sm">
          Loading protected preview…
        </p>
      )}
      {status === "ready" && (
        <div className="flex justify-center">
          <Button variant="outline" aria-pressed={zoom} onClick={() => setZoom((value) => !value)}>
            {zoom ? "Fit preview to screen" : "Zoom preview"}
          </Button>
        </div>
      )}
    </div>
  );
}
