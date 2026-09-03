import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";
import { Lightbox } from "@/components/gallery/lightbox";
import { PhotoGrid } from "@/components/gallery/photo-grid";
import { Button } from "@/components/ui/button";
import { livePhotos, useStudioStore } from "@/lib/store";

export const Route = createFileRoute("/favorites")({
  component: () => (
    <RequireOwner>
      <ProofsPage />
    </RequireOwner>
  ),
});

function ProofsPage() {
  const photos = useStudioStore((s) => s.photos);
  const proofs = useMemo(
    () =>
      livePhotos(photos)
        .filter((p) => p.favorite)
        .sort((a, b) => b.createdAt - a.createdAt),
    [photos],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Proofing
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Selected proofs</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Heart a photograph in the lightbox or gallery to collect it here — a working set for
        clients, or for the wall.
      </p>

      <div className="mt-10">
        {proofs.length === 0 ? (
          <div className="rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
            <p className="font-display text-2xl">No proofs yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Open a gallery and mark the frames you want to keep close.
            </p>
            <Button asChild className="mt-6">
              <Link to="/galleries">Browse galleries</Link>
            </Button>
          </div>
        ) : (
          <PhotoGrid photos={proofs} layout="justified" onOpen={(i) => setOpenIndex(i)} />
        )}
      </div>

      {openIndex !== null && proofs[openIndex] && (
        <Lightbox
          photos={proofs}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
