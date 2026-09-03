import { useEffect, useRef, useState } from "react";
import { Check, Heart } from "lucide-react";
import { PhotoImage } from "@/components/photo-image";
import { RatingStars } from "@/components/organize/rating-stars";
import { justify } from "@/lib/justified";
import type { GalleryLayout, Photo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PhotoGrid({
  photos,
  layout,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
}: {
  photos: Photo[];
  layout: GalleryLayout;
  selecting?: boolean;
  selected?: Set<string>;
  onOpen: (index: number) => void;
  onToggleSelect?: (id: string) => void;
}) {
  if (photos.length === 0) return null;

  if (layout === "justified") {
    return (
      <JustifiedGrid
        photos={photos}
        selecting={selecting}
        selected={selected}
        onOpen={onOpen}
        onToggleSelect={onToggleSelect}
      />
    );
  }

  if (layout === "masonry") {
    return (
      <div className="columns-1 gap-2 sm:columns-2 lg:columns-3">
        {photos.map((photo, index) => (
          <div key={photo.id} className="mb-2 break-inside-avoid">
            <Tile
              photo={photo}
              index={index}
              selecting={selecting}
              selected={selected?.has(photo.id)}
              onOpen={onOpen}
              onToggleSelect={onToggleSelect}
              className="w-full"
            />
          </div>
        ))}
      </div>
    );
  }

  if (layout === "filmstrip") {
    return (
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="relative h-[min(70vh,36rem)] shrink-0 snap-center"
            style={{ width: (photo.width / photo.height) * Math.min(windowHeight(), 576) }}
          >
            <Tile
              photo={photo}
              index={index}
              selecting={selecting}
              selected={selected?.has(photo.id)}
              onOpen={onOpen}
              onToggleSelect={onToggleSelect}
              className="h-full w-full"
              fit="contain"
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, index) => (
        <Tile
          key={photo.id}
          photo={photo}
          index={index}
          selecting={selecting}
          selected={selected?.has(photo.id)}
          onOpen={onOpen}
          onToggleSelect={onToggleSelect}
          className="aspect-[4/3] w-full"
        />
      ))}
    </div>
  );
}

function windowHeight() {
  if (typeof window === "undefined") return 520;
  return Math.min(window.innerHeight * 0.7, 576);
}

function JustifiedGrid({
  photos,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
}: {
  photos: Photo[];
  selecting?: boolean;
  selected?: Set<string>;
  onOpen: (index: number) => void;
  onToggleSelect?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const gap = 8;
  const target = width < 640 ? 180 : width < 1024 ? 230 : 280;
  const rows = width ? justify(photos, width, target, gap) : [];
  const indexById = new Map(photos.map((p, i) => [p.id, i]));

  return (
    <div ref={ref} className="flex w-full flex-col" style={{ gap }}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex" style={{ height: row.height, gap }}>
          {row.items.map((item) => (
            <div
              key={item.id}
              style={{ width: item.displayWidth, height: item.displayHeight }}
              className="relative overflow-hidden"
            >
              <Tile
                photo={item}
                index={indexById.get(item.id) ?? 0}
                selecting={selecting}
                selected={selected?.has(item.id)}
                onOpen={onOpen}
                onToggleSelect={onToggleSelect}
                className="size-full"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tile({
  photo,
  index,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
  className,
  fit = "cover",
  variant = "thumb",
}: {
  photo: Photo;
  index: number;
  selecting?: boolean;
  selected?: boolean;
  onOpen: (index: number) => void;
  onToggleSelect?: (id: string) => void;
  className?: string;
  fit?: "cover" | "contain";
  variant?: "thumb" | "display";
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (selecting) onToggleSelect?.(photo.id);
        else onOpen(index);
      }}
      className={cn("group relative block overflow-hidden bg-muted text-left", className)}
      aria-label={photo.title}
    >
      <PhotoImage
        photo={photo}
        alt=""
        variant={variant}
        className={cn(
          "size-full transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02]",
          fit === "contain" ? "object-contain" : "object-cover",
        )}
        sizes="(max-width: 768px) 100vw, 33vw"
      />
      {photo.favorite && !selecting && (
        <Heart className="absolute right-2.5 top-2.5 size-4 fill-primary text-primary" />
      )}
      {photo.label !== "none" && !selecting && (
        <span
          className={cn(
            "absolute left-2.5 top-2.5 size-2 rounded-full",
            photo.label === "select" && "bg-primary",
            photo.label === "maybe" && "bg-muted-foreground",
            photo.label === "reject" && "bg-destructive",
          )}
        />
      )}
      {selecting && (
        <span
          className={cn(
            "absolute left-2.5 top-2.5 flex size-6 items-center justify-center rounded-full shadow-[var(--shadow-border)]",
            selected ? "bg-primary text-primary-foreground" : "bg-background/70 text-foreground",
          )}
        >
          {selected ? <Check className="size-3.5" /> : null}
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/70 to-transparent px-3 py-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="block truncate text-sm">{photo.title}</span>
        {photo.rating > 0 && (
          <span className="mt-1 block">
            <RatingStars value={photo.rating} />
          </span>
        )}
      </span>
    </button>
  );
}
