import { Link } from "@tanstack/react-router";
import { PhotoImage } from "@/components/photo-image";
import { listForGallery, startingPrice, formatMoney } from "@/lib/commerce";
import { coverFor, galleryPhotos, useStudioStore } from "@/lib/store";
import type { Gallery, Photo } from "@/lib/types";
import { formatCount } from "@/lib/utils";

export function GalleryCard({
  gallery,
  photos,
  large,
}: {
  gallery: Gallery;
  photos: Photo[];
  large?: boolean;
}) {
  const priceLists = useStudioStore((s) => s.priceLists);
  const products = useStudioStore((s) => s.products);
  const cover = coverFor(gallery, photos);
  const count = galleryPhotos(photos, gallery.id).length;
  const from = gallery.forSale ? startingPrice(listForGallery(gallery, priceLists), products) : 0;

  return (
    <Link
      to="/galleries/$galleryId"
      params={{ galleryId: gallery.id }}
      className="group relative block overflow-hidden rounded-xl bg-card"
    >
      <div className={large ? "aspect-[16/10]" : "aspect-[4/3]"}>
        {cover ? (
          <PhotoImage
            photo={cover}
            alt=""
            variant={large ? "display" : "thumb"}
            className="size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
            sizes={large ? "(max-width: 768px) 100vw, 60vw" : "(max-width: 768px) 100vw, 33vw"}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted text-sm text-muted-foreground">
            Empty gallery
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent p-5 pt-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
          {gallery.category}
          {from ? ` · Prints from ${formatMoney(from)}` : ""}
        </p>
        <h3 className="font-display mt-1 text-2xl leading-tight tracking-tight sm:text-[1.7rem]">
          {gallery.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{formatCount(count, "photograph")}</p>
      </div>
    </Link>
  );
}
