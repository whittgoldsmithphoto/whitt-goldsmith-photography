import { createFileRoute, Link } from "@tanstack/react-router";
import { GalleryCard } from "@/components/gallery/gallery-card";
import { Button } from "@/components/ui/button";
import { SignedIn } from "@/lib/auth/gates";
import { useStudioStore } from "@/lib/store";

export const Route = createFileRoute("/about")({ component: AboutPage });

function AboutPage() {
  const studio = useStudioStore((s) => s.studio);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = useStudioStore((s) => s.photos);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {studio.location}
          </p>
          <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-6xl">{studio.name}</h1>
        </div>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{studio.about}</p>
      </div>

      <div className="mt-16 grid gap-8 border-t border-border pt-12 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Galleries
          </p>
          <p className="font-display mt-2 text-4xl tabular-nums">{galleries.length}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Photographs
          </p>
          <p className="font-display mt-2 text-4xl tabular-nums">{photos.length}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Proofs
          </p>
          <p className="font-display mt-2 text-4xl tabular-nums">
            {photos.filter((p) => p.favorite).length}
          </p>
        </div>
      </div>

      <div className="mt-16">
        <h2 className="font-display text-3xl tracking-tight">On the wall</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {galleries.map((g) => (
            <GalleryCard key={g.id} gallery={g} photos={photos} />
          ))}
        </div>
      </div>

      <div className="mt-16 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/galleries">Visit the galleries</Link>
        </Button>
        <SignedIn>
          <Button asChild variant="outline">
            <Link to="/settings">Edit studio</Link>
          </Button>
        </SignedIn>
      </div>
    </div>
  );
}
