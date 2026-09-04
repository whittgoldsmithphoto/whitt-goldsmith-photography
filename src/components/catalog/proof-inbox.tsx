import { useState } from "react";
import { CatalogStatus } from "./public";
import { Button } from "@/components/ui/button";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { OwnerProof } from "@/lib/catalog/types";

export function ProofInbox() {
  const state = useCatalog<OwnerProof[]>("op=owner-proofs");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state.data) return <CatalogStatus {...state} />;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl">Customer proof inbox</h1>
      <p className="my-4 text-muted-foreground">
        Latest 100 saved selections from the shared database. New or changed selections stay unread
        until you mark that version reviewed. Notifications are in this inbox; no email is sent yet.
      </p>
      <Button variant="outline" disabled={busy} onClick={state.reload}>
        Refresh inbox
      </Button>
      <p role="status" className="my-3">
        {message}
      </p>
      {!state.data.length && <p className="my-10">No customer selections yet.</p>}
      <div className="space-y-8">
        {state.data.map((p) => (
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
    </div>
  );
}
