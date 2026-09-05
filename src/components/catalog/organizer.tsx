import { useEffect, useRef, useState } from "react";
import {
  uploadBatch,
  retryUploadBatch,
  reconcileProcessing,
  type UploadItem,
} from "@/lib/catalog/upload-batch";
import { collectUploadFiles } from "@/lib/catalog/ingest-files";
import { MAX_PHOTO_LABEL } from "@/lib/catalog/upload-limits";
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
import { LibrarySearch } from "./library-search";
import { LibraryMetadataPanel } from "./library-metadata";
import { apiFetch } from "@/lib/auth/api-fetch";
import {
  filterAndSortOwnerPhotos,
  reorderPhotoIds,
  type OrganizerPhotoFilter,
  type OrganizerPhotoSort,
} from "@/lib/catalog/organizer-photo-view";
import {
  clearPhotoSelection,
  executeBulkPhotoActionWithReload,
  formatBulkPhotoSuccessMessage,
  planBulkPhotoAction,
  resetSelectionOnGalleryChange,
  selectAllVisiblePhotos,
  selectedPhotoCount,
  togglePhotoSelection,
  type BulkPhotoAction,
} from "@/lib/catalog/bulk-photo-workbench";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function CatalogOrganizer() {
  const state = useCatalog<OwnerCatalog>("op=owner");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [draft, setDraft] = useState<GalleryInput | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoInput | null>(null);
  const [batchItems, setBatchItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<OrganizerPhotoFilter>("all");
  const [photoSort, setPhotoSort] = useState<OrganizerPhotoSort>("display-order");
  const [dropActive, setDropActive] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const stopBatch = useRef(false);
  const retryBatch = useRef<{ galleryId: string; files: File[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const galleries = state.data?.galleries ?? [];
  const folders = state.data?.folders ?? [];
  const photos = state.data?.photos ?? [];
  const jobs = state.data?.jobs ?? [];
  const active = galleries.find((g) => g.id === selected) || galleries[0];
  const activePhotos = photos.filter((photo) => photo.galleryId === active?.id);
  const activePhotoCount = activePhotos.length;
  const visiblePhotos = filterAndSortOwnerPhotos(photos, active?.id, photoFilter, photoSort);
  const selectedCount = selectedPhotoCount(selectedPhotoIds, photos, active?.id);
  const listedGalleries = galleries.filter((g) =>
    g.title.toLowerCase().includes(galleryQuery.toLowerCase()),
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (!visiblePhotos.length) return;
      const index = Math.max(
        0,
        visiblePhotos.findIndex((photo) => photo.id === (focusId || photoDraft?.id)),
      );
      const current = visiblePhotos[index];
      const ids = selectedCount ? selectedPhotoIds : current ? [current.id] : [];
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setFocusId(visiblePhotos[Math.min(visiblePhotos.length - 1, index + 1)]?.id ?? null);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusId(visiblePhotos[Math.max(0, index - 1)]?.id ?? null);
      } else if (event.key === " " && current) {
        event.preventDefault();
        setSelectedPhotoIds((value) =>
          togglePhotoSelection(value, current.id, !value.includes(current.id)),
        );
      } else if (event.key === "Enter" && current) {
        event.preventDefault();
        setPhotoDraft({
          id: current.id,
          revision: current.revision,
          caption: current.caption,
          hidden: current.hidden,
          archived: current.archived,
          displayOrder: current.displayOrder,
        });
      } else if (event.key === "Escape") {
        setPhotoDraft(null);
        setSelectedPhotoIds(clearPhotoSelection());
      } else if (event.key === "x" || event.key === "h" || event.key === "X" || event.key === "H") {
        event.preventDefault();
        void bulkAction("hide", ids);
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        void bulkAction("unhide", ids);
      } else if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        void bulkAction("archive", ids);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visiblePhotos, focusId, photoDraft, selectedCount, selectedPhotoIds]);

  if (!state.data) return <CatalogStatus {...state} />;

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

  async function bulkAction(bulkActionName: BulkPhotoAction, ids = selectedPhotoIds) {
    const inputs = planBulkPhotoAction(photos, ids, active?.id, bulkActionName);
    if (!inputs.length) {
      setMessage("Select at least one photograph first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await executeBulkPhotoActionWithReload(
        inputs,
        (input) => catalogFetch("op=photo", input),
        state.reload,
      );
      setSelectedPhotoIds(clearPhotoSelection());
      setMessage(formatBulkPhotoSuccessMessage(inputs.length, bulkActionName));
      state.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `Could not ${bulkActionName} photographs.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: File[], galleryId = active?.id, previous?: UploadItem[]) {
    if (!galleryId || !files.length) return;
    stopBatch.current = false;
    setStopRequested(false);
    setUploading(true);
    if (!previous)
      setBatchItems(files.map((file, index) => ({ index, filename: file.name, state: "queued" })));
    try {
      const options = {
        galleryId,
        files,
        shouldStop: () => stopBatch.current,
        onItem: (item: UploadItem) =>
          setBatchItems((items) => items.map((old, index) => (index === item.index ? item : old))),
      };
      const results = previous
        ? await retryUploadBatch({ ...options, items: previous })
        : await uploadBatch(options);
      retryBatch.current = results.some((item) => ["failed", "cancelled"].includes(item.state))
        ? { galleryId, files }
        : null;
      const count = (status: UploadItem["state"]) =>
        results.filter((item) => item.state === status).length;
      setMessage(
        `${count("ready")} ready · ${count("review")} processing · ${count("duplicate")} already stored · ${count("failed")} failed · ${count("cancelled")} skipped`,
      );
    } finally {
      setUploading(false);
      state.reload();
    }
  }

  async function ingest(source: FileList | DataTransfer | File[] | null) {
    try {
      const files = await collectUploadFiles(source);
      if (!files.length) {
        setMessage(`Drop JPEG, PNG, a folder, or a zip (up to ${MAX_PHOTO_LABEL} each).`);
        return;
      }
      await upload(files);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read those files.");
    }
  }

  async function persistReorder(from: number, to: number) {
    const ids = reorderPhotoIds(
      visiblePhotos.map((photo) => photo.id),
      from,
      to,
    );
    const updates = ids.flatMap((id, order) => {
      const photo = photos.find((item) => item.id === id);
      if (!photo || photo.displayOrder === order) return [];
      return [
        {
          id,
          revision: photo.revision,
          caption: photo.caption,
          hidden: photo.hidden,
          archived: photo.archived,
          displayOrder: order,
        } satisfies PhotoInput,
      ];
    });
    if (!updates.length) return;
    await action(async () => {
      for (const input of updates) await catalogFetch("op=photo", input);
    });
  }

  const live = active && active.published && active.visibility !== "private";
  const statusLabel = active
    ? `${active.published ? "Live" : "Draft"} · ${active.visibility}${active.requiresPassword ? " · password" : ""}`
    : "";

  return (
    <div className="desk mx-auto max-w-[1680px] px-3 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Organizer</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
            Drop a folder or zip. Click a frame. X hide · P show · A archive.
          </p>
        </div>
        <Button disabled={busy} onClick={() => edit()}>
          New gallery
        </Button>
      </div>
      {message && (
        <p className="mb-4 rounded border border-border px-3 py-2 text-sm" role="status">
          {message}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3">
          <label className="block lg:hidden">
            <span className="sr-only">Gallery</span>
            <select
              className="w-full rounded-sm border border-input bg-secondary px-3"
              value={active?.id || ""}
              onChange={(event) => {
                const id = event.target.value;
                setSelectedPhotoIds((ids) => resetSelectionOnGalleryChange(selected, id, ids));
                setSelected(id);
                setPhotoDraft(null);
              }}
            >
              {listedGalleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <div className="hidden lg:block">
            <Input
              aria-label="Search galleries"
              value={galleryQuery}
              onChange={(event) => setGalleryQuery(event.target.value)}
              placeholder="Find a gallery"
            />
            {listedGalleries.length === 0 && (
              <p className="text-sm text-muted-foreground">No galleries yet.</p>
            )}
            {listedGalleries.map((g) => (
              <button
                key={g.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setSelectedPhotoIds((ids) => resetSelectionOnGalleryChange(selected, g.id, ids));
                  setSelected(g.id);
                  setPhotoDraft(null);
                }}
                aria-pressed={active?.id === g.id}
                className="catalog-directory-item block w-full border-l-2 px-3 py-2 text-left"
              >
                <span className="block text-sm font-medium">{g.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {g.published ? g.visibility : "Draft"}
                  {g.requiresPassword ? " · password" : ""}
                </span>
              </button>
            ))}
          </div>
          <details
            className="border-t border-border pt-2"
            open={libraryOpen}
            onToggle={(event) => setLibraryOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer py-2 text-sm">Search all photographs</summary>
            {libraryOpen && (
              <LibrarySearch
                onOpenGallery={(galleryId, photoId) => {
                  setSelectedPhotoIds((ids) =>
                    resetSelectionOnGalleryChange(selected, galleryId, ids),
                  );
                  setSelected(galleryId);
                  const photo = photos.find((item) => item.id === photoId);
                  setPhotoDraft(
                    photo
                      ? {
                          id: photo.id,
                          revision: photo.revision,
                          caption: photo.caption,
                          hidden: photo.hidden,
                          archived: photo.archived,
                          displayOrder: photo.displayOrder,
                        }
                      : null,
                  );
                  setLibraryOpen(false);
                }}
              />
            )}
          </details>
          <details
            open={foldersOpen}
            onToggle={(event) => setFoldersOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer py-2 text-sm">Folders</summary>
            {!busy && (
              <FolderManager
                onSaved={() => {
                  setMessage("Folder saved.");
                  state.reload();
                }}
              />
            )}
          </details>
        </aside>

        <section className="min-w-0">
          {active ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="kicker">
                    {statusLabel} · {activePhotoCount}
                  </p>
                  <h2 className="truncate text-lg font-semibold">{active.title}</h2>
                </div>
                {live && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            `${location.origin}/galleries/${active.id}`,
                          );
                          setMessage("Customer link copied.");
                        } catch {
                          window.prompt(
                            "Copy gallery link",
                            `${location.origin}/galleries/${active.id}`,
                          );
                        }
                      }}
                    >
                      Copy link
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/galleries/$galleryId" params={{ galleryId: active.id }}>
                        View
                      </Link>
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(active)}>
                  Publish & settings
                </Button>
              </div>

              <div
                className={cn(
                  "catalog-upload mb-4 border border-dashed border-foreground/25 px-4 py-8 text-center text-sm sm:py-6",
                  dropActive && "border-primary bg-secondary",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDropActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropActive(false);
                  void ingest(event.dataTransfer);
                }}
              >
                <p>Drop a folder, zip, or photographs here</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  JPEG or PNG, up to {MAX_PHOTO_LABEL} each. Keep this tab open while they transfer.
                </p>
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,.zip,application/zip"
                  multiple
                  disabled={busy}
                  onChange={(event) => {
                    // FileList is live: clearing the input also empties it.
                    const list = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void ingest(list);
                  }}
                />
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => fileInput.current?.click()}
                >
                  Choose files
                </Button>
              </div>

              {batchItems.length > 0 && (
                <section
                  aria-label="Current upload batch"
                  className="mb-4 rounded border border-border p-3"
                >
                  <p className="text-sm" role="status">
                    {
                      batchItems.filter(
                        (item) => !["queued", "hashing", "uploading"].includes(item.state),
                      ).length
                    }{" "}
                    of {batchItems.length} checked
                    {stopRequested && uploading ? " · stopping" : ""}
                  </p>
                  {uploading ? (
                    <Button
                      className="mt-2"
                      size="sm"
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
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const retry = retryBatch.current;
                          if (retry) void upload(retry.files, retry.galleryId, batchItems);
                        }}
                      >
                        Retry failed or unstarted files
                      </Button>
                    )
                  )}
                  <ul className="mt-2 max-h-32 overflow-auto text-xs text-muted-foreground">
                    {batchItems.map((item) => (
                      <li key={item.index}>
                        {item.filename} — {item.state}
                        {item.error ? ` · ${item.error}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", `All ${activePhotoCount}`],
                    [
                      "visible",
                      `Visible ${activePhotos.filter((photo) => !photo.hidden && !photo.archived).length}`,
                    ],
                    [
                      "hidden",
                      `Hidden ${activePhotos.filter((photo) => photo.hidden && !photo.archived).length}`,
                    ],
                    [
                      "archived",
                      `Archived ${activePhotos.filter((photo) => photo.archived).length}`,
                    ],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={photoFilter === value ? "default" : "outline"}
                    aria-pressed={photoFilter === value}
                    onClick={() => setPhotoFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
                <select
                  aria-label="Photo sort"
                  className="min-h-9 rounded border border-input bg-secondary px-2 text-sm"
                  value={photoSort}
                  onChange={(event) => setPhotoSort(event.target.value as OrganizerPhotoSort)}
                >
                  <option value="display-order">Manual order</option>
                  <option value="filename">Filename</option>
                  <option value="newest-updated">Newest</option>
                </select>
                <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!visiblePhotos.length}
                  onClick={() =>
                    setSelectedPhotoIds((ids) => selectAllVisiblePhotos(ids, visiblePhotos))
                  }
                >
                  Select visible
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!selectedPhotoIds.length}
                  onClick={() => setSelectedPhotoIds(clearPhotoSelection())}
                >
                  Clear
                </Button>
                {(["hide", "unhide", "archive", "restore"] as BulkPhotoAction[]).map((name) => (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !selectedCount}
                    onClick={() => void bulkAction(name)}
                  >
                    {name}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 xl:grid-cols-6">
                {visiblePhotos.map((p, index) => (
                  <div
                    key={p.id}
                    className={cn(
                      "catalog-frame group relative overflow-hidden bg-card",
                      (photoDraft?.id === p.id || focusId === p.id) && "ring-1 ring-foreground",
                    )}
                    draggable={photoSort === "display-order"}
                    onDragStart={() => {
                      dragFrom.current = index;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragFrom.current;
                      dragFrom.current = null;
                      if (from == null) return;
                      void persistReorder(from, index);
                    }}
                  >
                    <label className="absolute left-1 top-1 z-10">
                      <span className="sr-only">Select {p.filename}</span>
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selectedPhotoIds.includes(p.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelectedPhotoIds((ids) =>
                            togglePhotoSelection(ids, p.id, event.target.checked),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      className="block w-full"
                      onClick={() => {
                        setFocusId(p.id);
                        setPhotoDraft({
                          id: p.id,
                          revision: p.revision,
                          caption: p.caption,
                          hidden: p.hidden,
                          archived: p.archived,
                          displayOrder: p.displayOrder,
                        });
                      }}
                    >
                      <img
                        src={`${p.thumbSrc}&owner=1`}
                        alt={p.caption || p.filename}
                        className="aspect-[3/2] w-full object-cover"
                      />
                    </button>
                    {(p.hidden || p.archived) && (
                      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-background/80 px-1.5 text-[10px] uppercase tracking-wide">
                        {p.archived ? "Archived" : "Hidden"}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <details
                className="mt-6 border-t border-border"
                open={metadataOpen}
                onToggle={(event) => setMetadataOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer py-3 text-sm">
                  Keywords, ratings & bulk metadata
                </summary>
                {metadataOpen && <LibraryMetadataPanel key={active.id} galleryId={active.id} />}
              </details>
              {jobs.some((job) => job.galleryId === active.id) && (
                <details className="mt-6 text-sm">
                  <summary className="cursor-pointer py-2 text-muted-foreground">
                    Upload history
                  </summary>
                  <ul className="space-y-2">
                    {jobs
                      .filter((job) => job.galleryId === active.id)
                      .map((job) => (
                        <li key={job.id} className="text-xs text-muted-foreground">
                          {job.filename} — {job.status.replaceAll("_", " ")}
                          {["uploaded", "needs_review", "processing"].includes(job.status) && (
                            <Button
                              className="ml-2"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void action(async () => {
                                  const result = await catalogFetch<{ id: string; status: string }>(
                                    `op=retry&id=${job.id}`,
                                    {},
                                  );
                                  setBatchItems((items) => reconcileProcessing(items, result));
                                })
                              }
                            >
                              Retry processing
                            </Button>
                          )}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p className="border border-border px-6 py-16 text-center text-muted-foreground">
              Create a gallery, then drop photographs onto it.
            </p>
          )}
        </section>
      </div>

      {photoDraft && active && (
        <aside className="fixed inset-0 z-50 overflow-y-auto border-foreground/15 bg-background p-4 pb-24 lg:inset-y-16 lg:left-auto lg:right-0 lg:z-30 lg:w-[min(26rem,100%)] lg:border-l lg:pb-4">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await catalogFetch("op=photo", photoDraft);
                setPhotoDraft(null);
              });
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {photos.find((photo) => photo.id === photoDraft.id)?.filename || "Photograph"}
              </h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setPhotoDraft(null)}>
                Close
              </Button>
            </div>
            <img
              src={`/api/catalog?op=media&id=${encodeURIComponent(photoDraft.id)}&kind=preview&owner=1`}
              alt=""
              className="max-h-[40vh] w-full object-contain"
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const response = await apiFetch(
                    `/api/catalog/galleries/${encodeURIComponent(active.id)}/cover`,
                    {
                      method: "POST",
                      credentials: "same-origin",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        photoId: photoDraft.id,
                        revision: active.revision,
                      }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error?.message || "Could not change cover");
                  setMessage("Cover saved.");
                })
              }
            >
              Use as cover
            </Button>
            <a
              className="block text-sm underline underline-offset-4"
              href={`/api/catalog?op=media&id=${encodeURIComponent(photoDraft.id)}&kind=original&owner=1`}
              download={photos.find((photo) => photo.id === photoDraft.id)?.filename || "original"}
            >
              Download original
            </a>
            <label className="block text-sm">
              Caption
              <Textarea
                maxLength={2000}
                value={photoDraft.caption}
                onChange={(event) => setPhotoDraft({ ...photoDraft, caption: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={photoDraft.hidden}
                onChange={(event) => setPhotoDraft({ ...photoDraft, hidden: event.target.checked })}
              />
              Hidden from customers
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={photoDraft.archived}
                onChange={(event) =>
                  setPhotoDraft({ ...photoDraft, archived: event.target.checked })
                }
              />
              Archived
            </label>
            <Button disabled={busy}>Save</Button>
          </form>
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer py-2">Sports metadata</summary>
            <SportsMetadataEditor key={`sports-${photoDraft.id}`} photoId={photoDraft.id} />
          </details>
          <details className="text-sm">
            <summary className="cursor-pointer py-2">File check</summary>
            <IntegrityPanel photoId={photoDraft.id} />
          </details>
        </aside>
      )}

      <details className="mt-10 text-sm text-muted-foreground">
        <summary className="cursor-pointer py-2">Diagnostics</summary>
        <CatalogDiagnostics />
      </details>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90svh] max-w-lg overflow-y-auto">
          {draft && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  const saved = await catalogFetch<CatalogGallery>("op=gallery", draft);
                  setSelected(saved.id);
                  setDraft(null);
                });
              }}
            >
              <DialogHeader>
                <DialogTitle className="font-sans text-xl font-semibold normal-case tracking-normal">
                  {draft.id ? "Publish & settings" : "New gallery"}
                </DialogTitle>
                <DialogDescription>
                  Visibility, password, and the customer-facing copy for this gallery.
                </DialogDescription>
              </DialogHeader>
              {message && (
                <p role="alert" className="text-sm text-destructive">
                  {message}
                </p>
              )}
              <label className="block text-sm">
                Title
                <Input
                  aria-label="Title"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  required
                  maxLength={180}
                />
              </label>
              <label className="block text-sm">
                Description
                <Textarea
                  aria-label="Description"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  maxLength={4000}
                />
              </label>
              <label className="block text-sm">
                Instructions for customers
                <Textarea
                  aria-label="Instructions for customers"
                  maxLength={4000}
                  value={draft.customerInstructions ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, customerInstructions: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                Visibility
                <select
                  className="mt-1 block w-full rounded bg-secondary p-2"
                  value={draft.visibility}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      visibility: event.target.value as GalleryInput["visibility"],
                    })
                  }
                >
                  <option value="private">Private — only you</option>
                  <option value="unlisted">Unlisted — anyone with the link</option>
                  <option value="public">Public</option>
                </select>
              </label>
              {draft.id && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                  />
                  Published — needs a ready photograph
                </label>
              )}
              <label className="block text-sm">
                {draft.id ? "Replace password (blank keeps current)" : "Optional password"}
                <Input
                  type="password"
                  autoComplete="new-password"
                  maxLength={128}
                  value={draft.password || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, password: event.target.value || undefined })
                  }
                />
              </label>
              {draft.id && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.password === ""}
                    onChange={(event) =>
                      setDraft({ ...draft, password: event.target.checked ? "" : undefined })
                    }
                  />
                  Remove password
                </label>
              )}
              <label className="block text-sm">
                Downloads
                <select
                  aria-label="Downloads"
                  className="mt-1 block w-full rounded bg-secondary p-2"
                  value={draft.downloadPolicy ?? "none"}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      downloadPolicy: event.target.value as CatalogGallery["downloadPolicy"],
                    })
                  }
                >
                  <option value="none">View only</option>
                  <option value="purchased_only">Purchased files only</option>
                </select>
              </label>
              <label className="block text-sm">
                Category
                <Input
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  required
                  maxLength={100}
                />
              </label>
              <label className="block text-sm">
                Folder
                <select
                  className="mt-1 block w-full rounded bg-secondary p-2"
                  value={draft.folderId || ""}
                  onChange={(event) => setDraft({ ...draft, folderId: event.target.value || null })}
                >
                  <option value="">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.title}
                    </option>
                  ))}
                </select>
              </label>
              {draft.id && (
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.revokeAccess || false}
                    onChange={(event) => setDraft({ ...draft, revokeAccess: event.target.checked })}
                  />
                  Revoke existing access cookies
                </label>
              )}
              <div className="flex gap-2">
                <Button disabled={busy}>Save</Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
