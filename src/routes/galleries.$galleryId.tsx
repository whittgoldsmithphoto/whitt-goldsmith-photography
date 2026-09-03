import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Columns3,
  Heart,
  LayoutGrid,
  MoreHorizontal,
  Play,
  Rows3,
  Share2,
  Trash2,
  RectangleHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { GalleryForm } from "@/components/gallery/gallery-form";
import { Lightbox } from "@/components/gallery/lightbox";
import { PhotoGrid } from "@/components/gallery/photo-grid";
import { Slideshow } from "@/components/gallery/slideshow";
import { UploadDropzone } from "@/components/gallery/upload-dropzone";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { galleryPhotos, useStudioStore } from "@/lib/store";
import { SignedIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breadcrumbs } from "@/lib/tree";
import type { GalleryLayout, PhotoSort } from "@/lib/types";
import { PHOTO_SORTS } from "@/lib/types";
import { formatMoney, listForGallery, startingPrice } from "@/lib/commerce";
import { cn, formatCount } from "@/lib/utils";
import { z } from "zod";

const searchSchema = z.object({
  p: z.string().optional(),
});

export const Route = createFileRoute("/galleries/$galleryId")({
  validateSearch: searchSchema,
  component: GalleryDetail,
});

const LAYOUTS: { id: GalleryLayout; label: string; icon: typeof LayoutGrid }[] = [
  { id: "justified", label: "Justified", icon: Rows3 },
  { id: "masonry", label: "Masonry", icon: Columns3 },
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "filmstrip", label: "Filmstrip", icon: RectangleHorizontal },
];

function GalleryDetail() {
  const { galleryId } = Route.useParams();
  const { p } = Route.useSearch();
  const navigate = useNavigate();
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const photosAll = useStudioStore((s) => s.photos);
  const updateGallery = useStudioStore((s) => s.updateGallery);
  const deleteGallery = useStudioStore((s) => s.deleteGallery);
  const toggleFavorite = useStudioStore((s) => s.toggleFavorite);
  const archivePhotos = useStudioStore((s) => s.archivePhotos);
  const movePhotos = useStudioStore((s) => s.movePhotos);
  const copyPhotos = useStudioStore((s) => s.copyPhotos);

  const { user } = useCurrentUserState();
  const gallery = galleries.find((g) => g.id === galleryId);
  const photos = useMemo(
    () => (gallery ? galleryPhotos(photosAll, gallery.id, gallery.sortBy) : []),
    [gallery, photosAll],
  );
  const trail = gallery ? breadcrumbs(folders, galleries, gallery.id) : [];
  const priceLists = useStudioStore((s) => s.priceLists);
  const products = useStudioStore((s) => s.products);
  const from =
    gallery?.forSale ? startingPrice(listForGallery(gallery, priceLists), products) : 0;

  const initialIndex = p ? Math.max(0, photos.findIndex((ph) => ph.id === p)) : -1;
  const [openIndex, setOpenIndex] = useState<number | null>(
    initialIndex >= 0 ? initialIndex : null,
  );
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [passTry, setPassTry] = useState("");
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof window === "undefined") return false;
    if (!galleryId) return false;
    return Boolean(sessionStorage.getItem(`gallery-pass-${galleryId}`));
  });

  if (!gallery) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Gallery not found</h1>
        <p className="mt-3 text-muted-foreground">It may have been removed from this studio.</p>
        <Button asChild className="mt-8">
          <Link to="/galleries">Back to galleries</Link>
        </Button>
      </div>
    );
  }

  if (gallery.privacy === "private" && !user) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Private gallery</h1>
        <p className="mt-3 text-muted-foreground">This room is not on the public wall.</p>
      </div>
    );
  }

  if (gallery.password && !user && !unlocked) {
    return (
      <div className="mx-auto max-w-sm px-6 py-24">
        <h1 className="font-display text-4xl">{gallery.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This gallery is locked.</p>
        <form
          className="mt-8 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (passTry === gallery.password) {
              sessionStorage.setItem(`gallery-pass-${gallery.id}`, "ok");
              setUnlocked(true);
            } else {
              toast("That password is not right");
            }
          }}
        >
          <Label htmlFor="gp">Password</Label>
          <Input id="gp" type="password" value={passTry} onChange={(e) => setPassTry(e.target.value)} />
          <Button type="submit">Enter</Button>
        </form>
      </div>
    );
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = Array.from(selected);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-sm text-muted-foreground">
        <Link to="/galleries" className="hover:text-foreground">
          Galleries
        </Link>
        {trail
          .filter((c) => c.kind === "folder")
          .map((c) => (
            <span key={c.id}>
              {" / "}
              <Link to="/folders/$folderId" params={{ folderId: c.id }} className="hover:text-foreground">
                {c.title}
              </Link>
            </span>
          ))}
      </p>
      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            {gallery.category}
            {gallery.privacy !== "public" ? ` · ${gallery.privacy}` : ""}
          </p>
          <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">{gallery.title}</h1>
          {gallery.description ? (
            <p className="mt-3 text-muted-foreground">{gallery.description}</p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">
            {formatCount(photos.length, "photograph")}
            {from ? ` · Prints from ${formatMoney(from)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SignedIn>
          <UploadDropzone galleryId={gallery.id} compact />
          </SignedIn>
          <Button
            variant="outline"
            onClick={() => setShow(true)}
            disabled={photos.length === 0}
          >
            <Play /> Slideshow
          </Button>
          <SignedIn>
          <Button
            variant={selecting ? "secondary" : "outline"}
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          >
            {selecting ? "Done" : "Select"}
          </Button>
          <select
            value={gallery.sortBy}
            onChange={(e) => updateGallery(gallery.id, { sortBy: e.target.value as PhotoSort })}
            className="h-10 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
            aria-label="Sort photographs"
          >
            {PHOTO_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Layout">
                <Rows3 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Layout</DropdownMenuLabel>
              {LAYOUTS.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onSelect={() => updateGallery(gallery.id, { layout: l.id })}
                  className={cn(gallery.layout === l.id && "text-primary")}
                >
                  <l.icon /> {l.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </SignedIn>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <SignedIn>
              <DropdownMenuItem onSelect={() => setEditing(true)}>Edit gallery</DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/organize">Open in Organizer</Link>
              </DropdownMenuItem>
              </SignedIn>
              <DropdownMenuItem
                onSelect={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    toast("Link copied");
                  } catch {
                    toast("Could not copy the link");
                  }
                }}
              >
                <Share2 /> Copy link
              </DropdownMenuItem>
              <SignedIn>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                className="text-destructive"
              >
                <Trash2 /> Delete gallery
              </DropdownMenuItem>
              </SignedIn>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-10">
        {photos.length === 0 ? (
          <SignedIn>
          <UploadDropzone galleryId={gallery.id} />
          </SignedIn>
        ) : (
          <PhotoGrid
            photos={photos}
            layout={gallery.layout}
            selecting={selecting}
            selected={selected}
            onOpen={(i) => setOpenIndex(i)}
            onToggleSelect={toggleSelect}
          />
        )}
      </div>

      {selecting && selectedIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
            <p className="mr-auto text-sm tabular-nums">{selectedIds.length} selected</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                selectedIds.forEach((id) => toggleFavorite(id));
                toast("Proofs updated");
              }}
            >
              <Heart /> Proof
            </Button>
            <select
              className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
              defaultValue=""
              onChange={(e) => {
                const dest = e.target.value;
                if (!dest) return;
                movePhotos(selectedIds, dest);
                setSelected(new Set());
                toast("Moved");
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
                if (!dest) return;
                const n = copyPhotos(selectedIds, dest);
                toast(n ? `Copied ${n}` : "Those frames are already there");
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
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                archivePhotos(selectedIds);
                setSelected(new Set());
                toast("Moved to Removed");
              }}
            >
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      )}

      {openIndex !== null && photos[openIndex] && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
      {show && (
        <Slideshow photos={photos} startIndex={openIndex ?? 0} onClose={() => setShow(false)} />
      )}

      <GalleryForm
        open={editing}
        onOpenChange={setEditing}
        gallery={gallery}
        onSubmit={(input) => {
          updateGallery(gallery.id, input);
          toast("Gallery updated");
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this gallery?</AlertDialogTitle>
            <AlertDialogDescription>
              {gallery.title} and its photographs will be removed from this studio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await deleteGallery(gallery.id);
                toast("Gallery deleted");
                void navigate({ to: "/galleries" });
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
