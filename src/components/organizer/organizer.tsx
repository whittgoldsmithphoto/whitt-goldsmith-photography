import { useMemo, useRef, useState, type DragEventHandler, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Download,
  EyeOff,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  Images,
  Link2,
  Lock,
  PanelLeft,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoImage } from "@/components/photo-image";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  asTree,
  breadcrumbs,
  childrenOf,
  folderPhotoCount,
} from "@/lib/tree";
import {
  coverFor,
  galleryPhotos,
  livePhotos,
  useStudioStore,
  vaultBytes,
} from "@/lib/store";
import type { ColorLabel, Folder, Gallery, Photo, PhotoSort, PriceList, Privacy } from "@/lib/types";
import { COLOR_LABELS, PHOTO_SORTS, PRIVACY_OPTIONS } from "@/lib/types";
import { cn, formatBytes, formatCount } from "@/lib/utils";
import { downloadOriginal } from "@/lib/vault";
import { collectFromDataTransfer, collectFromFileList, groupIncoming } from "@/lib/upload-inbox";

type Selection =
  | { kind: "root" }
  | { kind: "folder"; id: string }
  | { kind: "gallery"; id: string }
  | { kind: "removed" };

export function Organizer() {
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = useStudioStore((s) => s.photos);
  const jobs = useStudioStore((s) => s.jobs);
  const createFolder = useStudioStore((s) => s.createFolder);
  const createGallery = useStudioStore((s) => s.createGallery);
  const moveNode = useStudioStore((s) => s.moveNode);
  const movePhotos = useStudioStore((s) => s.movePhotos);
  const copyPhotos = useStudioStore((s) => s.copyPhotos);
  const addPhotosFromFiles = useStudioStore((s) => s.addPhotosFromFiles);
  const importPhotos = useStudioStore((s) => s.importPhotos);
  const archivePhotos = useStudioStore((s) => s.archivePhotos);
  const restorePhotos = useStudioStore((s) => s.restorePhotos);
  const emptyArchive = useStudioStore((s) => s.emptyArchive);
  const deleteFolder = useStudioStore((s) => s.deleteFolder);
  const deleteGallery = useStudioStore((s) => s.deleteGallery);
  const updateGallery = useStudioStore((s) => s.updateGallery);
  const updateFolder = useStudioStore((s) => s.updateFolder);
  const addFromLibrary = useStudioStore((s) => s.addFromLibrary);
  const toggleHidden = useStudioStore((s) => s.toggleHidden);
  const setRating = useStudioStore((s) => s.setRating);
  const setLabel = useStudioStore((s) => s.setLabel);
  const addKeywords = useStudioStore((s) => s.addKeywords);
  const setPhotosForSale = useStudioStore((s) => s.setPhotosForSale);
  const priceLists = useStudioStore((s) => s.priceLists);
  const [sel, setSel] = useState<Selection>({ kind: "root" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [thumb, setThumb] = useState(128);
  const [folderOpen, setFolderOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [folderEdit, setFolderEdit] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "folder" | "gallery" | "empty">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const tree = useMemo(() => asTree(folders, galleries), [folders, galleries]);
  const parentId = sel.kind === "folder" ? sel.id : null;
  const currentGallery = sel.kind === "gallery" ? galleries.find((g) => g.id === sel.id) : undefined;
  const currentFolder = sel.kind === "folder" ? folders.find((f) => f.id === sel.id) : undefined;
  const kids = sel.kind === "gallery" ? [] : childrenOf(tree, sel.kind === "folder" ? sel.id : null);
  const galleryList = galleryPhotos(
    photos,
    currentGallery?.id ?? "",
    currentGallery?.sortBy ?? "manual",
    { includeHidden: true },
  );
  const removed = photos.filter((p) => p.archived);
  const trail = breadcrumbs(
    folders,
    galleries,
    sel.kind === "root" || sel.kind === "removed" ? null : sel.id,
  );
  const used = vaultBytes(photos);

  function select(next: Selection) {
    setSel(next);
    setPicked(new Set());
    setTreeOpen(false);
  }

  function onDropPhotos(destGalleryId: string, ids: string[]) {
    if (!ids.length) return;
    movePhotos(ids, destGalleryId);
    setPicked(new Set());
    toast("Moved to gallery");
  }

  async function onUpload(galleryId: string, files: FileList | File[]) {
    const incoming = await collectFromFileList(files);
    if (!incoming.length) {
      toast("Drop JPEGs, a folder, or a zip");
      return;
    }
    const grouped = groupIncoming(incoming, folders, galleries, galleryId);
    const ready = grouped.filter((g) => g.galleryId);
    if (!ready.length) {
      toast("Open a gallery first, or name the zip like that gallery");
      return;
    }
    const result = await importPhotos(ready.map((g) => ({ galleryId: g.galleryId!, file: g.file })));
    toast(`${result.added} stored`);
  }

  const treeNav = (
    <TreeNav
      tree={tree}
      galleries={galleries}
      selected={sel}
      onSelect={select}
      onDropNode={(kind, id, dest) => {
        if (moveNode(kind, id, dest)) toast("Moved");
        else toast("That nest isn’t allowed");
      }}
      onDropPhotos={onDropPhotos}
    />
  );

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <p className="font-display mr-1 text-xl tracking-tight">Organizer</p>
        <Button
          size="sm"
          variant="outline"
          className="md:hidden"
          onClick={() => setTreeOpen(true)}
        >
          <PanelLeft /> Folders
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Plus /> Create
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setFolderOpen(true)}>
              <FolderPlus /> Folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGalleryOpen(true)}>
              <Images /> Gallery
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          disabled={sel.kind !== "gallery"}
          onClick={() => fileRef.current?.click()}
        >
          <Upload /> Upload originals
        </Button>
        {sel.kind === "gallery" && (
          <Button size="sm" variant="outline" onClick={() => setLibraryOpen(true)}>
            Add from library
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.zip,application/zip"
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (sel.kind === "gallery" && e.target.files?.length) {
              void onUpload(sel.id, e.target.files);
            }
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <label className="hidden items-center gap-2 sm:flex">
            Thumb
            <input
              type="range"
              min={72}
              max={220}
              value={thumb}
              onChange={(e) => setThumb(Number(e.target.value))}
              className="w-24"
            />
          </label>
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="size-3.5" />
            Vault {formatBytes(used)}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border p-2 md:block">
          {treeNav}
        </aside>

        <section
          className="min-w-0 flex-1 overflow-y-auto p-4"
          onDragOver={(e) => {
            if (sel.kind === "gallery" && e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (sel.kind !== "gallery") return;
            if (e.dataTransfer.files.length) {
              e.preventDefault();
              void onUpload(sel.id, e.dataTransfer.files);
            }
          }}
        >
          <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => select({ kind: "root" })}>
              Home
            </button>
            {trail.map((crumb) => (
              <span key={crumb.id} className="inline-flex items-center gap-1">
                <ChevronRight className="size-3.5" />
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() =>
                    select(
                      crumb.kind === "folder"
                        ? { kind: "folder", id: crumb.id }
                        : { kind: "gallery", id: crumb.id },
                    )
                  }
                >
                  {crumb.title}
                </button>
              </span>
            ))}
            {sel.kind === "removed" && (
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="size-3.5" />
                Removed
              </span>
            )}
          </div>

          {sel.kind === "gallery" && currentGallery && (
            <GalleryPane
              gallery={currentGallery}
              folders={folders}
              galleries={galleries}
              photos={galleryList}
              thumb={thumb}
              picked={picked}
              setPicked={setPicked}
              onOpen={(id) =>
                void navigate({
                  to: "/galleries/$galleryId",
                  params: { galleryId: currentGallery.id },
                  search: { p: id },
                })
              }
              onSort={(sortBy) => updateGallery(currentGallery.id, { sortBy })}
              onPrivacy={(privacy) => updateGallery(currentGallery.id, { privacy })}
              onParent={(id) => {
                if (moveNode("gallery", currentGallery.id, id)) toast("Gallery moved");
                else toast("That nest isn’t allowed");
              }}
              onArchive={() => {
                archivePhotos(Array.from(picked));
                setPicked(new Set());
                toast("Moved to Removed");
              }}
              onHide={() => {
                Array.from(picked).forEach(toggleHidden);
                setPicked(new Set());
              }}
              onMove={(dest) => {
                movePhotos(Array.from(picked), dest);
                setPicked(new Set());
                toast("Moved");
              }}
              onCopy={(dest) => {
                const n = copyPhotos(Array.from(picked), dest);
                setPicked(new Set());
                toast(n ? `Copied ${n}` : "Those frames are already there");
              }}
              onDelete={() => setConfirm("gallery")}
              priceLists={priceLists}
              onSale={(forSale, priceListId) =>
                updateGallery(currentGallery.id, { forSale, priceListId })
              }
              onRate={(n) => setRating(Array.from(picked), n)}
              onFlag={(label) => setLabel(Array.from(picked), label)}
              onKeywords={(tags) => {
                addKeywords(Array.from(picked), tags);
                toast("Keywords applied");
              }}
              onForSale={(v) => setPhotosForSale(Array.from(picked), v)}
            />
          )}

          {(sel.kind === "root" || sel.kind === "folder") && (
            <FolderPane
              title={currentFolder?.title ?? "Site homepage"}
              description={
                currentFolder?.description ??
                "Folders group galleries. Originals live only in galleries — drop a gallery onto a folder to nest it."
              }
              kids={kids}
              folders={folders}
              galleries={galleries}
              photos={photos}
              onOpen={(n) => select({ kind: n.kind, id: n.id })}
              onDropNode={(kind, id, dest) => {
                if (moveNode(kind, id, dest)) toast("Moved");
                else toast("That nest isn’t allowed");
              }}
              onDropPhotos={onDropPhotos}
              onDropFiles={(galleryId, files) => void onUpload(galleryId, files)}
              onEditFolder={currentFolder ? () => setFolderEdit(true) : undefined}
              onDeleteFolder={currentFolder ? () => setConfirm("folder") : undefined}
            />
          )}

          {sel.kind === "removed" && (
            <RemovedPane
              photos={removed}
              galleries={galleries}
              onRestore={(ids) => {
                restorePhotos(ids);
                toast("Restored");
              }}
              onEmpty={() => setConfirm("empty")}
            />
          )}
        </section>
      </div>

      {jobs.length > 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {jobs
            .slice(-3)
            .reverse()
            .map((j) => (
              <p key={j.id}>
                {j.filename} · {j.status}
                {j.message ? ` — ${j.message}` : ""}
              </p>
            ))}
        </div>
      )}

      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="p-3">
          <SheetHeader>
            <SheetTitle>Folders</SheetTitle>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto">{treeNav}</div>
        </SheetContent>
      </Sheet>

      <FolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        parentId={sel.kind === "folder" ? sel.id : sel.kind === "root" ? null : currentGallery?.parentId ?? null}
        onSubmit={(title, description) => {
          createFolder({
            title,
            description,
            parentId: sel.kind === "folder" ? sel.id : sel.kind === "root" ? null : currentGallery?.parentId ?? null,
          });
          toast("Folder created");
        }}
      />
      <FolderDialog
        open={folderEdit}
        onOpenChange={setFolderEdit}
        parentId={currentFolder?.parentId ?? null}
        folder={currentFolder}
        onSubmit={(title, description) => {
          if (!currentFolder) return;
          updateFolder(currentFolder.id, { title, description });
          toast("Folder updated");
        }}
      />
      <GalleryCreateDialog
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        folders={folders}
        parentId={
          sel.kind === "folder"
            ? sel.id
            : sel.kind === "gallery"
              ? currentGallery?.parentId ?? "portfolio"
              : "portfolio"
        }
        onSubmit={(input) => {
          const id = createGallery(input);
          toast("Gallery created");
          select({ kind: "gallery", id });
        }}
      />
      {currentGallery && (
        <LibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          photos={livePhotos(photos)}
          galleryId={currentGallery.id}
          onAdd={(ids) => {
            const n = addFromLibrary(ids, currentGallery.id);
            toast(n ? `Added ${n} from library` : "Those frames are already here");
          }}
        />
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "folder"
                ? `Delete ${currentFolder?.title ?? "this folder"}?`
                : confirm === "gallery"
                  ? `Delete ${currentGallery?.title ?? "this gallery"}?`
                  : "Empty Removed?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "folder"
                ? "Nested galleries and their originals will be discarded from the vault."
                : confirm === "gallery"
                  ? "Photographs in this gallery will be discarded if they are not used elsewhere."
                  : "Originals that are only in Removed will be discarded from the vault."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (confirm === "folder" && currentFolder) {
                  const id = currentFolder.id;
                  const parent = currentFolder.parentId;
                  await deleteFolder(id);
                  select(parent ? { kind: "folder", id: parent } : { kind: "root" });
                  toast("Folder deleted");
                } else if (confirm === "gallery" && currentGallery) {
                  const parent = currentGallery.parentId;
                  await deleteGallery(currentGallery.id);
                  select(parent ? { kind: "folder", id: parent } : { kind: "root" });
                  toast("Gallery deleted");
                } else if (confirm === "empty") {
                  await emptyArchive();
                  toast("Vault originals discarded");
                }
                setConfirm(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TreeNav({
  tree,
  galleries,
  selected,
  onSelect,
  onDropNode,
  onDropPhotos,
}: {
  tree: ReturnType<typeof asTree>;
  galleries: Gallery[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  onDropNode: (kind: "folder" | "gallery", id: string, dest: string | null) => void;
  onDropPhotos: (galleryId: string, ids: string[]) => void;
}) {
  return (
    <div>
      <TreeButton
        active={selected.kind === "root"}
        onClick={() => onSelect({ kind: "root" })}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const payload = e.dataTransfer.getData("application/x-lumina-node");
          if (payload) {
            const node = JSON.parse(payload) as { kind: "folder" | "gallery"; id: string };
            onDropNode(node.kind, node.id, null);
          }
        }}
      >
        Site homepage
      </TreeButton>
      <NodeTree
        nodes={tree}
        galleries={galleries}
        parentId={null}
        selected={selected}
        onSelect={onSelect}
        onDropNode={onDropNode}
        onDropPhotos={onDropPhotos}
      />
      <TreeButton
        active={selected.kind === "removed"}
        className="mt-3"
        onClick={() => onSelect({ kind: "removed" })}
      >
        Removed
      </TreeButton>
    </div>
  );
}

function TreeButton({
  active,
  onClick,
  children,
  className,
  depth = 0,
  onDragOver,
  onDrop,
  draggable,
  onDragStart,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  depth?: number;
  onDragOver?: DragEventHandler;
  onDrop?: DragEventHandler;
  draggable?: boolean;
  onDragStart?: DragEventHandler;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        "flex h-10 w-full items-center rounded-md px-2 text-left text-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function NodeTree({
  nodes,
  galleries,
  parentId,
  selected,
  onSelect,
  onDropNode,
  onDropPhotos,
  depth = 0,
}: {
  nodes: ReturnType<typeof asTree>;
  galleries: Gallery[];
  parentId: string | null;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onDropNode: (kind: "folder" | "gallery", id: string, dest: string | null) => void;
  onDropPhotos: (galleryId: string, ids: string[]) => void;
  depth?: number;
}) {
  const kids = childrenOf(nodes, parentId);
  return (
    <div>
      {kids.map((n) => {
        const gallery = n.kind === "gallery" ? galleries.find((g) => g.id === n.id) : undefined;
        const Icon = n.kind === "folder" ? FolderIcon : Images;
        return (
          <div key={n.id}>
            <TreeButton
              depth={depth}
              active={
                (n.kind === "folder" && selected.kind === "folder" && selected.id === n.id) ||
                (n.kind === "gallery" && selected.kind === "gallery" && selected.id === n.id)
              }
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-lumina-node", JSON.stringify({ kind: n.kind, id: n.id }));
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const photoPayload = e.dataTransfer.getData("application/x-lumina-photos");
                if (photoPayload && n.kind === "gallery") {
                  onDropPhotos(n.id, JSON.parse(photoPayload) as string[]);
                  return;
                }
                const payload = e.dataTransfer.getData("application/x-lumina-node");
                if (payload) {
                  const node = JSON.parse(payload) as { kind: "folder" | "gallery"; id: string };
                  onDropNode(node.kind, node.id, n.kind === "folder" ? n.id : parentId);
                }
              }}
              onClick={() => onSelect({ kind: n.kind, id: n.id })}
            >
              <Icon className="mr-2 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              {gallery?.privacy === "private" && <Lock className="ml-1 size-3 shrink-0" />}
              {gallery?.privacy === "unlisted" && <Link2 className="ml-1 size-3 shrink-0" />}
            </TreeButton>
            {n.kind === "folder" && (
              <NodeTree
                nodes={nodes}
                galleries={galleries}
                parentId={n.id}
                selected={selected}
                onSelect={onSelect}
                onDropNode={onDropNode}
                onDropPhotos={onDropPhotos}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FolderPane({
  title,
  description,
  kids,
  folders,
  galleries,
  photos,
  onOpen,
  onDropNode,
  onDropPhotos,
  onDropFiles,
  onEditFolder,
  onDeleteFolder,
}: {
  title: string;
  description: string;
  kids: ReturnType<typeof childrenOf>;
  folders: Folder[];
  galleries: Gallery[];
  photos: Photo[];
  onOpen: (n: { kind: "folder" | "gallery"; id: string }) => void;
  onDropNode: (kind: "folder" | "gallery", id: string, dest: string | null) => void;
  onDropPhotos: (galleryId: string, ids: string[]) => void;
  onDropFiles: (galleryId: string, files: FileList) => void;
  onEditFolder?: () => void;
  onDeleteFolder?: () => void;
}) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Folder</p>
          <h1 className="font-display text-3xl tracking-tight">{title}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
        </div>
        {(onEditFolder || onDeleteFolder) && (
          <div className="flex gap-2">
            {onEditFolder && (
              <Button size="sm" variant="outline" onClick={onEditFolder}>
                Rename
              </Button>
            )}
            {onDeleteFolder && (
              <Button size="sm" variant="outline" onClick={onDeleteFolder}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {kids.length === 0 ? (
        <div className="rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
          <p className="font-display text-2xl">Nothing filed yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a folder for a sport, then a gallery for a game. Originals live in galleries.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kids.map((n) => {
            const gallery = n.kind === "gallery" ? galleries.find((g) => g.id === n.id) : undefined;
            const folder = n.kind === "folder" ? folders.find((f) => f.id === n.id) : undefined;
            const cover = gallery ? coverFor(gallery, photos) : undefined;
            const count =
              n.kind === "gallery"
                ? galleryPhotos(photos, n.id, "manual", { includeHidden: true }).length
                : folder
                  ? folderPhotoCount(folder.id, folders, galleries, photos)
                  : 0;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onOpen(n)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (n.kind === "gallery" && e.dataTransfer.files.length) {
                    onDropFiles(n.id, e.dataTransfer.files);
                    return;
                  }
                  const photoPayload = e.dataTransfer.getData("application/x-lumina-photos");
                  if (photoPayload && n.kind === "gallery") {
                    onDropPhotos(n.id, JSON.parse(photoPayload) as string[]);
                    return;
                  }
                  const payload = e.dataTransfer.getData("application/x-lumina-node");
                  if (payload) {
                    const node = JSON.parse(payload) as { kind: "folder" | "gallery"; id: string };
                    onDropNode(node.kind, node.id, n.kind === "folder" ? n.id : n.parentId);
                  }
                }}
                className="overflow-hidden rounded-xl bg-card text-left shadow-[var(--shadow-border)]"
              >
                <div className="aspect-[4/3] bg-muted">
                  {cover ? (
                    <PhotoImage photo={cover} alt="" variant="thumb" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                      {n.kind === "folder" ? "Folder" : "Empty gallery"}
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {n.kind}
                    {gallery && gallery.privacy !== "public" ? ` · ${gallery.privacy}` : ""}
                  </p>
                  <p className="mt-1 font-medium">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{formatCount(count, "photograph")}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GalleryPane({
  gallery,
  folders,
  galleries,
  photos,
  thumb,
  picked,
  setPicked,
  onOpen,
  onSort,
  onPrivacy,
  onParent,
  onArchive,
  onHide,
  onMove,
  onCopy,
  onDelete,
  priceLists,
  onSale,
  onRate,
  onFlag,
  onKeywords,
  onForSale,
}: {
  gallery: Gallery;
  folders: Folder[];
  galleries: Gallery[];
  photos: Photo[];
  thumb: number;
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  onOpen: (id: string) => void;
  onSort: (s: PhotoSort) => void;
  onPrivacy: (p: Privacy) => void;
  onParent: (id: string | null) => void;
  onArchive: () => void;
  onHide: () => void;
  onMove: (dest: string) => void;
  onCopy: (dest: string) => void;
  onDelete: () => void;
  priceLists: PriceList[];
  onSale: (forSale: boolean, priceListId: string | null) => void;
  onRate: (n: number) => void;
  onFlag: (l: ColorLabel) => void;
  onKeywords: (tags: string[]) => void;
  onForSale: (v: boolean) => void;
}) {
  const [kw, setKw] = useState("");
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Gallery</p>
          <h1 className="font-display text-3xl tracking-tight">{gallery.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatCount(photos.length, "original")} · {gallery.privacy}
            {gallery.forSale ? " · for sale" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={gallery.parentId ?? ""}
            onChange={(e) => onParent(e.target.value || null)}
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            aria-label="Folder"
          >
            <option value="">Site homepage</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          <select
            value={gallery.privacy}
            onChange={(e) => onPrivacy(e.target.value as Privacy)}
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            aria-label="Privacy"
          >
            {PRIVACY_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={gallery.sortBy}
            onChange={(e) => onSort(e.target.value as PhotoSort)}
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            aria-label="Sort photographs"
          >
            {PHOTO_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={gallery.priceListId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              onSale(Boolean(id) || gallery.forSale, id);
            }}
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            aria-label="Price list"
          >
            <option value="">No price list</option>
            {priceLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={gallery.forSale ? "secondary" : "outline"}
            onClick={() => onSale(!gallery.forSale, gallery.priceListId)}
          >
            {gallery.forSale ? "On sale" : "Not for sale"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/galleries/$galleryId" params={{ galleryId: gallery.id }}>
              Open wall
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
      {picked.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2 shadow-[var(--shadow-border)]">
          <p className="mr-2 text-sm tabular-nums">{picked.size} selected</p>
          <select
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onRate(Number(e.target.value));
              e.currentTarget.value = "";
            }}
            aria-label="Set rating"
          >
            <option value="" disabled>
              Rate…
            </option>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "No stars" : `${n} star${n === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onFlag(e.target.value as ColorLabel);
              e.currentTarget.value = "";
            }}
            aria-label="Set flag"
          >
            <option value="" disabled>
              Flag…
            </option>
            {COLOR_LABELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!kw.trim()) return;
              onKeywords(kw.split(","));
              setKw("");
            }}
          >
            <Input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="Add keywords"
              className="h-9 w-36"
              aria-label="Add keywords"
            />
            <Button size="sm" type="submit" variant="outline">
              Tag
            </Button>
          </form>
          <Button size="sm" variant="outline" onClick={() => onForSale(true)}>
            For sale
          </Button>
          <Button size="sm" variant="outline" onClick={() => onForSale(false)}>
            Not for sale
          </Button>
          <Button size="sm" variant="outline" onClick={onHide}>
            <EyeOff /> Hide
          </Button>
          <select
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            defaultValue=""
            onChange={(e) => {
              const dest = e.target.value;
              if (dest) onMove(dest);
              e.currentTarget.value = "";
            }}
            aria-label="Move to gallery"
          >
            <option value="" disabled>
              Move to…
            </option>
            {galleries
              .filter((g) => g.id !== gallery.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
          <select
            className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            defaultValue=""
            onChange={(e) => {
              const dest = e.target.value;
              if (dest) onCopy(dest);
              e.currentTarget.value = "";
            }}
            aria-label="Copy to gallery"
          >
            <option value="" disabled>
              Copy to…
            </option>
            {galleries
              .filter((g) => g.id !== gallery.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
          <Button size="sm" variant="outline" onClick={onArchive}>
            <Trash2 /> Remove
          </Button>
        </div>
      )}
      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
          Drop originals here. The studio keeps the file, then builds display and thumb sizes.
        </div>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumb}px, 1fr))` }}
        >
          {photos.map((photo) => {
            const on = picked.has(photo.id);
            return (
              <button
                key={photo.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  const ids = on ? Array.from(picked) : [photo.id];
                  e.dataTransfer.setData("application/x-lumina-photos", JSON.stringify(ids));
                }}
                onClick={(e) => {
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    const next = new Set(picked);
                    if (next.has(photo.id)) next.delete(photo.id);
                    else next.add(photo.id);
                    setPicked(next);
                    return;
                  }
                  onOpen(photo.id);
                }}
                className={cn(
                  "relative overflow-hidden rounded-md bg-muted",
                  on && "ring-2 ring-ring",
                )}
                style={{ aspectRatio: "1 / 1" }}
                aria-label={photo.filename}
              >
                <PhotoImage
                  photo={photo}
                  alt=""
                  variant="thumb"
                  className="size-full object-cover"
                />
                {photo.hidden && (
                  <span className="absolute left-1 top-1 rounded bg-background/80 px-1.5 text-[10px] uppercase tracking-wide">
                    Hidden
                  </span>
                )}
                {photo.label !== "none" && (
                  <span
                    className={cn(
                      "absolute right-1 top-1 size-2 rounded-full",
                      photo.label === "select" && "bg-primary",
                      photo.label === "maybe" && "bg-muted-foreground",
                      photo.label === "reject" && "bg-destructive",
                    )}
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-background/70 px-1.5 py-1 text-[10px]">
                  {photo.filename}
                  {photo.rating ? ` · ${photo.rating}★` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RemovedPane({
  photos,
  galleries,
  onRestore,
  onEmpty,
}: {
  photos: Photo[];
  galleries: Gallery[];
  onRestore: (ids: string[]) => void;
  onEmpty: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Removed</h1>
          <p className="text-sm text-muted-foreground">
            Soft-deleted frames. Restore, or empty to discard originals from the vault.
          </p>
        </div>
        {photos.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onRestore(photos.map((p) => p.id))}>
              Restore all
            </Button>
            <Button size="sm" variant="destructive" onClick={onEmpty}>
              Empty
            </Button>
          </div>
        )}
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
          {photos.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.filename}</span>
              <span className="text-muted-foreground">
                {galleries.find((g) => g.id === p.galleryId)?.title ?? "—"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onRestore([p.id])}>
                Restore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void downloadOriginal(p).catch(() => toast("Could not download"))}
              >
                <Download />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FolderDialog({
  open,
  onOpenChange,
  parentId,
  folder,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parentId: string | null;
  folder?: Folder;
  onSubmit: (title: string, description: string) => void;
}) {
  const [title, setTitle] = useState(folder?.title ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setTitle(folder?.title ?? "");
          setDescription(folder?.description ?? "");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription>
            Folders group galleries. Originals are stored only in galleries.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(title, description);
            setTitle("");
            setDescription("");
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="fold-title">Name</Label>
            <Input id="fold-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fold-desc">Note</Label>
            <Textarea id="fold-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {parentId ? "Nested in the selected folder." : "Created at the site root."}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{folder ? "Save" : "Create folder"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GalleryCreateDialog({
  open,
  onOpenChange,
  folders,
  parentId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folders: Folder[];
  parentId: string | null;
  onSubmit: (input: {
    title: string;
    description: string;
    category: string;
    parentId: string | null;
    privacy: Privacy;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [parent, setParent] = useState(parentId ?? "portfolio");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) setParent(parentId ?? "portfolio");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New gallery</DialogTitle>
          <DialogDescription>Galleries hold originals. Folders only hold galleries.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              title,
              description,
              category,
              parentId: parent || null,
              privacy,
            });
            setTitle("");
            setDescription("");
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ng-title">Title</Label>
            <Input id="ng-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ng-folder">Folder</Label>
            <select
              id="ng-folder"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
            >
              <option value="">Site homepage</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ng-priv">Privacy</Label>
            <select
              id="ng-priv"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as Privacy)}
              className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
            >
              {PRIVACY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ng-cat">Category</Label>
            <Input id="ng-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ng-desc">Description</Label>
            <Textarea id="ng-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create gallery</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LibraryDialog({
  open,
  onOpenChange,
  photos,
  galleryId,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  photos: Photo[];
  galleryId: string;
  onAdd: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [ids, setIds] = useState<Set<string>>(new Set());
  const candidates = photos.filter(
    (p) =>
      p.galleryId !== galleryId &&
      !p.archived &&
      (!q || p.title.toLowerCase().includes(q) || p.filename.toLowerCase().includes(q)),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add from library</DialogTitle>
          <DialogDescription>
            Link existing originals into this gallery without duplicating the vault file.
          </DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} placeholder="Search filename or title" />
        <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto">
          {candidates.map((p) => {
            const on = ids.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const next = new Set(ids);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  setIds(next);
                }}
                className={cn("overflow-hidden rounded-md", on && "ring-2 ring-ring")}
              >
                <PhotoImage photo={p} alt="" variant="thumb" className="aspect-square w-full object-cover" />
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onAdd(Array.from(ids));
              setIds(new Set());
              onOpenChange(false);
            }}
          >
            Add selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
