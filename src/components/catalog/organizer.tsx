import { useRef, useState } from "react";
import { uploadBatch, type UploadItem } from "@/lib/catalog/upload-batch";
import { Link } from "@tanstack/react-router";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { CatalogGallery, GalleryInput, OwnerCatalog, PhotoInput } from "@/lib/catalog/types";
import { CatalogStatus } from "./public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CatalogDiagnostics } from "./diagnostics";
import { SportsMetadataEditor } from "@/lib/sports/SportsMetadataEditor";
import { IntegrityPanel } from "@/lib/catalog-integrity/IntegrityPanel";
import { FolderManager } from "./folder-manager";

export function CatalogOrganizer() {
  const state = useCatalog<OwnerCatalog>("op=owner");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [draft, setDraft] = useState<GalleryInput | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoInput | null>(null);
  const [batchItems, setBatchItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const stopBatch = useRef(false);
  const retryBatch = useRef<{ galleryId: string; files: File[] } | null>(null);
  if (!state.data) return <CatalogStatus {...state} />;
  const { galleries, folders, photos, jobs } = state.data;
  const active = galleries.find((g) => g.id === selected);
  const edit = (g?: CatalogGallery) =>
    setDraft(
      g
        ? {
            id: g.id,
            revision: g.revision,
            title: g.title,
            description: g.description,
            customerInstructions: g.customerInstructions,
            downloadPolicy: g.downloadPolicy,
            category: g.category,
            folderId: g.folderId,
            visibility: g.visibility,
            published: g.published,
          }
        : {
            title: "",
            description: "",
            customerInstructions: "",
            downloadPolicy: "none",
            category: "Sports and events",
            folderId: null,
            visibility: "private",
            published: false,
          },
    );
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      state.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: File[], galleryId = active?.id) {
    if (!galleryId || !files.length) return;
    stopBatch.current = false;
    setStopRequested(false);
    setUploading(true);
    setBatchItems(files.map((file, index) => ({ index, filename: file.name, state: "queued" })));
    try {
      const results = await uploadBatch({
        galleryId,
        files,
        shouldStop: () => stopBatch.current,
        onItem: (item) =>
          setBatchItems((items) => items.map((old, index) => (index === item.index ? item : old))),
      });
      retryBatch.current = {
        galleryId,
        files: files.filter((_, index) => ["failed", "cancelled"].includes(results[index].state)),
      };
      const count = (status: UploadItem["state"]) =>
        results.filter((item) => item.state === status).length;
      setMessage(
        `${count("ready")} ready · ${count("review")} awaiting processing · ${count("duplicate")} already stored · ${count("failed")} failed · ${count("cancelled")} not started`,
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl">Organizer</h1>
        <Button disabled={busy} onClick={() => edit()}>
          New gallery
        </Button>
      </div>
      {message && (
        <p className="my-4 rounded border border-border p-3" role="status">
          {message}
        </p>
      )}
      <div className="my-6 border-y border-border">
        <details open={foldersOpen} onToggle={(event) => setFoldersOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer py-3 text-sm font-medium">Manage folders</summary>
          <div className="pb-4">
            {!busy && (
              <FolderManager
                onSaved={() => {
                  setMessage("Folder saved to the shared catalog.");
                  state.reload();
                }}
              />
            )}
          </div>
        </details>
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <h2 className="mb-3 text-sm font-semibold">Your galleries</h2>
          {galleries.length === 0 && <p>No saved galleries yet.</p>}
          {galleries.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected(g.id);
                setPhotoDraft(null);
              }}
              aria-pressed={selected === g.id}
              className={`block w-full rounded-lg border p-4 text-left ${selected === g.id ? "border-foreground" : "border-border"}`}
            >
              <span className="text-sm font-semibold">{g.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {g.published ? g.visibility : "Draft"}
                {g.requiresPassword ? " · password" : ""}
              </span>
            </button>
          ))}
        </aside>
        <section>
          {active ? (
            <>
              <h2 className="text-2xl font-semibold">{active.title}</h2>
              <p className="mt-2 text-muted-foreground">{active.description}</p>
              <div className="my-5 flex flex-wrap gap-3">
                <Button variant="outline" disabled={busy} onClick={() => edit(active)}>
                  Gallery settings
                </Button>
                {active.published && active.visibility !== "private" && (
                  <Button variant="outline" asChild>
                    <Link to="/galleries/$galleryId" params={{ galleryId: active.id }}>
                      View customer page
                    </Link>
                  </Button>
                )}
              </div>
              <label className="my-6 block rounded-lg border border-dashed border-border p-6">
                Upload JPEG or PNG photographs
                <input
                  className="mt-3 block w-full text-sm"
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    void action(() => upload(files));
                  }}
                />
              </label>
              {batchItems.length > 0 && (
                <section
                  aria-label="Current upload batch"
                  className="mb-6 rounded border border-border p-4"
                >
                  <h3 className="font-display text-2xl">Current upload batch</h3>
                  <p className="my-2 text-sm" role="status">
                    {
                      batchItems.filter(
                        (item) => !["queued", "hashing", "uploading"].includes(item.state),
                      ).length
                    }{" "}
                    of {batchItems.length} checked
                    {stopRequested && uploading ? " · Stopping after the current file" : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Keep this page open during transfer. Originals and completed jobs are saved on
                    the server. After a reload, choose the same files to safely resume;
                    already-stored files are not uploaded again.
                  </p>
                  {uploading ? (
                    <Button
                      className="my-3"
                      variant="outline"
                      disabled={stopRequested}
                      onClick={() => {
                        stopBatch.current = true;
                        setStopRequested(true);
                      }}
                    >
                      Stop after current file
                    </Button>
                  ) : (
                    Boolean(retryBatch.current?.files.length) && (
                      <Button
                        className="my-3"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const retry = retryBatch.current;
                          if (retry) void action(() => upload(retry.files, retry.galleryId));
                        }}
                      >
                        Retry failed or unstarted files
                      </Button>
                    )
                  )}
                  <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-sm">
                    {batchItems.map((item) => (
                      <li key={item.index} className="break-all">
                        {item.filename} — {item.state}
                        {item.error && <p className="text-destructive">{item.error}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {photos
                  .filter((p) => p.galleryId === active.id)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      className="rounded border border-border p-2 text-left"
                      onClick={() =>
                        setPhotoDraft({
                          id: p.id,
                          revision: p.revision,
                          caption: p.caption,
                          hidden: p.hidden,
                          archived: p.archived,
                          displayOrder: p.displayOrder,
                        })
                      }
                    >
                      <img
                        src={`${p.thumbSrc}&owner=1`}
                        alt={p.caption || p.filename}
                        className="aspect-[4/3] w-full rounded object-cover"
                      />
                      <span className="mt-2 block break-all text-sm">{p.filename}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.archived ? "Archived" : p.hidden ? "Hidden" : "In gallery"} · Order{" "}
                        {p.displayOrder} · Edit
                      </span>
                    </button>
                  ))}
              </div>
              {photoDraft && (
                <form
                  className="mt-6 space-y-4 rounded border border-border p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await catalogFetch("op=photo", photoDraft);
                      setPhotoDraft(null);
                    });
                  }}
                >
                  <h3 className="font-display text-2xl">Edit photograph</h3>
                  <img
                    src={`/api/catalog?op=media&id=${encodeURIComponent(photoDraft.id)}&kind=preview&owner=1`}
                    alt="Owner preview of the selected photograph"
                    className="max-h-[65vh] w-full rounded object-contain"
                  />
                  <a
                    className="inline-block underline"
                    href={`/api/catalog?op=media&id=${encodeURIComponent(photoDraft.id)}&kind=original&owner=1`}
                    download={
                      photos.find((photo) => photo.id === photoDraft.id)?.filename || "original"
                    }
                  >
                    Download private original (owner only)
                  </a>
                  <label className="block">
                    Customer-visible caption
                    <Textarea
                      maxLength={2000}
                      value={photoDraft.caption}
                      onChange={(e) => setPhotoDraft({ ...photoDraft, caption: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    Display order (lower numbers first; ties keep upload order)
                    <Input
                      type="number"
                      required
                      min={0}
                      max={2147483647}
                      step={1}
                      value={photoDraft.displayOrder}
                      onChange={(e) =>
                        setPhotoDraft({ ...photoDraft, displayOrder: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={photoDraft.hidden}
                      onChange={(e) => setPhotoDraft({ ...photoDraft, hidden: e.target.checked })}
                    />{" "}
                    Hide from customers
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={photoDraft.archived}
                      onChange={(e) => setPhotoDraft({ ...photoDraft, archived: e.target.checked })}
                    />{" "}
                    Archive photograph
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Hidden and archived photos cannot be opened by customers, including through old
                    image links. Originals are retained. Uncheck Archive to restore; uncheck Hide
                    too if you want customers to see it.
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={busy}>Save photograph</Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setPhotoDraft(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {photoDraft && (
                <SportsMetadataEditor key={`sports-${photoDraft.id}`} photoId={photoDraft.id} />
              )}
              {photoDraft && (
                <details key={`integrity-${photoDraft.id}`} className="mt-4 border-y border-border">
                  <summary className="cursor-pointer py-3 text-sm font-medium">
                    File integrity and delivery checks
                  </summary>
                  <IntegrityPanel photoId={photoDraft.id} />
                </details>
              )}
              <details className="mt-8 border-y border-border">
                <summary className="cursor-pointer py-3 text-sm font-medium">
                  Upload history
                </summary>
                <ul className="mt-4 space-y-3">
                  {jobs
                    .filter((j) => j.galleryId === active.id)
                    .map((j) => (
                      <li key={j.id} className="rounded border border-border p-3">
                        <p className="break-all">
                          {j.filename} — {j.status.replaceAll("_", " ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(j.updatedAt).toLocaleString()} · {j.bytes.toLocaleString()}{" "}
                          bytes
                        </p>
                        {j.error && <p className="mt-2 text-sm">{j.error}</p>}
                        <details className="mt-2 text-xs">
                          <summary>SHA-256</summary>
                          <p className="break-all">{j.checksum}</p>
                        </details>
                        {["uploaded", "needs_review", "processing"].includes(j.status) && (
                          <Button
                            className="mt-3"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void action(() => catalogFetch(`op=retry&id=${j.id}`, {}))
                            }
                          >
                            Retry processing
                          </Button>
                        )}
                        {["reserved", "uploading", "failed"].includes(j.status) && (
                          <p className="mt-2 text-sm">
                            Choose the same file above to retry. Upload reservations expire after
                            one hour.
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="rounded-lg border border-border p-12">
              Select a gallery or create one to start.
            </p>
          )}
        </section>
      </div>
      <details className="mt-8 border-t border-border text-sm">
        <summary className="cursor-pointer py-3 font-medium">Owner diagnostics</summary>
        <CatalogDiagnostics />
        <p className="mt-3 text-muted-foreground">
          JPEG/PNG: up to 20 MB. Images binding and a watermark object are required before previews
          can become ready.
        </p>
        <p className="mt-2 text-muted-foreground">
          Browser-local collections from the previous version are preserved on this device but are
          not published by this catalog.
        </p>
      </details>
      {draft && (
        <form
          className="mt-10 max-w-2xl space-y-4 rounded-xl border border-border p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const saved = await catalogFetch<CatalogGallery>("op=gallery", draft);
              setSelected(saved.id);
              setDraft(null);
            });
          }}
        >
          <h2 className="font-display text-2xl">
            {draft.id ? "Edit gallery" : "New private gallery"}
          </h2>
          <label className="block">
            Title
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              maxLength={180}
            />
          </label>
          <label className="block">
            Description
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              maxLength={4000}
            />
          </label>
          <label className="block">
            Instructions for customers
            <Textarea
              aria-label="Instructions for customers"
              maxLength={4000}
              value={draft.customerInstructions ?? ""}
              onChange={(event) => setDraft({ ...draft, customerInstructions: event.target.value })}
              placeholder="Explain how to select favorites, provide notes, or contact you."
            />
          </label>
          <label className="block">
            Customer download policy
            <select
              aria-label="Customer download policy"
              className="mt-1 block w-full rounded bg-secondary p-2"
              value={draft.downloadPolicy ?? "none"}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  downloadPolicy: event.target.value as CatalogGallery["downloadPolicy"],
                })
              }
            >
              <option value="none">No customer downloads</option>
              <option value="purchased_only">
                Purchased files only — future entitlement service required
              </option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            Saving this policy never opens access to originals. Customer downloads remain
            unavailable until the payment and entitlement delivery flow is verified.
          </p>
          <label className="block">
            Category
            <Input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              required
              maxLength={100}
            />
          </label>
          <label className="block">
            Folder
            <select
              className="mt-1 block w-full rounded bg-secondary p-2"
              value={draft.folderId || ""}
              onChange={(e) => setDraft({ ...draft, folderId: e.target.value || null })}
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Visibility
            <select
              className="mt-1 block w-full rounded bg-secondary p-2"
              value={draft.visibility}
              onChange={(e) =>
                setDraft({ ...draft, visibility: e.target.value as GalleryInput["visibility"] })
              }
            >
              <option value="private">Private — owner only</option>
              <option value="unlisted">Unlisted — anyone with the link</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="block">
            {draft.id
              ? "Replace password (leave blank to keep current)"
              : "Optional gallery password"}
            <Input
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={draft.password || ""}
              onChange={(e) => setDraft({ ...draft, password: e.target.value || undefined })}
            />
          </label>
          {draft.id && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={draft.password === ""}
                onChange={(e) =>
                  setDraft({ ...draft, password: e.target.checked ? "" : undefined })
                }
              />
              Remove password
            </label>
          )}
          {draft.id && (
            <>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
                />
                Published — requires a ready photograph
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={draft.revokeAccess || false}
                  onChange={(e) => setDraft({ ...draft, revokeAccess: e.target.checked })}
                />
                Revoke existing gallery access cookies
              </label>
            </>
          )}
          <div className="flex gap-3">
            <Button disabled={busy}>Save gallery</Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
