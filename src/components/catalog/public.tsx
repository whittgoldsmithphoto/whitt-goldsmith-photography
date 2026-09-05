import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { catalogFetch } from "@/lib/catalog/client";
import { useResourcePage } from "@/lib/catalog/resource-client";
import type { GallerySummary } from "@/lib/catalog/gallery-service";
import type { CatalogPhoto } from "@/lib/catalog/types";
import { defaultStudio } from "@/lib/seed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProofPanel } from "./proof-selection";
import { useProofSelection, type ProofController } from "@/lib/catalog/use-proof";
import { PreviewImage } from "./preview-image";
import { ProtectedPhoto } from "./protected-photo";
import { CheckoutGallery, CheckoutPhoto } from "./checkout-photo";

export function CatalogStatus({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error?: Error;
  reload: () => void;
}) {
  const message = error ? "Galleries are temporarily unavailable." : "Loading galleries…";
  return (
    <div className="mx-auto max-w-3xl px-6 py-24" role={error ? "alert" : "status"}>
      <p>{loading ? "Loading galleries…" : message}</p>
      {error && (
        <Button className="mt-4" onClick={reload}>
          Retry
        </Button>
      )}
    </div>
  );
}
function Card({ gallery }: { gallery: GallerySummary }) {
  const cover = gallery.cover;
  return (
    <Link
      to="/galleries/$galleryId"
      params={{ galleryId: gallery.id }}
      className="public-card group grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-4 sm:grid-cols-1 sm:items-stretch sm:gap-0"
    >
      <div className="overflow-hidden bg-[#1a1712]">
        {cover ? (
          <ProtectedPhoto
            src={cover.thumbSrc}
            alt=""
            loading="lazy"
            className="aspect-[3/2] w-full object-cover"
          />
        ) : (
          <div
            className="flex aspect-[3/2] w-full items-center justify-center text-sm text-muted-foreground"
            aria-label="Cover pending"
          >
            <span>Cover pending</span>
          </div>
        )}
      </div>
      <div className="sm:border-b sm:border-border sm:pb-5 sm:pt-3">
        <p className="kicker">
          {gallery.category || "Gallery"}
          {gallery.photoCount ? ` · ${gallery.photoCount}` : ""}
        </p>
        <h2 className="mt-1 text-[1.65rem] leading-none group-hover:text-primary sm:text-[1.85rem]">
          {gallery.title}
        </h2>
      </div>
    </Link>
  );
}
export function CatalogIndex({
  page,
  folderId,
  sportsSearch,
}: {
  page: "home" | "galleries" | "about";
  folderId?: string;
  sportsSearch?: ReactNode;
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const state = useResourcePage<GallerySummary>(
    `/api/catalog/galleries?limit=50&q=${encodeURIComponent(submittedQuery)}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ""}`,
    true,
  );
  const lastSuccessfulPage = useRef<typeof state.data>(undefined);
  useEffect(() => {
    if (state.data) lastSuccessfulPage.current = state.data;
  }, [state.data]);
  const visiblePage = state.data ?? lastSuccessfulPage.current;
  if (!visiblePage) return <CatalogStatus {...state} />;
  const listed = visiblePage.data;
  const home = page === "home";
  const featured = listed[0]?.cover ?? null;
  const rest = home ? listed.slice(1) : listed;
  return (
    <div>
      {home ? (
        <section className="grid min-h-[70svh] border-b border-foreground/15 lg:grid-cols-[minmax(17rem,32vw)_minmax(0,1fr)]">
          <div className="flex flex-col justify-between gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
            <div>
              <p className="kicker">{defaultStudio.location}</p>
              <h1 className="masthead mt-5 text-[clamp(3.2rem,12vw,6.4rem)]">
                Whitt
                <br />
                Goldsmith
              </h1>
              <p className="lede mt-6 max-w-sm text-xl text-foreground/85">
                Friday-night sports and events. Find your gallery after the game.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/galleries">Find your photos</Link>
              </Button>
              <Button variant="outline" asChild>
                <a
                  href="https://www.instagram.com/whittgoldsmithphotography/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Instagram
                </a>
              </Button>
            </div>
          </div>
          {featured ? (
            <Link
              to="/galleries/$galleryId"
              params={{ galleryId: listed[0].id }}
              className="public-card relative min-h-[42vh] bg-[#1a1712] lg:min-h-full"
            >
              <ProtectedPhoto
                src={featured.src}
                alt={featured.caption || listed[0].title}
                className="h-full max-h-[78vh] w-full object-cover lg:max-h-none lg:absolute lg:inset-0"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 py-5 text-[#f3ead6] sm:px-6">
                <p className="kicker text-[#f3ead6]/70">{listed[0].category || "Gallery"}</p>
                <p className="masthead mt-1 text-3xl sm:text-4xl">{listed[0].title}</p>
              </div>
            </Link>
          ) : (
            <div className="min-h-[32vh] bg-[#1a1712]" />
          )}
        </section>
      ) : (
        <div className="mx-auto max-w-[1440px] px-4 pb-6 pt-8 sm:px-6 sm:pt-12">
          <p className="kicker">{defaultStudio.location}</p>
          <h1 className="masthead mt-3 text-[clamp(2.6rem,9vw,5.2rem)]">
            {page === "about" ? "About" : "Find your photos"}
          </h1>
          <p className="lede mt-5 max-w-xl text-xl text-foreground/85">
            {page === "about"
              ? "Sports, school games, and events in Greenville, South Carolina."
              : "Search by event, team, school, or sport."}
          </p>
        </div>
      )}
      <div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6 lg:px-10">
      {page === "galleries" && (
        <section
          aria-label="Public gallery discovery"
          className="my-10 space-y-10 border-y border-border py-10"
        >
          <div>
            <h2 className="font-display text-3xl">Search galleries</h2>
            <form
              className="mt-5 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmittedQuery(draftQuery.trim());
              }}
            >
              <label htmlFor="gallery-search" className="sr-only">
                Gallery title search
              </label>
              <Input
                id="gallery-search"
                className="min-h-12"
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
                placeholder="Event, team, or sport"
              />
              <Button className="min-h-12" type="submit">
                Search
              </Button>
              {(draftQuery || submittedQuery) && (
                <Button
                  variant="outline"
                  className="min-h-12"
                  type="button"
                  onClick={() => {
                    setDraftQuery("");
                    setSubmittedQuery("");
                  }}
                >
                  Reset
                </Button>
              )}
            </form>
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {state.loading
                ? "Searching…"
                : `${listed.length} ${listed.length === 1 ? "gallery" : "galleries"}${visiblePage.page.hasMore ? " loaded" : ""}`}
            </p>
            {state.error && submittedQuery && (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <span>Galleries are temporarily unavailable.</span>
                <Button type="button" variant="outline" onClick={state.reload}>
                  Retry search
                </Button>
              </div>
            )}
          </div>
          {sportsSearch}
        </section>
      )}
      {page !== "about" &&
        ((home ? rest : listed).length ? (
          <div className="grid gap-x-8 gap-y-8 pt-10 sm:grid-cols-2 sm:gap-y-12 lg:grid-cols-3">
            {(home ? rest : listed).map((g) => (
              <Card key={g.id} gallery={g} />
            ))}
          </div>
        ) : home ? null : (
          <div className="border-t border-border py-16">
            <h2 className="font-display text-3xl">
              {submittedQuery ? "No matching galleries" : "Galleries appear after each event"}
            </h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              {submittedQuery
                ? "Try a team name, school, or a shorter search."
                : "When a collection is published, you can search it here, save favorites, and buy the files."}
            </p>
            {submittedQuery && (
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => {
                  setDraftQuery("");
                  setSubmittedQuery("");
                }}
              >
                Reset search
              </Button>
            )}
          </div>
        ))}
      {page !== "about" && visiblePage.page.hasMore && (
        <Button
          variant="outline"
          className="mt-8"
          disabled={state.loading || state.loadingMore}
          onClick={() => void state.loadMore()}
        >
          {state.loadingMore ? "Loading…" : "Load more galleries"}
        </Button>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          Galleries are temporarily unavailable. Retry using Load more galleries.
        </p>
      )}
      </div>
    </div>
  );
}
export function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <p className="kicker">{defaultStudio.location}</p>
      <h1 className="masthead mt-4 text-[clamp(3rem,10vw,5.5rem)]">Whitt Goldsmith</h1>
      <p className="lede mt-6 text-2xl">{defaultStudio.about}</p>
      <section className="mt-12 border-t border-border pt-8" aria-labelledby="about-practice">
        <h2 id="about-practice" className="text-3xl">
          The practice
        </h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          {defaultStudio.tagline} Coverage is built around the people and places that make a game,
          school day, or event worth remembering.
        </p>
      </section>
      <a
        className="mt-10 inline-flex min-h-11 items-center underline underline-offset-4"
        href="https://www.instagram.com/whittgoldsmithphotography/"
        target="_blank"
        rel="noreferrer"
      >
        Contact Whitt on Instagram
      </a>
    </div>
  );
}
export function CatalogGalleryPage({ id }: { id: string }) {
  const proof = useProofSelection(id);
  const resource = useResourcePage<CatalogPhoto>(
    `/api/catalog/galleries/${encodeURIComponent(id)}/photos?limit=50`,
  );
  const state = {
    ...resource,
    data: resource.data?.gallery
      ? { gallery: resource.data.gallery, photos: resource.data.data }
      : undefined,
  };
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  if (state.error?.status === 401)
    return (
      <form
        className="mx-auto max-w-md px-6 py-20"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setUnlockError("");
          try {
            await catalogFetch(`op=unlock&id=${encodeURIComponent(id)}`, { password });
            setPassword("");
            state.reload();
            proof.reload();
          } catch (error) {
            setUnlockError(error instanceof Error ? error.message : "Could not unlock gallery");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="masthead text-4xl">Protected gallery</h1>
        <label className="mt-6 block" htmlFor="gallery-password">
          Gallery password
        </label>
        <Input
          id="gallery-password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button className="mt-4" disabled={busy}>
          Open gallery
        </Button>
        <p role="alert" className="mt-3">
          {unlockError}
        </p>
      </form>
    );
  if (!state.data) return <CatalogStatus {...state} />;
  const { gallery, photos } = state.data;
  return (
    <div className="mx-auto max-w-[1440px] px-3 py-8 sm:px-6 sm:py-10 lg:px-10">
      <Link
        to="/galleries"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        All galleries
      </Link>
      <p className="kicker mt-8">{gallery.category}</p>
      <h1 className="masthead mt-2 max-w-4xl text-[clamp(2.4rem,8vw,4.8rem)]">{gallery.title}</h1>
      <p className="lede my-5 max-w-2xl text-lg">{gallery.description}</p>
      <section
        aria-label="Gallery instructions and download policy"
        className="my-5 max-w-3xl space-y-3 border-l-2 border-primary pl-4"
      >
        {gallery.customerInstructions && (
          <>
            <h2 className="text-2xl">Gallery instructions</h2>
            <p className="whitespace-pre-wrap break-words">{gallery.customerInstructions}</p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {gallery.downloadPolicy === "purchased_only"
            ? "Download policy: purchased files only. Available purchase options appear in the photo viewer. Downloads require a verified payment and valid authorization."
            : "Download policy: no customer downloads. You can view protected previews and save a proof selection."}
        </p>
      </section>
      <Button
        variant="outline"
        className="mb-8"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(location.href);
          } catch {
            window.prompt("Copy gallery link", location.href);
          }
        }}
      >
        Copy gallery link
      </Button>
      <ProofPanel proof={proof} galleryId={id} />
      <CheckoutGallery galleryId={id} anchorPhotoId={photos[0]?.id} />
      <p className="mb-4 mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        {photos.length} {photos.length === 1 ? "photograph" : "photographs"}
        {resource.data?.page.hasMore ? " loaded" : ""}
      </p>
      <div className="grid grid-cols-2 gap-1 sm:gap-2 md:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, i) => (
          <div key={p.id} className="min-w-0">
            <button
              type="button"
              aria-label={`Open ${p.filename}`}
              onClick={() => setOpen(i)}
              className={`public-card block w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-4 ${proof.selection?.photoIds.includes(p.id) ? "outline-2 outline-offset-2 outline-primary" : ""}`}
            >
              <ProtectedPhoto
                src={p.thumbSrc}
                alt={p.caption || p.filename}
                loading="lazy"
                className="aspect-[3/2] w-full object-cover"
              />
            </button>
            {p.caption && (
              <p className="mt-2 truncate text-sm text-muted-foreground">{p.caption}</p>
            )}
            {proof.selection && (
              <Button
                className="mt-2 w-full"
                size="sm"
                variant="outline"
                disabled={proof.busy}
                aria-pressed={proof.selection.photoIds.includes(p.id)}
                onClick={() => proof.toggle(p.id)}
              >
                {proof.selection.photoIds.includes(p.id) && <span aria-hidden="true">✓</span>}
                {proof.selection.photoIds.includes(p.id) ? "Selected" : "Select favorite"}
              </Button>
            )}
          </div>
        ))}
      </div>
      {!photos.length && <p>No photographs are available in this gallery.</p>}
      {resource.data?.page.hasMore && (
        <Button
          variant="outline"
          className="mt-8"
          disabled={resource.loadingMore}
          onClick={() => void resource.loadMore()}
        >
          {resource.loadingMore ? "Loading…" : "Load more photographs"}
        </Button>
      )}
      {resource.error && (
        <p role="alert" className="mt-4">
          {resource.error.message} Retry using Load more photographs.
        </p>
      )}
      {open !== null && (
        <CatalogLightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          proof={proof}
        />
      )}
    </div>
  );
}
function CatalogLightbox({
  photos,
  index,
  onIndex,
  onClose,
  proof,
}: {
  photos: CatalogPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  proof: ProofController;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  const photo = photos[index];
  const step = (amount: number) => onIndex((index + amount + photos.length) % photos.length);
  return (
    <dialog
      ref={ref}
      aria-label="Photograph viewer"
      className="fixed inset-0 z-50 m-0 h-svh max-h-svh w-full max-w-none overflow-y-auto bg-background p-4 text-foreground sm:p-6 backdrop:bg-scrim"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (
          e.target instanceof HTMLElement &&
          (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
        )
          return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        }
        if (e.key === "Home") {
          e.preventDefault();
          onIndex(0);
        }
        if (e.key === "End") {
          e.preventDefault();
          onIndex(photos.length - 1);
        }
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate" aria-live="polite" aria-atomic="true">
          {photo.filename} · {index + 1}/{photos.length}
        </p>
        <Button autoFocus variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      <PreviewImage key={photo.id} photo={photo} />
      <CheckoutPhoto key={`buy:${photo.id}`} galleryId={photo.galleryId} photoId={photo.id} />
      {photo.caption && <p className="mt-3 text-center">{photo.caption}</p>}
      {proof.selection && (
        <Button
          className="mt-3"
          variant="outline"
          disabled={proof.busy}
          aria-pressed={proof.selection.photoIds.includes(photo.id)}
          onClick={() => proof.toggle(photo.id)}
        >
          {proof.selection.photoIds.includes(photo.id) ? "Selected favorite" : "Select favorite"}
        </Button>
      )}
      <div className="mt-3 flex justify-between">
        <Button variant="outline" onClick={() => step(-1)}>
          Previous
        </Button>
        <Button variant="outline" onClick={() => step(1)}>
          Next
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Arrow keys move between photographs. Home / End jump to the first / last. Escape closes the
        viewer.
      </p>
    </dialog>
  );
}
