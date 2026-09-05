import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CatalogStatus } from "./public";
import { Button } from "@/components/ui/button";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { OwnerProofPage } from "@/lib/catalog/proof-query";

function who(item: { customerName?: string; customerEmail?: string; id: string }) {
  return item.customerName || item.customerEmail || "Signed-in customer";
}

export function ProofInbox() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [cursors, setCursors] = useState<string[]>([]);
  const params = new URLSearchParams({ op: "owner-proof-page", q: query, status: filter });
  if (cursors.length) params.set("cursor", cursors[cursors.length - 1]);
  const state = useCatalog<OwnerProofPage>(params.toString());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <h1>Proofs</h1>
        <Button variant="outline" size="sm" disabled={busy || state.loading} onClick={state.reload}>
          Refresh inbox
        </Button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Favorites parents and players saved from a gallery. Mark a set done when you have seen it.
        Email alerts are not on yet.
      </p>
      <form
        className="my-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setCursors([]);
        }}
      >
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          Search
          <input
            aria-label="Search"
            className="min-h-11 rounded border border-border bg-background px-3"
            maxLength={120}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Gallery or note"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            aria-label="Status"
            className="min-h-11 rounded border border-border bg-background px-3"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setCursors([]);
            }}
          >
            <option value="all">All</option>
            <option value="unreviewed">New</option>
            <option value="reviewed">Done</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          Search
        </Button>
      </form>
      {message && (
        <p role="status" className="mb-4 text-sm">
          {message}
        </p>
      )}
      {!state.data && <CatalogStatus {...state} />}
      {state.data && !state.data.items.length && (
        <p className="py-12 text-muted-foreground">No selections yet.</p>
      )}
      <div className="space-y-6">
        {state.data?.items.map((item) => {
          const unread = item.reviewedRevision < item.revision;
          return (
            <section key={item.id} className="border-b border-border pb-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {unread ? "New" : "Done"} · {item.photoIds.length} frames
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {who(item)}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {item.galleryTitle}
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.updatedAt && new Date(item.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/galleries/$galleryId" params={{ galleryId: item.galleryId }}>
                      Open gallery
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant={unread ? "default" : "outline"}
                    disabled={busy || !unread}
                    onClick={async () => {
                      setBusy(true);
                      setMessage("");
                      try {
                        await catalogFetch("op=proof-review", {
                          id: item.id,
                          revision: item.revision,
                        });
                        state.reload();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Could not mark done");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {unread ? "Mark done" : "Done"}
                  </Button>
                </div>
              </div>
              {item.note && (
                <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm">{item.note}</p>
              )}
              <div className="mt-4 grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-6">
                {item.photos.map((photo) => (
                  <img
                    key={photo.id}
                    src={photo.thumbSrc}
                    alt={photo.filename}
                    className={`aspect-[3/2] w-full object-cover ${photo.unavailable ? "opacity-40" : ""}`}
                    loading="lazy"
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <nav aria-label="Proof pages" className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!cursors.length}
          onClick={() => setCursors([])}
        >
          First
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!cursors.length}
          onClick={() => setCursors((value) => value.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!state.data?.nextCursor}
          onClick={() => {
            if (state.data?.nextCursor) setCursors((value) => [...value, state.data!.nextCursor!]);
          }}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
