import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Lightbox } from "@/components/gallery/lightbox";
import { PhotoGrid } from "@/components/gallery/photo-grid";
import { Button } from "@/components/ui/button";
import { photosWithKeyword } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/keywords/$tag")({ component: KeywordRoom });

function KeywordRoom() {
  const { tag } = Route.useParams();
  const photosAll = useStudioStore((s) => s.photos);
  const photos = useMemo(
    () => photosWithKeyword(photosAll, decodeURIComponent(tag)),
    [photosAll, tag],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const label = decodeURIComponent(tag);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-sm text-muted-foreground">
        <Link to="/keywords" className="hover:text-foreground">
          Keywords
        </Link>
        {" / "}
        {label}
      </p>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Smart gallery
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">{label}</h1>
      <p className="mt-2 text-muted-foreground">
        {formatCount(photos.length, "photograph")} collected by keyword, across the studio.
      </p>

      <div className="mt-10">
        {photos.length === 0 ? (
          <div className="rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
            <p className="font-display text-2xl">Nothing tagged {label}.</p>
            <Button asChild className="mt-6">
              <Link to="/library">Open library</Link>
            </Button>
          </div>
        ) : (
          <PhotoGrid photos={photos} layout="justified" onOpen={(i) => setOpenIndex(i)} />
        )}
      </div>

      {openIndex !== null && photos[openIndex] && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
