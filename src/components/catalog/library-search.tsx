import { useId, useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { useResourcePage } from "@/lib/catalog/resource-client";
import type { OwnerCatalogPhoto } from "@/lib/catalog/types";

type LibraryPhoto = OwnerCatalogPhoto & {
  status:
    "reserved" | "uploading" | "uploaded" | "processing" | "ready" | "failed" | "needs_review";
};

/** Mount only inside the owner-authorized workspace. The endpoint independently
 * checks owner capability; this component never grants media access itself. */
export function LibrarySearch({
  onOpenGallery,
}: {
  onOpenGallery?: (galleryId: string, photoId: string) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const state = useResourcePage<LibraryPhoto>(
    `/api/catalog/library?q=${encodeURIComponent(query)}&limit=50`,
  );
  return (
    <section className="space-y-4" aria-label="Library search">
      <div>
        <h3 className="text-base font-medium">Find a photograph</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Search filenames and captions across your galleries, including hidden and archived
          photographs.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          if (next === query) state.reload();
          else setQuery(next);
        }}
      >
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={inputId} className="mb-1.5 block text-xs text-muted-foreground">
            Filename or caption
          </label>
          <input
            id={inputId}
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={160}
            placeholder="Search your library"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search size={15} aria-hidden="true" />
          Search
        </button>
        {query && (
          <button
            type="button"
            className="h-10 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
            onClick={() => {
              setDraft("");
              setQuery("");
            }}
          >
            Clear
          </button>
        )}
      </form>
      {state.error && (
        <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">
          <p>{state.error.message}</p>
          <button
            type="button"
            className="mt-2 underline underline-offset-4"
            onClick={state.reload}
          >
            Retry search
          </button>
        </div>
      )}
      {state.loading ? (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          Searching library…
        </p>
      ) : (
        state.data && (
          <>
            <p role="status" className="text-xs text-muted-foreground">
              {state.data.data.length} loaded{query ? ` for “${query}”` : ""}
              {state.data.page.hasMore ? " · More available" : ""}
            </p>
            {state.data.data.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                {query
                  ? "No filenames or captions match this search."
                  : "No photographs in the library yet."}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {state.data.data.map((photo) => (
                  <li key={photo.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {photo.status === "ready" ? (
                        <img
                          src={`${photo.thumbSrc}${photo.thumbSrc.includes("?") ? "&" : "?"}owner=1`}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="px-1 text-center text-[10px] text-muted-foreground">
                          Preview unavailable
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 basis-36">
                      <p className="break-words text-sm font-medium">{photo.filename}</p>
                      {photo.caption && (
                        <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                          {photo.caption}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {photo.status.replaceAll("_", " ")}
                        {photo.hidden ? " · Hidden" : ""}
                        {photo.archived ? " · Archived" : ""}
                      </p>
                      <p className="mt-1 break-all text-[10px] text-muted-foreground">
                        Gallery ID: {photo.galleryId}
                      </p>
                    </div>
                    {onOpenGallery && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenGallery(photo.galleryId, photo.id)}
                        aria-label={`Open ${photo.filename} in Organizer`}
                      >
                        Open in Organizer
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {state.data.page.hasMore && (
              <button
                type="button"
                disabled={state.loadingMore}
                onClick={() => void state.loadMore()}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                {state.loadingMore ? "Loading…" : "Load more photographs"}
              </button>
            )}
          </>
        )
      )}
    </section>
  );
}
