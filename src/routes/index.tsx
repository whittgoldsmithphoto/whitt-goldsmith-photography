import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { GalleryCard } from "@/components/gallery/gallery-card";
import { PhotoImage } from "@/components/photo-image";
import { Button } from "@/components/ui/button";
import { coverFor, livePhotos, publicGalleries, saleGalleries, useStudioStore } from "@/lib/store";
import { formatMoney, listForGallery, startingPrice } from "@/lib/commerce";
import { SignedIn, SignedOut } from "@/lib/auth/gates";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const studio = useStudioStore((s) => s.studio);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = useStudioStore((s) => s.photos);
  const listed = publicGalleries(galleries);
  const live = livePhotos(photos);
  const forSale = saleGalleries(galleries);
  const featured = listed.find((g) => g.featured) ?? listed[0];
  const cover = featured ? coverFor(featured, live) : undefined;
  const recent = live.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const priceLists = useStudioStore((s) => s.priceLists);
  const products = useStudioStore((s) => s.products);

  return (
    <div>
      <section className="relative min-h-svh">
        {cover ? (
          <PhotoImage
            photo={cover}
            className="absolute inset-0 size-full object-cover"
            priority
            sizes="100vw"
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-background/20" />
        <div className="relative z-10 mx-auto flex min-h-svh max-w-[1400px] flex-col justify-end px-4 pb-28 pt-28 sm:px-6 sm:pb-32">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
            {studio.location}
          </p>
          <h1 className="font-display mt-3 max-w-3xl text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
            {studio.name}
          </h1>
          <p className="mt-4 max-w-md text-base text-foreground/80 sm:text-lg">{studio.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {featured ? (
              <Button asChild size="lg">
                <Link to="/galleries/$galleryId" params={{ galleryId: featured.id }}>
                  Enter {featured.title}
                </Link>
              </Button>
            ) : (
              <SignedIn>
                <Button asChild size="lg">
                  <Link to="/organize">Open Organizer</Link>
                </Button>
              </SignedIn>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to="/galleries">All galleries</Link>
            </Button>
            {forSale[0] && (
              <Button asChild size="lg" variant="outline">
                <Link to="/galleries/$galleryId" params={{ galleryId: forSale[0].id }}>
                  Buy a print
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Studio
            </p>
            <h2 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Galleries</h2>
          </div>
          <Button asChild variant="ghost">
            <Link to="/galleries" className="gap-1">
              View all <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-5">
          {listed.length === 0 ? (
            <div className="md:col-span-5 rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
              <p className="font-display text-2xl">No galleries yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Public collections will appear here when they are published.
              </p>
              <SignedIn>
                <Button asChild className="mt-6">
                  <Link to="/organize">Start organizing</Link>
                </Button>
              </SignedIn>
              <SignedOut>
                <Button asChild className="mt-6" variant="outline">
                  <Link to="/about">About the studio</Link>
                </Button>
              </SignedOut>
            </div>
          ) : (
            listed.map((g, i) => (
              <div key={g.id} className={i % 2 === 0 ? "md:col-span-3" : "md:col-span-2"}>
                <GalleryCard gallery={g} photos={live} large={i === 0} />
              </div>
            ))
          )}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Library
              </p>
              <h2 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Recent frames</h2>
            </div>
            <Button asChild variant="ghost">
              <Link to="/library" className="gap-1">
                Open library <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {recent.map((photo) => (
              <Link
                key={photo.id}
                to="/galleries/$galleryId"
                params={{ galleryId: photo.galleryId }}
                className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-card"
              >
                <PhotoImage
                  photo={photo}
                  alt=""
                  variant="thumb"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  sizes="(max-width: 640px) 50vw, 25vw"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/70 to-transparent px-3 py-2.5 text-sm opacity-0 transition-opacity group-hover:opacity-100">
                  {photo.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {forSale.length > 0 && (
        <section className="border-t border-border">
          <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Prints
            </p>
            <h2 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Take one home</h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Open a photograph, choose a size. The studio keeps the original; you choose the print
              or the file.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {forSale.map((g) => {
                const from = startingPrice(listForGallery(g, priceLists), products);
                return (
                  <Button key={g.id} asChild variant="outline">
                    <Link to="/galleries/$galleryId" params={{ galleryId: g.id }}>
                      {g.title}
                      {from ? ` · from ${formatMoney(from)}` : ""}
                    </Link>
                  </Button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-border">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-16 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="max-w-xl">
            <h2 className="font-display text-3xl tracking-tight sm:text-4xl">A wall, not a feed.</h2>
            <p className="mt-3 text-muted-foreground">{studio.about}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/about">About the studio</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="font-display text-lg text-foreground">{studio.name}</span>
          <span>
            {studio.location}
            {listed.length ? ` · ${listed.length} galleries` : ""}
            {live.length ? ` · ${live.length} photographs` : ""}
          </span>
        </div>
      </footer>
    </div>
  );
}
