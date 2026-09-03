import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Info,
  Pencil,
  ShoppingBag,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoImage } from "@/components/photo-image";
import { PhotoEditor } from "@/components/gallery/photo-editor";
import { RatingStars } from "@/components/organize/rating-stars";
import { BuySheet } from "@/components/shop/buy-sheet";
import { Button } from "@/components/ui/button";
import { isForSale, listForGallery, productsOnList } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";
import type { Photo } from "@/lib/types";
import { cn, formatBytes, formatWhen } from "@/lib/utils";
import { downloadOriginal } from "@/lib/vault";

export function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  const toggleFavorite = useStudioStore((s) => s.toggleFavorite);
  const archivePhotos = useStudioStore((s) => s.archivePhotos);
  const setCover = useStudioStore((s) => s.setCover);
  const setRating = useStudioStore((s) => s.setRating);
  const galleries = useStudioStore((s) => s.galleries);
  const products = useStudioStore((s) => s.products);
  const priceLists = useStudioStore((s) => s.priceLists);
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing || buying) return;
        onClose();
      }
      if (e.key === "ArrowRight") onIndexChange((index + 1) % photos.length);
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + photos.length) % photos.length);
      if (e.key === "f" || e.key === "F") {
        if (photo) toggleFavorite(photo.id);
      }
      if (e.key === "i" || e.key === "I") setInfo((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buying, editing, index, onClose, onIndexChange, photo, photos.length, toggleFavorite]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!photo || !mounted) return null;
  const gallery = galleries.find((g) => g.id === photo.galleryId);
  const canBuy =
    isForSale(photo, gallery) &&
    productsOnList(listForGallery(gallery, priceLists), products).length > 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.title}
      className="fixed inset-0 z-50 flex overflow-hidden bg-background"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 py-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={photo.favorite ? "Remove from proofs" : "Mark as proof"}
              onClick={() => toggleFavorite(photo.id)}
            >
              <Heart className={cn(photo.favorite && "fill-primary text-primary")} />
            </Button>
            {gallery && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Set as cover"
                onClick={() => {
                  setCover(gallery.id, photo.id);
                  toast("Cover updated");
                }}
              >
                <Star className={cn(gallery.coverPhotoId === photo.id && "fill-primary text-primary")} />
              </Button>
            )}
            {canBuy && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Buy a print"
                onClick={() => setBuying(true)}
              >
                <ShoppingBag />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Download original"
              onClick={() =>
                void downloadOriginal(photo)
                  .then(() => toast("Original downloaded"))
                  .catch(() => toast("Could not download the original"))
              }
            >
              <Download />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Edit photograph" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Photo details"
              onClick={() => setInfo((v) => !v)}
            >
              <Info />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove photograph"
              onClick={() => {
                const next = index >= photos.length - 1 ? index - 1 : index;
                archivePhotos([photo.id]);
                toast("Moved to Removed");
                if (photos.length <= 1) onClose();
                else onIndexChange(Math.max(0, next));
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-12 py-4 sm:px-16">
          <PhotoImage
            photo={photo}
            className="h-auto w-auto max-h-full max-w-full object-contain"
            priority
          />
          {photos.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2"
                aria-label="Previous photograph"
                onClick={() => onIndexChange((index - 1 + photos.length) % photos.length)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label="Next photograph"
                onClick={() => onIndexChange((index + 1) % photos.length)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-5 pt-2">
          <div>
            <p className="font-display text-2xl tracking-tight">{photo.title}</p>
            {photo.caption ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{photo.caption}</p>
            ) : null}
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {index + 1} / {photos.length}
              {photo.filename ? ` · ${photo.filename}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RatingStars value={photo.rating} onChange={(n) => setRating([photo.id], n)} />
            {canBuy && (
              <Button size="sm" onClick={() => setBuying(true)}>
                <ShoppingBag /> Buy a print
              </Button>
            )}
          </div>
        </div>
      </div>

      {info && (
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border p-6 sm:block">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Original
          </p>
          <dl className="mt-4 space-y-4 text-sm">
            <InfoRow label="Filename" value={photo.filename || "—"} />
            <InfoRow
              label="Original size"
              value={`${photo.originalWidth} × ${photo.originalHeight}`}
            />
            <InfoRow label="Display size" value={`${photo.width} × ${photo.height}`} />
            <InfoRow label="File" value={photo.bytes ? formatBytes(photo.bytes) : photo.mime} />
            <InfoRow label="Gallery" value={gallery?.title ?? "—"} />
            <InfoRow label="Uploaded" value={formatWhen(photo.createdAt)} />
            <InfoRow label="Taken" value={formatWhen(photo.takenAt)} />
            <InfoRow label="Modified" value={formatWhen(photo.modifiedAt)} />
            {photo.camera && <InfoRow label="Camera" value={photo.camera} />}
            {photo.lens && <InfoRow label="Lens" value={photo.lens} />}
            {photo.settings && <InfoRow label="Exposure" value={photo.settings} />}
            <InfoRow label="Flag" value={photo.label === "none" ? "—" : photo.label} />
            <InfoRow label="For sale" value={photo.forSale ? "Yes" : "No"} />
          </dl>
          {photo.tags.length > 0 && (
            <div className="mt-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Keywords
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {photo.tags.map((tag) => (
                  <Link
                    key={tag}
                    to="/keywords/$tag"
                    params={{ tag }}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={onClose}
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {editing && <PhotoEditor photo={photo} onClose={() => setEditing(false)} />}
      <BuySheet photo={photo} open={buying} onOpenChange={setBuying} />
    </div>,
    document.body,
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
