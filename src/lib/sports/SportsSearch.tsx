import { useRef, useState } from "react";
import { ProtectedPhoto } from "@/components/catalog/protected-photo";
import type { SportsSearchResult } from "./repository";

export function SportsSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SportsSearchResult[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef("");
  async function search(offset = 0) {
    const searchTerm = offset ? submitted.current : query.trim();
    if (!searchTerm) return;
    if (!offset) {
      submitted.current = searchTerm;
    }
    setBusy(true);
    setError("");
    setNextOffset(null);
    try {
      const response = await fetch(
        `/api/sports?q=${encodeURIComponent(searchTerm)}&offset=${offset}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search unavailable");
      setResults((previous) => (offset ? [...previous, ...data.results] : data.results));
      setNextOffset(data.nextOffset);
      setSearched(true);
    } catch {
      setError("Sports photo search is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="sports-search-heading" className="space-y-4">
      <div>
        <h2 id="sports-search-heading" className="font-display text-2xl">
          Search approved sports photos
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Find a photograph by details recorded by the studio.
        </p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="flex-1 text-sm">
          Find sports photos
          <input
            className="mt-1 block w-full rounded border border-border bg-background p-2"
            value={query}
            maxLength={100}
            disabled={busy}
            placeholder="Team, sport, venue or jersey number"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="self-end rounded border border-border px-4 py-2 text-sm"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Search covers owner-approved details on public galleries only.
      </p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className="underline" onClick={() => void search()}>
            Retry
          </button>
        </div>
      )}
      {searched && !results.length && !busy && !error && (
        <p role="status">No matching public photos.</p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {results.map((photo) => (
          <a
            key={photo.photoId}
            href={`/galleries/${encodeURIComponent(photo.galleryId)}`}
            className="space-y-1 rounded border border-border p-2"
          >
            <ProtectedPhoto
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
              src={photo.thumbSrc}
              alt={
                [photo.sport, photo.team, photo.jerseyNumber && `Jersey ${photo.jerseyNumber}`]
                  .filter(Boolean)
                  .join(" · ") || photo.filename
              }
            />
            <p className="text-sm">{photo.galleryTitle}</p>
            <p className="text-xs text-muted-foreground">{photo.filename}</p>
          </a>
        ))}
      </div>
      {nextOffset !== null && (
        <button
          className="text-sm underline"
          disabled={busy}
          type="button"
          onClick={() => void search(nextOffset)}
        >
          Load more results
        </button>
      )}
    </section>
  );
}
