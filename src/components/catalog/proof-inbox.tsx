import { useState } from "react";
import { CatalogStatus } from "./public";
import { Button } from "@/components/ui/button";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { OwnerProofPage } from "@/lib/catalog/proof-query";

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
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">Customer proof inbox</h1>
      <p className="my-4 text-muted-foreground">
        Saved selections from the shared database, 20 per page. New or changed selections stay
        unread until you mark that version reviewed. Notifications are in this inbox; no email is
        sent yet.
      </p>
      <form
        className="my-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setCursors([]);
        }}
      >
        <label className="flex flex-col gap-1">
          Search gallery, note, or reference
          <input
            className="rounded border border-border bg-background px-3 py-2"
            maxLength={120}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          Review status
          <select
            className="rounded border border-border bg-background px-3 py-2"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setCursors([]);
            }}
          >
            <option value="all">All selections</option>
            <option value="unreviewed">New or updated</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          Search
        </Button>
      </form>
      <Button variant="outline" disabled={busy} onClick={state.reload}>
        Refresh inbox
      </Button>
      <p role="status" className="my-3">
        {message}
      </p>
      {!state.data && <CatalogStatus {...state} />}
      {state.data && !state.data.items.length && (
        <p className="my-10">
          No selections match this page. Change the filters or return to the first page.
        </p>
      )}
      <div className="space-y-8">
        {state.data?.items.map((p) => (
          <section key={p.id} className="rounded border border-border p-5">
            <h2 className="font-display text-2xl">
              {p.galleryTitle} · {p.reviewedRevision < p.revision ? "New or updated" : "Reviewed"}
            </h2>
            <p className="mt-2 break-all text-sm">Reference: {p.id}</p>
            <p className="mt-1 text-sm">
              {p.photoIds.length} selections ·{" "}
              {p.updatedAt && new Date(p.updatedAt).toLocaleString()} · Version {p.revision}
            </p>
            <p className="my-4 whitespace-pre-wrap break-words">{p.note || "No customer note."}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {p.photos.map((photo) => (
                <div key={photo.id}>
                  <img
                    src={photo.thumbSrc}
                    alt={photo.filename}
                    className="aspect-[4/3] w-full rounded object-cover"
                    loading="lazy"
                  />
                  <p className="mt-1 break-all text-sm">
                    {photo.filename}
                    {photo.unavailable ? " — no longer customer-visible" : ""}
                  </p>
                </div>
              ))}
            </div>
            <Button
              className="mt-4"
              variant="outline"
              disabled={busy || p.reviewedRevision === p.revision}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  await catalogFetch("op=proof-review", { id: p.id, revision: p.revision });
                  state.reload();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Could not mark reviewed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Mark this version reviewed
            </Button>
          </section>
        ))}
      </div>
      <nav aria-label="Proof inbox pages" className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy || state.loading || !cursors.length}
          onClick={() => setCursors([])}
        >
          First page
        </Button>
        <Button
          variant="outline"
          disabled={busy || state.loading || !cursors.length}
          onClick={() => setCursors((value) => value.slice(0, -1))}
        >
          Previous page
        </Button>
        <span role="status">Page {cursors.length + 1}</span>
        <Button
          variant="outline"
          disabled={busy || state.loading || !state.data?.nextCursor}
          onClick={() => {
            if (state.data?.nextCursor) setCursors((value) => [...value, state.data!.nextCursor!]);
          }}
        >
          Next page
        </Button>
      </nav>
      <p className="mt-3 text-sm text-muted-foreground">
        New submissions may move to an earlier page. Return to the first page and refresh to see the
        latest changes.
      </p>
    </div>
  );
}
