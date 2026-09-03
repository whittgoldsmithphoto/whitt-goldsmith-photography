import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";
import { Lightbox } from "@/components/gallery/lightbox";
import { PhotoGrid } from "@/components/gallery/photo-grid";
import { Input } from "@/components/ui/input";
import { keywordIndex } from "@/lib/commerce";
import { livePhotos, useStudioStore } from "@/lib/store";
import type { ColorLabel } from "@/lib/types";
import { COLOR_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/library")({
  component: () => (
    <RequireOwner>
      <LibraryPage />
    </RequireOwner>
  ),
});

function LibraryPage() {
  const photosAll = useStudioStore((s) => s.photos);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = livePhotos(photosAll);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [flag, setFlag] = useState<ColorLabel | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const keywords = useMemo(() => keywordIndex(photos), [photos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return photos
      .slice()
      .sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt)
      .filter((p) => {
        if (galleryId && p.galleryId !== galleryId) return false;
        if (tag && !p.tags.includes(tag)) return false;
        if (minRating && p.rating < minRating) return false;
        if (flag && p.label !== flag) return false;
        if (!q) return true;
        const gallery = galleries.find((g) => g.id === p.galleryId);
        return (
          p.title.toLowerCase().includes(q) ||
          p.caption.toLowerCase().includes(q) ||
          p.filename.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q)) ||
          (gallery?.title.toLowerCase().includes(q) ?? false)
        );
      });
  }, [photos, query, tag, galleryId, galleries, minRating, flag]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Studio
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Library</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Every original, ranked and flagged. Keywords collect rooms of their own.
      </p>

      {keywords.length > 0 && (
        <div className="mt-8">
          <div className="flex items-end justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Keywords
            </p>
            <Link to="/keywords" className="text-sm text-muted-foreground hover:text-foreground">
              All keyword rooms
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.slice(0, 12).map((k) => (
              <Link
                key={k.tag}
                to="/keywords/$tag"
                params={{ tag: k.tag }}
                className="rounded-full bg-secondary px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                {k.tag}
                <span className="ml-1.5 tabular-nums">{k.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, captions, filenames, keywords"
          aria-label="Search photographs"
          className="max-w-md"
        />
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={galleryId === null && tag === null && minRating === 0 && flag === null}
            onClick={() => {
              setGalleryId(null);
              setTag(null);
              setMinRating(0);
              setFlag(null);
            }}
          >
            All
          </FilterChip>
          {[5, 4, 3].map((n) => (
            <FilterChip
              key={n}
              active={minRating === n}
              onClick={() => setMinRating((v) => (v === n ? 0 : n))}
            >
              {n}+ stars
            </FilterChip>
          ))}
          {COLOR_LABELS.filter((l) => l.id !== "none").map((l) => (
            <FilterChip
              key={l.id}
              active={flag === l.id}
              onClick={() => setFlag((v) => (v === l.id ? null : l.id))}
            >
              {l.label}
            </FilterChip>
          ))}
          {galleries.map((g) => (
            <FilterChip
              key={g.id}
              active={galleryId === g.id}
              onClick={() => setGalleryId((v) => (v === g.id ? null : g.id))}
            >
              {g.title}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="mt-10">
        {filtered.length === 0 ? (
          <div className="rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
            <p className="font-display text-2xl">No photographs match.</p>
          </div>
        ) : (
          <PhotoGrid photos={filtered} layout="justified" onOpen={(i) => setOpenIndex(i)} />
        )}
      </div>

      {openIndex !== null && filtered[openIndex] && (
        <Lightbox
          photos={filtered}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-full px-3 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
