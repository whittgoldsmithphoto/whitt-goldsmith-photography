import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { CatalogGallery, GalleryInput, OwnerCatalog, PhotoInput } from "@/lib/catalog/types";
import { CatalogStatus } from "./public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CatalogDiagnostics } from "./diagnostics";

export function CatalogOrganizer() {
  const state = useCatalog<OwnerCatalog>("op=owner");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<GalleryInput | null>(null);
  const [folderName, setFolderName] = useState("");
  const [photoDraft, setPhotoDraft] = useState<PhotoInput | null>(null);
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
            category: g.category,
            folderId: g.folderId,
            visibility: g.visibility,
            published: g.published,
          }
        : {
            title: "",
            description: "",
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
  async function upload(files: File[]) {
    if (!active) return;
    let complete = 0,
      review = 0,
      duplicates = 0;
    for (const file of files) {
      if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 20 * 1024 * 1024)
        throw new Error(
          `${file.name}: use JPEG or PNG up to 20 MB. RAW/TIFF processing is not available yet.`,
        );
      const bytes = await file.arrayBuffer();
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const reservation = await catalogFetch<{ id: string; status: string; duplicate: boolean }>(
        "op=reserve",
        { galleryId: active.id, filename: file.name, mime: file.type, bytes: file.size, checksum },
      );
      if (
        reservation.duplicate &&
        !["reserved", "failed", "uploading"].includes(reservation.status)
      ) {
        duplicates++;
        continue;
      }
      const response = await fetch(`/api/catalog?op=upload&id=${reservation.id}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: bytes,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed");
      if (result.status === "ready") complete++;
      else review++;
    }
    setMessage(`${complete} ready · ${review} awaiting processing · ${duplicates} already stored`);
  }
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl">Organizer</h1>
        <Button disabled={busy} onClick={() => edit()}>
          New gallery
        </Button>
      </div>
      <details className="my-6 rounded-lg border border-border p-4 text-sm">
        <summary>Owner diagnostics</summary>
        <CatalogDiagnostics />
        <p>
          JPEG/PNG: up to 20 MB. Images binding and a watermark object are required before previews
          can become ready.
        </p>
        <p>
          Browser-local collections from the previous version are preserved on this device but are
          not published by this catalog.
        </p>
      </details>
      {message && (
        <p className="my-4 rounded border border-border p-3" role="status">
          {message}
        </p>
      )}
      <form
        className="mb-8 flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await catalogFetch("op=folder", { title: folderName, parentId: null });
            setFolderName("");
          });
        }}
      >
        <Input
          aria-label="New folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="New folder name"
          required
          maxLength={180}
        />
        <Button variant="outline" disabled={busy}>
          Create folder
        </Button>
      </form>
      <div className="grid gap-8 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-2">
          {galleries.length === 0 && <p>No saved galleries yet.</p>}
          {galleries.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                setSelected(g.id);
                setPhotoDraft(null);
              }}
              aria-pressed={selected === g.id}
              className={`block w-full rounded-lg border p-4 text-left ${selected === g.id ? "border-foreground" : "border-border"}`}
            >
              <span className="font-display text-xl">{g.title}</span>
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
              <h2 className="font-display text-3xl">{active.title}</h2>
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
              <h3 className="font-display mt-8 text-2xl">Upload history</h3>
              <ul className="mt-4 space-y-3">
                {jobs
                  .filter((j) => j.galleryId === active.id)
                  .map((j) => (
                    <li key={j.id} className="rounded border border-border p-3">
                      <p className="break-all">
                        {j.filename} — {j.status.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(j.updatedAt).toLocaleString()} · {j.bytes.toLocaleString()} bytes
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
                          onClick={() => void action(() => catalogFetch(`op=retry&id=${j.id}`, {}))}
                        >
                          Retry processing
                        </Button>
                      )}
                      {["reserved", "uploading", "failed"].includes(j.status) && (
                        <p className="mt-2 text-sm">
                          Choose the same file above to retry. Upload reservations expire after one
                          hour.
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="rounded-lg border border-border p-12">
              Select a gallery or create one to start.
            </p>
          )}
        </section>
      </div>
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
