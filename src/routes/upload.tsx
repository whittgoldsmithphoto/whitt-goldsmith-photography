import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderUp, Images, Upload } from "lucide-react";
import { toast } from "sonner";
import { RequireOwner } from "@/components/require-owner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { r2GalleryPrefix } from "@/lib/r2-path";
import { useStudioStore } from "@/lib/store";
import {
  collectFromDataTransfer,
  collectFromFileList,
  groupIncoming,
  type IncomingFile,
} from "@/lib/upload-inbox";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload")({
  component: () => (
    <RequireOwner>
      <UploadPage />
    </RequireOwner>
  ),
});

type Staged = IncomingFile & { galleryId: string | null };

function UploadPage() {
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const jobs = useStudioStore((s) => s.jobs);
  const createGallery = useStudioStore((s) => s.createGallery);
  const createFolder = useStudioStore((s) => s.createFolder);
  const importPhotos = useStudioStore((s) => s.importPhotos);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [fallbackId, setFallbackId] = useState(galleries[0]?.id ?? "");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Staged[]>();
    for (const item of staged) {
      const key = item.galleryId || "__none__";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [staged]);

  const fallbackGallery = galleries.find((g) => g.id === fallbackId);
  const fallbackFolder = folders.find((f) => f.id === fallbackGallery?.parentId);
  const examplePrefix = fallbackGallery
    ? r2GalleryPrefix(fallbackFolder?.title || "uncategorized", fallbackGallery.title)
    : "library/football/cces-football-st-joes/";

  async function addIncoming(incoming: IncomingFile[]) {
    if (!incoming.length) {
      toast("Drop JPEGs, a folder, or a SmugMug zip");
      return;
    }
    setStaged((prev) => [...groupIncoming(incoming, folders, galleries, fallbackId || null), ...prev]);
    toast(`${incoming.length} file${incoming.length === 1 ? "" : "s"} ready to place`);
  }

  async function runImport() {
    const ready = staged.filter((s) => s.galleryId);
    if (!ready.length) {
      toast("Choose a gallery for the files first.");
      return;
    }
    setBusy(true);
    try {
      const result = await importPhotos(ready.map((s) => ({ galleryId: s.galleryId!, file: s.file })));
      setStaged((prev) => prev.filter((s) => !s.galleryId));
      const bits = [`${result.added} stored`];
      if (result.skipped) bits.push(`${result.skipped} already there`);
      if (result.errors) bits.push(`${result.errors} failed`);
      toast(bits.join(" · "));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Upload</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Drop a SmugMug zip, a game folder, or loose JPEGs. Matching gallery names land in the right
        room. Files go to R2 as <code className="text-foreground">{examplePrefix}swg01452/original.jpg</code>
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="up-fallback">If a zip has no matching name, put it in</Label>
          <select
            id="up-fallback"
            value={fallbackId}
            onChange={(e) => setFallbackId(e.target.value)}
            className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
          >
            <option value="">Ask me</option>
            {galleries.map((g) => {
              const folder = folders.find((f) => f.id === g.parentId);
              return (
                <option key={g.id} value={g.id}>
                  {folder ? `${folder.title} / ${g.title}` : g.title}
                </option>
              );
            })}
          </select>
        </div>
        <p className="self-end text-sm text-muted-foreground">
          Name the zip like the gallery — <span className="text-foreground">CCES-Football-St-Joes.zip</span>{" "}
          matches that game.
        </p>
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void collectFromDataTransfer(e.dataTransfer).then(addIncoming);
        }}
        className={cn(
          "mt-8 rounded-xl border border-dashed border-border px-6 py-14 text-center transition-colors",
          over && "bg-accent",
        )}
      >
        <Upload className="mx-auto size-6 text-muted-foreground" />
        <p className="font-display mt-4 text-2xl">Drop zips, folders, or photographs</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => fileRef.current?.click()}>
            <Images /> Browse files or zips
          </Button>
          <Button type="button" variant="outline" onClick={() => folderRef.current?.click()}>
            <FolderUp /> Browse a folder
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.zip,application/zip"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void collectFromFileList(e.target.files).then(addIncoming);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          className="sr-only"
          multiple
          // @ts-expect-error webkitdirectory is a Chromium attribute
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files?.length) void collectFromFileList(e.target.files).then(addIncoming);
            e.target.value = "";
          }}
        />
      </div>

      {staged.length > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-2xl">Ready · {staged.length}</h2>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStaged([])} disabled={busy}>
                Clear
              </Button>
              <Button type="button" onClick={() => void runImport()} disabled={busy}>
                {busy ? "Storing…" : "Store in R2"}
              </Button>
            </div>
          </div>
          <div className="mt-4 space-y-5">
            {grouped.map(([key, items]) => {
              const gallery = galleries.find((g) => g.id === key);
              const folder = folders.find((f) => f.id === gallery?.parentId);
              return (
                <section key={key} className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">
                      {gallery ? `${folder ? `${folder.title} / ` : ""}${gallery.title}` : "Needs a gallery"}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">{items.length}</span>
                    </p>
                    <select
                      value={key === "__none__" ? "" : key}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setStaged((prev) => prev.map((s) => (items.includes(s) ? { ...s, galleryId: next } : s)));
                      }}
                      className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
                    >
                      <option value="">Choose gallery</option>
                      {galleries.map((g) => {
                        const f = folders.find((x) => x.id === g.parentId);
                        return (
                          <option key={g.id} value={g.id}>
                            {f ? `${f.title} / ${g.title}` : g.title}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {!gallery && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        const label =
                          items[0]?.path.split("/").filter(Boolean).slice(-2, -1)[0] ||
                          items[0]?.file.name.replace(/\.[^.]+$/, "") ||
                          "Imported";
                        let parentId = fallbackGallery?.parentId ?? null;
                        if (!parentId && folders[0]) parentId = folders[0].id;
                        if (!parentId) parentId = createFolder({ title: "Imported", parentId: null });
                        const id = createGallery({
                          title: label.replace(/[-_]+/g, " "),
                          description: "",
                          category: "Imported",
                          parentId,
                          forSale: true,
                          priceListId: "list-standard",
                        });
                        setStaged((prev) => prev.map((s) => (items.includes(s) ? { ...s, galleryId: id } : s)));
                        toast(`Gallery “${label}” created`);
                      }}
                    >
                      Create gallery from folder name
                    </Button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="mt-10 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
          {jobs
            .slice(-8)
            .reverse()
            .map((j) => (
              <li key={j.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{j.filename}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {j.status}
                  {j.message ? ` — ${j.message}` : ""}
                </span>
              </li>
            ))}
        </ul>
      )}

      <p className="mt-10 text-sm text-muted-foreground">
        Tree and covers stay in{" "}
        <Link to="/organize" className="underline underline-offset-2">
          Organizer
        </Link>
        .
      </p>
    </div>
  );
}
