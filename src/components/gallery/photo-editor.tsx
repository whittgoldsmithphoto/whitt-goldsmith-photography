import { useRef, useState } from "react";
import { toast } from "sonner";
import { RatingStars } from "@/components/organize/rating-stars";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStudioStore } from "@/lib/store";
import type { ColorLabel, Photo } from "@/lib/types";
import { COLOR_LABELS } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

export function PhotoEditor({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const updatePhoto = useStudioStore((s) => s.updatePhoto);
  const galleries = useStudioStore((s) => s.galleries);
  const movePhotos = useStudioStore((s) => s.movePhotos);
  const copyPhotos = useStudioStore((s) => s.copyPhotos);
  const replacePhoto = useStudioStore((s) => s.replacePhoto);
  const setRating = useStudioStore((s) => s.setRating);
  const [title, setTitle] = useState(photo.title);
  const [caption, setCaption] = useState(photo.caption);
  const [tags, setTags] = useState(photo.tags.join(", "));
  const [galleryId, setGalleryId] = useState(photo.galleryId);
  const [copyTo, setCopyTo] = useState("");
  const [label, setLabel] = useState<ColorLabel>(photo.label);
  const [forSale, setForSale] = useState(photo.forSale);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit photograph</DialogTitle>
          <DialogDescription>
            Title, keywords, filing, and whether this frame is for sale.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            updatePhoto(photo.id, {
              title: title.trim() || "Untitled",
              caption: caption.trim(),
              tags: tags
                .split(",")
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean),
              label,
              forSale,
            });
            if (galleryId !== photo.galleryId) {
              movePhotos([photo.id], galleryId);
            }
            if (copyTo && copyTo !== photo.galleryId) {
              const n = copyPhotos([photo.id], copyTo);
              if (n) toast(`Copied into ${galleries.find((g) => g.id === copyTo)?.title ?? "gallery"}`);
            }
            toast("Photograph updated");
            onClose();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="photo-title">Title</Label>
            <Input id="photo-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="photo-caption">Caption</Label>
            <Textarea
              id="photo-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="photo-tags">Keywords</Label>
            <Input
              id="photo-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="coast, fog, film"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Rating</Label>
            <RatingStars value={photo.rating} onChange={(n) => setRating([photo.id], n)} size="md" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="photo-label">Flag</Label>
            <select
              id="photo-label"
              value={label}
              onChange={(e) => setLabel(e.target.value as ColorLabel)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {COLOR_LABELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forSale}
              onChange={(e) => setForSale(e.target.checked)}
              className="size-4 accent-primary"
            />
            Available for sale when the gallery is
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="photo-gallery">Move to gallery</Label>
            <select
              id="photo-gallery"
              value={galleryId}
              onChange={(e) => setGalleryId(e.target.value)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="photo-copy">Copy into</Label>
            <select
              id="photo-copy"
              value={copyTo}
              onChange={(e) => setCopyTo(e.target.value)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <option value="">Don’t copy</option>
              {galleries
                .filter((g) => g.id !== photo.galleryId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
          </div>
          <div className="rounded-md bg-secondary px-3 py-3 text-sm shadow-[var(--shadow-border)]">
            <p className="text-muted-foreground">Original in vault</p>
            <p className="mt-1 truncate">{photo.filename}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {photo.originalWidth} × {photo.originalHeight}
              {photo.bytes ? ` · ${formatBytes(photo.bytes)}` : ""}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                await replacePhoto(photo.id, file);
                toast("Original replaced");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => fileRef.current?.click()}
            >
              Replace original
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
