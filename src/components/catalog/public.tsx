import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { catalogFetch } from "@/lib/catalog/client";
import { useResourcePage } from "@/lib/catalog/resource-client";
import type { GallerySummary } from "@/lib/catalog/gallery-service";
import type { CatalogGallery, CatalogPhoto } from "@/lib/catalog/types";
import { defaultStudio } from "@/lib/seed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProofPanel } from "./proof-selection";
import { useProofSelection, type ProofController } from "@/lib/catalog/use-proof";
import { PreviewImage } from "./preview-image";
import { ProtectedPhoto } from "./protected-photo";

export function CatalogStatus({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error?: Error;
  reload: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24" role={error ? "alert" : "status"}>
      <p>{loading ? "Loading galleries…" : error?.message}</p>
      {error && (
        <Button className="mt-4" onClick={reload}>
          Try again
        </Button>
      )}
    </div>
  );
}
function Card({ gallery, photos }: { gallery: CatalogGallery; photos: CatalogPhoto[] }) {
  const cover = photos.find((p) => p.galleryId === gallery.id);
  return (
    <Link
      to="/galleries/$galleryId"
      params={{ galleryId: gallery.id }}
      className="group min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      {cover && (
        <ProtectedPhoto
          src={cover.thumbSrc}
          alt=""
          loading="lazy"
          className="aspect-[3/2] w-full rounded-sm object-cover"
        />
      )}
      <div className={`border-b border-border pb-5 pt-4 ${cover ? "" : "border-t"}`}>
        <p className="text-sm text-muted-foreground">{gallery.category}</p>
        <h2 className="mt-2 text-xl font-semibold leading-snug group-hover:underline">
          {gallery.title}
        </h2>
        {gallery.description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {gallery.description}
          </p>
        )}
      </div>
    </Link>
  );
}
export function CatalogIndex({
  page,
  folderId,
}: {
  page: "home" | "galleries" | "about";
  folderId?: string;
}) {
  const [query, setQuery] = useState("");
  const state = useResourcePage<GallerySummary>(
    `/api/catalog/galleries?limit=50&q=${encodeURIComponent(query)}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ""}`,
    true,
  );
  if (!state.data) return <CatalogStatus {...state} />;
  const listed = state.data.data;
  const photos = listed.flatMap((g) => (g.cover ? [g.cover] : []));
  const home = page === "home";
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:px-10">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {defaultStudio.location}
      </p>
      <h1 className="font-display mt-3 max-w-4xl text-4xl font-normal leading-tight sm:text-6xl">
        {home || page === "about" ? defaultStudio.name : "Find your photos"}
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        {page === "about"
          ? "Sports, school games, and events in Greenville, South Carolina. For bookings, coverage requests, or questions about a gallery, contact Whitt on Instagram."
          : home
            ? "Sports and event photography in Greenville."
            : "Browse events or search for your gallery."}
      </p>
      {page !== "galleries" && (
        <div className="my-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/galleries">Find your photos</Link>
          </Button>
          <Button variant="outline" asChild>
            <a
              href="https://www.instagram.com/whittgoldsmithphotography/"
              target="_blank"
              rel="noreferrer"
            >
              Contact Whitt
            </a>
          </Button>
        </div>
      )}
      {home && photos[0] && (
        <Link to="/galleries/$galleryId" params={{ galleryId: photos[0].galleryId }}>
          <ProtectedPhoto
            src={photos[0].src}
            alt={photos[0].caption || photos[0].filename}
            className="mb-12 max-h-[70vh] w-full rounded-sm object-contain"
          />
        </Link>
      )}
      {page === "galleries" && (
        <div className="my-8 border-b border-border pb-6">
          <label htmlFor="gallery-search" className="mb-2 block text-sm font-medium">
            Search galleries
          </label>
          <div className="flex max-w-xl items-center gap-3">
            <Input
              id="gallery-search"
              className="min-h-12"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Event, team, or sport"
            />
            {query && (
              <Button variant="outline" className="min-h-12" onClick={() => setQuery("")}>
                Clear
              </Button>
            )}
          </div>
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {state.loading
              ? "Searching…"
              : `${listed.length} ${listed.length === 1 ? "gallery" : "galleries"}${state.data.page.hasMore ? " loaded" : ""}`}
          </p>
        </div>
      )}
      {page !== "about" &&
        (listed.length ? (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {listed.map((g) => (
              <Card key={g.id} gallery={g} photos={photos} />
            ))}
          </div>
        ) : (
          <div className="border-t border-border py-12">
            <h2 className="font-display text-2xl">
              {query ? "No matching galleries" : "No public galleries yet"}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {query ? "Try a different search." : "Published collections will appear here."}
            </p>
            {query && (
              <Button variant="outline" className="mt-4" onClick={() => setQuery("")}>
                Clear search
              </Button>
            )}
          </div>
        ))}
      {page !== "about" && state.data.page.hasMore && (
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
          {state.error.message} Retry using Load more galleries.
        </p>
      )}
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
        <h1 className="font-display text-3xl">Protected gallery</h1>
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
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <Link
        to="/galleries"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        All galleries
      </Link>
      <p className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">
        {gallery.category}
      </p>
      <h1 className="font-display mt-2 max-w-4xl text-4xl font-normal leading-tight sm:text-5xl">
        {gallery.title}
      </h1>
      <p className="my-5 max-w-2xl text-muted-foreground">{gallery.description}</p>
      <section
        aria-label="Gallery instructions and download policy"
        className="my-5 max-w-3xl space-y-3 border-l-2 border-border pl-4"
      >
        {gallery.customerInstructions && (
          <>
            <h2 className="font-display text-xl">Gallery instructions</h2>
            <p className="whitespace-pre-wrap break-words">{gallery.customerInstructions}</p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {gallery.downloadPolicy === "purchased_only"
            ? "Download policy: purchased files only. Customer downloads are not available yet; a confirmed purchase and valid download entitlement will be required."
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
      <p className="mb-4 mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        {photos.length} {photos.length === 1 ? "photograph" : "photographs"}
        {resource.data?.page.hasMore ? " loaded" : ""}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 md:gap-x-5">
        {photos.map((p, i) => (
          <div key={p.id}>
            <button
              type="button"
              key={p.id}
              aria-label={`Open ${p.filename}`}
              onClick={() => setOpen(i)}
              className={`block w-full overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 ${proof.selection?.photoIds.includes(p.id) ? "outline-2 outline-offset-2 outline-primary" : ""}`}
            >
              <ProtectedPhoto
                src={p.thumbSrc}
                alt={p.caption || p.filename}
                loading="lazy"
                className="aspect-[3/2] w-full object-cover"
              />
            </button>
            {proof.selection && (
              <Button
                className="mt-2 w-full"
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
      className="fixed inset-0 m-auto max-h-svh w-full max-w-6xl overflow-y-auto bg-background p-4 text-foreground backdrop:bg-black/90"
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
