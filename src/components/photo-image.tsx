import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { blobIdFromSrc, getBlob, isBlobSrc } from "@/lib/idb";
import { useStudioStore } from "@/lib/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Photo } from "@/lib/types";

export function useResolvedSrc(src: string) {
  const [url, setUrl] = useState(() => (isBlobSrc(src) ? "" : src));

  useEffect(() => {
    if (!isBlobSrc(src)) {
      setUrl(src);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    getBlob(blobIdFromSrc(src)).then((blob) => {
      if (cancelled || !blob) return;
      const objectUrl = URL.createObjectURL(blob);
      revoked = objectUrl;
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src]);

  return url;
}

export function PhotoImage({
  photo,
  alt,
  className,
  sizes,
  priority,
  variant = "display",
  draggable = false,
  protect,
}: {
  photo: Pick<Photo, "src" | "thumbSrc" | "originalSrc" | "title" | "width" | "height">;
  alt?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  variant?: "thumb" | "display" | "original";
  draggable?: boolean;
  protect?: boolean;
}) {
  const src =
    variant === "thumb"
      ? photo.thumbSrc || photo.src
      : variant === "original"
        ? photo.originalSrc || photo.src
        : photo.src;
  const url = useResolvedSrc(src);
  const studio = useStudioStore((s) => s.studio);
  const { user } = useCurrentUserState();
  const lock = protect ?? (!user && studio.protect !== false);
  const mark = !user && studio.watermark !== false && variant !== "thumb";
  if (!url) {
    return <div className={cn("bg-muted", className)} aria-hidden />;
  }
  return (
    <span className={cn("relative block overflow-hidden", className)}>
      <img
        src={url}
        alt={alt ?? photo.title}
        width={photo.width}
        height={photo.height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        sizes={sizes}
        className="size-full bg-muted object-cover"
        draggable={lock ? false : draggable}
        onContextMenu={lock ? (e) => e.preventDefault() : undefined}
      />
      {mark ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/70 to-transparent px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-foreground/80">
          {studio.name}
        </span>
      ) : null}
    </span>
  );
}
