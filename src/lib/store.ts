import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CartItem,
  ColorLabel,
  Coupon,
  Folder,
  Gallery,
  GalleryLayout,
  Order,
  OrderStatus,
  Photo,
  PhotoSort,
  PriceList,
  Privacy,
  Product,
  StudioProfile,
  UploadJob,
} from "./types";
import {
  defaultStudio,
  seedCoupons,
  seedFolders,
  seedGalleries,
  seedOrders,
  seedPhotos,
  seedPriceLists,
  seedProducts,
} from "./seed";
import { uid } from "./utils";
import { isBlobSrc } from "./idb";
import { ingestFile, removeVault, storeVault, type IngestedFile } from "./vault";
import { canMoveNode, descendantFolderIds } from "./tree";
import { cartTotals, nextOrderNumber } from "./commerce";
import { createR2Upload } from "./shop-fns";
import { r2Slug } from "./r2-path";

type StudioState = {
  hydrated: boolean;
  studio: StudioProfile;
  folders: Folder[];
  galleries: Gallery[];
  photos: Photo[];
  jobs: UploadJob[];
  products: Product[];
  priceLists: PriceList[];
  coupons: Coupon[];
  cart: CartItem[];
  appliedCoupon: string | null;
  orders: Order[];
  setHydrated: (v: boolean) => void;
  updateStudio: (patch: Partial<StudioProfile>) => void;
  createFolder: (input: { title: string; description?: string; parentId: string | null }) => string;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  deleteFolder: (id: string) => Promise<void>;
  moveNode: (kind: "folder" | "gallery", id: string, parentId: string | null) => boolean;
  createGallery: (input: {
    title: string;
    description: string;
    category: string;
    layout?: GalleryLayout;
    parentId?: string | null;
    privacy?: Privacy;
    password?: string | null;
    forSale?: boolean;
    priceListId?: string | null;
  }) => string;
  updateGallery: (id: string, patch: Partial<Gallery>) => void;
  deleteGallery: (id: string) => Promise<void>;
  setCover: (galleryId: string, photoId: string) => void;
  addPhotosFromFiles: (galleryId: string, files: File[]) => Promise<number>;
  importPhotos: (items: { galleryId: string; file: File }[]) => Promise<{ added: number; skipped: number; errors: number }>;
  replacePhoto: (id: string, file: File) => Promise<void>;
  updatePhoto: (id: string, patch: Partial<Photo>) => void;
  deletePhoto: (id: string) => Promise<void>;
  deletePhotos: (ids: string[]) => Promise<void>;
  archivePhotos: (ids: string[]) => void;
  restorePhotos: (ids: string[]) => void;
  emptyArchive: () => Promise<void>;
  toggleFavorite: (id: string) => void;
  toggleHidden: (id: string) => void;
  setRating: (ids: string[], rating: number) => void;
  setLabel: (ids: string[], label: ColorLabel) => void;
  addKeywords: (ids: string[], tags: string[]) => void;
  setPhotosForSale: (ids: string[], forSale: boolean) => void;
  movePhotos: (ids: string[], galleryId: string) => void;
  copyPhotos: (ids: string[], galleryId: string) => number;
  addFromLibrary: (ids: string[], galleryId: string) => number;
  reorderPhotos: (galleryId: string, orderedIds: string[]) => void;
  createProduct: (input: Omit<Product, "id">) => string;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  createPriceList: (input: { name: string; description: string; productIds: string[] }) => string;
  updatePriceList: (id: string, patch: Partial<PriceList>) => void;
  deletePriceList: (id: string) => void;
  createCoupon: (input: Omit<Coupon, "id">) => string | null;
  updateCoupon: (id: string, patch: Partial<Coupon>) => void;
  deleteCoupon: (id: string) => void;
  applyCoupon: (code: string) => string | null;
  clearCoupon: () => void;
  addToCart: (photoId: string, productId: string, qty?: number) => void;
  updateCartQty: (id: string, qty: number) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  placeOrder: (input: { buyerName: string; buyerEmail: string; note: string }) => string | null;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  resetStudio: () => Promise<void>;
};

function hydratePhoto(p: Photo): Photo {
  const seed = seedPhotos.find((s) => s.id === p.id);
  return {
    ...p,
    originalSrc: p.originalSrc ?? p.src,
    thumbSrc: p.thumbSrc ?? p.src,
    originalWidth: p.originalWidth ?? p.width,
    originalHeight: p.originalHeight ?? p.height,
    modifiedAt: p.modifiedAt ?? p.createdAt,
    hidden: p.hidden ?? false,
    archived: p.archived ?? false,
    filename: p.filename ?? `${p.id}.jpg`,
    mime: p.mime ?? "image/jpeg",
    bytes: p.bytes ?? 0,
    tags: p.tags ?? [],
    caption: p.caption ?? "",
    rating: p.rating ?? seed?.rating ?? 0,
    label: p.label ?? seed?.label ?? "none",
    forSale: p.forSale ?? seed?.forSale ?? true,
  };
}

function hydrateOrder(o: Order): Order {
  return {
    ...o,
    subtotal: o.subtotal ?? o.total,
    discount: o.discount ?? 0,
    number: o.number.replace(/^L-/, "WG-"),
  };
}

function hydrateGallery(g: Gallery): Gallery {
  const seed = seedGalleries.find((s) => s.id === g.id);
  return {
    ...g,
    parentId: g.parentId === undefined ? null : g.parentId,
    privacy: g.privacy ?? "public",
    sortBy: g.sortBy ?? "manual",
    position: g.position ?? 0,
    forSale: g.forSale ?? seed?.forSale ?? false,
    priceListId: g.priceListId === undefined ? (seed?.priceListId ?? null) : g.priceListId,
    password: g.password ?? null,
  };
}

function galleryR2Slugs(state: { folders: Folder[]; galleries: Gallery[] }, galleryId: string) {
  const gallery = state.galleries.find((g) => g.id === galleryId);
  const folder = state.folders.find((f) => f.id === gallery?.parentId);
  return {
    folderSlug: r2Slug(folder?.title || "uncategorized", "uncategorized"),
    gallerySlug: r2Slug(gallery?.title || galleryId, galleryId),
  };
}

async function pushVaultToR2(
  photoId: string,
  ingested: IngestedFile,
  slugs: { folderSlug: string; gallerySlug: string },
) {
  try {
    const path = {
      folderSlug: slugs.folderSlug,
      gallerySlug: slugs.gallerySlug,
      filename: ingested.filename,
    };
    const orig = await createR2Upload({
      data: { photoId, kind: "orig", contentType: ingested.mime || "image/jpeg", ...path },
    });
    if (!orig.connected) return {} as const;
    await fetch(orig.url, {
      method: "PUT",
      body: ingested.original,
      headers: { "Content-Type": ingested.mime || "image/jpeg" },
    });
    const display = await createR2Upload({
      data: { photoId, kind: "display", contentType: "image/jpeg", ...path },
    });
    if (display.connected) {
      await fetch(display.url, {
        method: "PUT",
        body: ingested.display,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    const thumb = await createR2Upload({
      data: { photoId, kind: "thumb", contentType: "image/jpeg", ...path },
    });
    if (thumb.connected) {
      await fetch(thumb.url, {
        method: "PUT",
        body: ingested.thumb,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    return {
      r2OriginalKey: orig.key,
      r2DisplayKey: display.connected ? display.key : undefined,
      r2ThumbKey: thumb.connected ? thumb.key : undefined,
    };
  } catch {
    return {} as const;
  }
}

function nextPosition<T extends { position: number }>(items: T[]) {
  return items.reduce((m, i) => Math.max(m, i.position), -1) + 1;
}

function blobInUse(src: string, photos: Photo[], except: Set<string>) {
  return photos.some(
    (p) =>
      !except.has(p.id) &&
      (p.src === src || p.originalSrc === src || p.thumbSrc === src),
  );
}

async function releaseBlobs(photos: Photo[], remaining: Photo[]) {
  const except = new Set(photos.map((p) => p.id));
  for (const photo of photos) {
    for (const src of [photo.src, photo.originalSrc, photo.thumbSrc]) {
      if (!isBlobSrc(src)) continue;
      if (blobInUse(src, remaining, except)) continue;
      const key = src.slice(4);
      const base = key.replace(/:(orig|thumb)$/, "");
      await removeVault(base);
    }
  }
}

function mergeById<T extends { id: string }>(persisted: T[] | undefined, seed: T[]) {
  if (persisted === undefined) return seed;
  const ids = new Set(persisted.map((i) => i.id));
  return [...persisted, ...seed.filter((i) => !ids.has(i.id))];
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      studio: defaultStudio,
      folders: seedFolders,
      galleries: seedGalleries,
      photos: seedPhotos,
      jobs: [],
      products: seedProducts,
      priceLists: seedPriceLists,
      coupons: seedCoupons,
      cart: [],
      appliedCoupon: null,
      orders: seedOrders,

      setHydrated: (v) => set({ hydrated: v }),

      updateStudio: (patch) => set((s) => ({ studio: { ...s.studio, ...patch } })),

      createFolder: (input) => {
        const id = uid();
        const siblings = get().folders.filter((f) => f.parentId === input.parentId);
        const folder: Folder = {
          id,
          parentId: input.parentId,
          title: input.title.trim() || "Untitled folder",
          description: input.description?.trim() ?? "",
          highlightImageId: null,
          position: nextPosition(siblings),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ folders: [...s.folders, folder] }));
        return id;
      },

      updateFolder: (id, patch) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f,
          ),
        })),

      deleteFolder: async (id) => {
        const folders = get().folders;
        const ids = new Set([id, ...descendantFolderIds(folders, id)]);
        const galleries = get().galleries.filter((g) => g.parentId && ids.has(g.parentId));
        for (const g of galleries) await get().deleteGallery(g.id);
        set((s) => ({
          folders: s.folders.filter((f) => !ids.has(f.id)),
        }));
      },

      moveNode: (kind, id, parentId) => {
        if (!canMoveNode(get().folders, id, kind, parentId)) return false;
        if (kind === "folder") {
          set((s) => ({
            folders: s.folders.map((f) =>
              f.id === id ? { ...f, parentId, updatedAt: Date.now() } : f,
            ),
          }));
        } else {
          set((s) => ({
            galleries: s.galleries.map((g) =>
              g.id === id ? { ...g, parentId, updatedAt: Date.now() } : g,
            ),
          }));
        }
        return true;
      },

      createGallery: (input) => {
        const id = uid();
        const now = Date.now();
        const siblings = get().galleries.filter((g) => g.parentId === (input.parentId ?? null));
        const gallery: Gallery = {
          id,
          parentId: input.parentId ?? null,
          title: input.title.trim() || "Untitled gallery",
          description: input.description.trim(),
          category: input.category.trim() || "General",
          coverPhotoId: null,
          layout: input.layout ?? "justified",
          featured: false,
          privacy: input.privacy ?? "public",
          sortBy: "manual",
          position: nextPosition(siblings),
          createdAt: now,
          updatedAt: now,
          forSale: input.forSale ?? false,
          priceListId: input.priceListId ?? null,
          password: input.password ?? null,
        };
        set((s) => ({ galleries: [gallery, ...s.galleries] }));
        return id;
      },

      updateGallery: (id, patch) =>
        set((s) => ({
          galleries: s.galleries.map((g) =>
            g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g,
          ),
        })),

      deleteGallery: async (id) => {
        const doomed = get().photos.filter((p) => p.galleryId === id);
        const remaining = get().photos.filter((p) => p.galleryId !== id);
        await releaseBlobs(doomed, remaining);
        set((s) => ({
          galleries: s.galleries.filter((g) => g.id !== id),
          photos: s.photos.filter((p) => p.galleryId !== id),
        }));
      },

      setCover: (galleryId, photoId) =>
        set((s) => ({
          galleries: s.galleries.map((g) =>
            g.id === galleryId ? { ...g, coverPhotoId: photoId, updatedAt: Date.now() } : g,
          ),
        })),

      addPhotosFromFiles: async (galleryId, files) => {
        const gallery = get().galleries.find((g) => g.id === galleryId);
        if (!gallery) return 0;
        const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
        let added = 0;
        for (const file of list) {
          const jobId = uid();
          set((s) => ({
            jobs: [
              ...s.jobs,
              { id: jobId, galleryId, filename: file.name, status: "working" as const },
            ].slice(-400),
          }));
          try {
            const ingested = await ingestFile(file);
            const existing = get().photos.find(
              (p) => p.hash && p.hash === ingested.hash && p.galleryId === galleryId && !p.archived,
            );
            if (existing) {
              set((s) => ({
                jobs: s.jobs.map((j) =>
                  j.id === jobId
                    ? { ...j, status: "skipped" as const, message: "Already in this gallery" }
                    : j,
                ),
              }));
              continue;
            }
            const shared = get().photos.find((p) => p.hash && p.hash === ingested.hash && !p.archived);
            const id = uid();
            let src: string;
            let originalSrc: string;
            let thumbSrc: string;
            if (shared) {
              src = shared.src;
              originalSrc = shared.originalSrc;
              thumbSrc = shared.thumbSrc;
            } else {
              await storeVault(id, ingested);
              src = `idb:${id}`;
              originalSrc = `idb:${id}:orig`;
              thumbSrc = `idb:${id}:thumb`;
            }
            const r2 = shared ? {} : await pushVaultToR2(id, ingested, galleryR2Slugs(get(), galleryId));
            const inGallery = get().photos.filter((p) => p.galleryId === galleryId && !p.archived);
            const photo: Photo = {
              id,
              galleryId,
              title: ingested.title || "Untitled",
              caption: "",
              tags: [],
              src,
              originalSrc,
              thumbSrc,
              width: ingested.width,
              height: ingested.height,
              originalWidth: ingested.originalWidth,
              originalHeight: ingested.originalHeight,
              createdAt: Date.now(),
              modifiedAt: Date.now(),
              takenAt: ingested.takenAt,
              favorite: false,
              hidden: false,
              archived: false,
              position: nextPosition(inGallery),
              filename: ingested.filename,
              mime: ingested.mime,
              bytes: shared ? 0 : ingested.bytes,
              hash: ingested.hash,
              rating: 0,
              label: "none",
              forSale: true,
              ...r2,
            };
            set((s) => ({
              photos: [...s.photos, photo],
              galleries: s.galleries.map((g) =>
                g.id === galleryId
                  ? {
                      ...g,
                      coverPhotoId: g.coverPhotoId ?? photo.id,
                      updatedAt: Date.now(),
                    }
                  : g,
              ),
              jobs: s.jobs.map((j) =>
                j.id === jobId ? { ...j, status: "done" as const, message: r2.r2OriginalKey || undefined } : j,
              ),
            }));
            added += 1;
          } catch (err) {
            set((s) => ({
              jobs: s.jobs.map((j) =>
                j.id === jobId
                  ? {
                      ...j,
                      status: "error" as const,
                      message: err instanceof Error ? err.message : "Failed",
                    }
                  : j,
              ),
            }));
          }
        }
        return added;
      },

      importPhotos: async (items) => {
        let added = 0;
        let skipped = 0;
        let errors = 0;
        const byGallery = new Map<string, File[]>();
        for (const item of items) {
          const list = byGallery.get(item.galleryId) ?? [];
          list.push(item.file);
          byGallery.set(item.galleryId, list);
        }
        for (const [galleryId, files] of byGallery) {
          added += await get().addPhotosFromFiles(galleryId, files);
        }
        const jobs = get().jobs.slice(-items.length);
        skipped = jobs.filter((j) => j.status === "skipped").length;
        errors = jobs.filter((j) => j.status === "error").length;
        return { added, skipped, errors };
      },

      replacePhoto: async (id, file) => {
        const photo = get().photos.find((p) => p.id === id);
        if (!photo) return;
        const ingested = await ingestFile(file);
        const others = get().photos.filter((p) => p.id !== id);
        await releaseBlobs([photo], others);
        await storeVault(id, ingested);
        const r2 = await pushVaultToR2(id, ingested, galleryR2Slugs(get(), photo.galleryId));
        set((s) => ({
          photos: s.photos.map((p) =>
            p.id === id
              ? {
                  ...p,
                  src: `idb:${id}`,
                  originalSrc: `idb:${id}:orig`,
                  thumbSrc: `idb:${id}:thumb`,
                  width: ingested.width,
                  height: ingested.height,
                  originalWidth: ingested.originalWidth,
                  originalHeight: ingested.originalHeight,
                  filename: ingested.filename,
                  mime: ingested.mime,
                  bytes: ingested.bytes,
                  hash: ingested.hash,
                  modifiedAt: Date.now(),
                  takenAt: ingested.takenAt,
                  ...r2,
                }
              : p,
          ),
        }));
      },

      updatePhoto: (id, patch) =>
        set((s) => ({
          photos: s.photos.map((p) =>
            p.id === id ? { ...p, ...patch, modifiedAt: Date.now() } : p,
          ),
        })),

      deletePhoto: async (id) => {
        await get().deletePhotos([id]);
      },

      deletePhotos: async (ids) => {
        const setIds = new Set(ids);
        const doomed = get().photos.filter((p) => setIds.has(p.id));
        const remaining = get().photos.filter((p) => !setIds.has(p.id));
        await releaseBlobs(doomed, remaining);
        set((s) => ({
          photos: remaining,
          galleries: s.galleries.map((g) => {
            if (!g.coverPhotoId || !setIds.has(g.coverPhotoId)) return g;
            const next = remaining.find((p) => p.galleryId === g.id && !p.archived);
            return { ...g, coverPhotoId: next?.id ?? null, updatedAt: Date.now() };
          }),
        }));
      },

      archivePhotos: (ids) => {
        const setIds = new Set(ids);
        const now = Date.now();
        set((s) => ({
          photos: s.photos.map((p) =>
            setIds.has(p.id) ? { ...p, archived: true, archivedAt: now } : p,
          ),
        }));
      },

      restorePhotos: (ids) => {
        const setIds = new Set(ids);
        set((s) => ({
          photos: s.photos.map((p) =>
            setIds.has(p.id) ? { ...p, archived: false, archivedAt: undefined } : p,
          ),
        }));
      },

      emptyArchive: async () => {
        const doomed = get().photos.filter((p) => p.archived);
        await get().deletePhotos(doomed.map((p) => p.id));
      },

      toggleFavorite: (id) =>
        set((s) => ({
          photos: s.photos.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
        })),

      toggleHidden: (id) =>
        set((s) => ({
          photos: s.photos.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p)),
        })),

      setRating: (ids, rating) => {
        const setIds = new Set(ids);
        const next = Math.max(0, Math.min(5, rating));
        set((s) => ({
          photos: s.photos.map((p) =>
            setIds.has(p.id) ? { ...p, rating: next, modifiedAt: Date.now() } : p,
          ),
        }));
      },

      setLabel: (ids, label) => {
        const setIds = new Set(ids);
        set((s) => ({
          photos: s.photos.map((p) =>
            setIds.has(p.id) ? { ...p, label, modifiedAt: Date.now() } : p,
          ),
        }));
      },

      addKeywords: (ids, tags) => {
        const extra = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (!extra.length) return;
        const setIds = new Set(ids);
        set((s) => ({
          photos: s.photos.map((p) => {
            if (!setIds.has(p.id)) return p;
            return {
              ...p,
              tags: Array.from(new Set([...p.tags, ...extra])),
              modifiedAt: Date.now(),
            };
          }),
        }));
      },

      setPhotosForSale: (ids, forSale) => {
        const setIds = new Set(ids);
        set((s) => ({
          photos: s.photos.map((p) =>
            setIds.has(p.id) ? { ...p, forSale, modifiedAt: Date.now() } : p,
          ),
        }));
      },

      movePhotos: (ids, galleryId) => {
        const setIds = new Set(ids);
        const existing = get().photos.filter((p) => p.galleryId === galleryId && !p.archived);
        let position = nextPosition(existing);
        set((s) => ({
          photos: s.photos.map((p) => {
            if (!setIds.has(p.id)) return p;
            return { ...p, galleryId, position: position++, modifiedAt: Date.now() };
          }),
          galleries: s.galleries.map((g) => {
            if (g.id === galleryId && !g.coverPhotoId) {
              return { ...g, coverPhotoId: ids[0] ?? null, updatedAt: Date.now() };
            }
            if (g.coverPhotoId && setIds.has(g.coverPhotoId) && g.id !== galleryId) {
              const next = s.photos.find(
                (p) => p.galleryId === g.id && !setIds.has(p.id) && !p.archived,
              );
              return { ...g, coverPhotoId: next?.id ?? null, updatedAt: Date.now() };
            }
            return g;
          }),
        }));
      },

      copyPhotos: (ids, galleryId) => {
        return get().addFromLibrary(ids, galleryId);
      },

      addFromLibrary: (ids, galleryId) => {
        const gallery = get().galleries.find((g) => g.id === galleryId);
        if (!gallery) return 0;
        const existingHashes = new Set(
          get()
            .photos.filter((p) => p.galleryId === galleryId && !p.archived && p.hash)
            .map((p) => p.hash),
        );
        const existing = get().photos.filter((p) => p.galleryId === galleryId && !p.archived);
        let position = nextPosition(existing);
        const clones: Photo[] = [];
        for (const id of ids) {
          const src = get().photos.find((p) => p.id === id);
          if (!src) continue;
          if (src.hash && existingHashes.has(src.hash)) continue;
          clones.push({
            ...src,
            id: uid(),
            galleryId,
            position: position++,
            archived: false,
            archivedAt: undefined,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            bytes: 0,
          });
          if (src.hash) existingHashes.add(src.hash);
        }
        if (!clones.length) return 0;
        set((s) => ({
          photos: [...s.photos, ...clones],
          galleries: s.galleries.map((g) =>
            g.id === galleryId
              ? { ...g, coverPhotoId: g.coverPhotoId ?? clones[0]?.id ?? null, updatedAt: Date.now() }
              : g,
          ),
        }));
        return clones.length;
      },

      reorderPhotos: (galleryId, orderedIds) => {
        const rank = new Map(orderedIds.map((id, i) => [id, i]));
        set((s) => ({
          photos: s.photos.map((p) =>
            p.galleryId === galleryId && rank.has(p.id)
              ? { ...p, position: rank.get(p.id) ?? p.position }
              : p,
          ),
          galleries: s.galleries.map((g) =>
            g.id === galleryId ? { ...g, sortBy: "manual", updatedAt: Date.now() } : g,
          ),
        }));
      },

      createProduct: (input) => {
        const id = uid();
        set((s) => ({ products: [...s.products, { ...input, id }] }));
        return id;
      },

      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),

      deleteProduct: (id) =>
        set((s) => ({
          products: s.products.filter((p) => p.id !== id),
          priceLists: s.priceLists.map((l) => ({
            ...l,
            productIds: l.productIds.filter((pid) => pid !== id),
          })),
          cart: s.cart.filter((c) => c.productId !== id),
        })),

      createPriceList: (input) => {
        const id = uid();
        set((s) => ({
          priceLists: [
            ...s.priceLists,
            {
              id,
              name: input.name.trim() || "Untitled list",
              description: input.description.trim(),
              productIds: input.productIds,
            },
          ],
        }));
        return id;
      },

      updatePriceList: (id, patch) =>
        set((s) => ({
          priceLists: s.priceLists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

      deletePriceList: (id) =>
        set((s) => ({
          priceLists: s.priceLists.filter((l) => l.id !== id),
          galleries: s.galleries.map((g) =>
            g.priceListId === id ? { ...g, priceListId: null, forSale: false } : g,
          ),
        })),

      createCoupon: (input) => {
        const code = input.code.trim().toUpperCase();
        if (!code) return null;
        if (get().coupons.some((c) => c.code === code)) return null;
        const id = uid();
        const coupon: Coupon = { ...input, id, code };
        set((s) => ({ coupons: [...s.coupons, coupon] }));
        return id;
      },

      updateCoupon: (id, patch) =>
        set((s) => ({
          coupons: s.coupons.map((c) =>
            c.id === id
              ? { ...c, ...patch, code: (patch.code ?? c.code).trim().toUpperCase() }
              : c,
          ),
        })),

      deleteCoupon: (id) =>
        set((s) => {
          const gone = s.coupons.find((c) => c.id === id);
          return {
            coupons: s.coupons.filter((c) => c.id !== id),
            appliedCoupon:
              gone && s.appliedCoupon?.toUpperCase() === gone.code ? null : s.appliedCoupon,
          };
        }),

      applyCoupon: (code) => {
        const needle = code.trim().toUpperCase();
        if (!needle) {
          set({ appliedCoupon: null });
          return "Enter a code";
        }
        const coupon = get().coupons.find((c) => c.code === needle);
        if (!coupon) return "Unknown code";
        if (!coupon.active) return "This code is paused";
        set({ appliedCoupon: needle });
        return null;
      },

      clearCoupon: () => set({ appliedCoupon: null }),

      addToCart: (photoId, productId, qty = 1) => {
        set((s) => {
          const existing = s.cart.find((c) => c.photoId === photoId && c.productId === productId);
          if (existing) {
            return {
              cart: s.cart.map((c) =>
                c.id === existing.id ? { ...c, qty: c.qty + qty } : c,
              ),
            };
          }
          return {
            cart: [...s.cart, { id: uid(), photoId, productId, qty }],
          };
        });
      },

      updateCartQty: (id, qty) => {
        if (qty < 1) {
          get().removeFromCart(id);
          return;
        }
        set((s) => ({
          cart: s.cart.map((c) => (c.id === id ? { ...c, qty } : c)),
        }));
      },

      removeFromCart: (id) => set((s) => ({ cart: s.cart.filter((c) => c.id !== id) })),

      clearCart: () => set({ cart: [] }),

      placeOrder: (input) => {
        const { cart, products, photos, orders, coupons, appliedCoupon } = get();
        if (!cart.length) return null;
        const totals = cartTotals(cart, products, coupons, appliedCoupon);
        const items = cart.map((c) => {
          const photo = photos.find((p) => p.id === c.photoId);
          const product = products.find((p) => p.id === c.productId);
          return {
            photoId: c.photoId,
            photoTitle: photo?.title ?? "Photograph",
            productId: c.productId,
            productName: product?.name ?? "Item",
            qty: c.qty,
            unitPrice: product?.price ?? 0,
            kind: product?.kind ?? ("print" as const),
          };
        });
        const order: Order = {
          id: uid(),
          number: nextOrderNumber(orders),
          createdAt: Date.now(),
          status: "new",
          buyerName: input.buyerName.trim() || "Guest",
          buyerEmail: input.buyerEmail.trim(),
          note: input.note.trim(),
          items,
          subtotal: totals.subtotal,
          discount: totals.discount,
          couponCode: totals.discount > 0 ? (totals.coupon?.code ?? undefined) : undefined,
          total: totals.total,
        };
        set((s) => ({ orders: [order, ...s.orders], cart: [], appliedCoupon: null }));
        return order.id;
      },

      updateOrderStatus: (id, status) =>
        set((s) => ({
          orders: s.orders.map((o) => (o.id === id ? { ...o, status } : o)),
        })),

      resetStudio: async () => {
        const uploaded = get().photos.filter((p) => isBlobSrc(p.src));
        await releaseBlobs(uploaded, []);
        set({
          studio: defaultStudio,
          folders: seedFolders,
          galleries: seedGalleries,
          photos: seedPhotos,
          jobs: [],
          products: seedProducts,
          priceLists: seedPriceLists,
          coupons: seedCoupons,
          cart: [],
          appliedCoupon: null,
          orders: seedOrders,
        });
      },
    }),
    {
      name: "whitt-goldsmith-studio-v5",
      partialize: (s) => ({
        studio: s.studio,
        folders: s.folders,
        galleries: s.galleries,
        photos: s.photos,
        products: s.products,
        priceLists: s.priceLists,
        coupons: s.coupons,
        cart: s.cart,
        appliedCoupon: s.appliedCoupon,
        orders: s.orders,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState>;
        const folders = mergeById(p.folders, current.folders);
        const galleries = mergeById(
          (p.galleries ?? current.galleries).map(hydrateGallery),
          current.galleries,
        );
        const photos = mergeById((p.photos ?? current.photos).map(hydratePhoto), current.photos);
        const products = mergeById(p.products, current.products);
        const priceLists = mergeById(p.priceLists, current.priceLists);
        const coupons = mergeById(p.coupons, current.coupons);
        const orders = (p.orders?.length ? p.orders : current.orders).map(hydrateOrder);
        const persistedName = p.studio?.name?.trim() ?? "";
        const studio =
          !p.studio || persistedName === "" || persistedName === "Lumina"
            ? current.studio
            : {
                ...current.studio,
                ...p.studio,
                watermark: p.studio.watermark ?? true,
                protect: p.studio.protect ?? true,
              };
        return {
          ...current,
          studio,
          folders,
          galleries,
          photos,
          products,
          priceLists,
          coupons,
          cart: p.cart ?? [],
          appliedCoupon: p.appliedCoupon ?? null,
          orders,
        };
      },
    },
  ),
);

export function livePhotos(photos: Photo[]) {
  return photos.filter((p) => !p.archived);
}

export function galleryPhotos(
  photos: Photo[],
  galleryId: string,
  sortBy: PhotoSort = "manual",
  opts?: { includeHidden?: boolean },
) {
  const list = photos.filter(
    (p) => p.galleryId === galleryId && !p.archived && (opts?.includeHidden || !p.hidden),
  );
  const copy = list.slice();
  switch (sortBy) {
    case "filename":
      return copy.sort((a, b) => a.filename.localeCompare(b.filename));
    case "uploaded":
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "taken":
      return copy.sort(
        (a, b) => (b.takenAt ?? b.createdAt) - (a.takenAt ?? a.createdAt),
      );
    case "modified":
      return copy.sort((a, b) => b.modifiedAt - a.modifiedAt);
    case "caption":
      return copy.sort((a, b) => (a.caption || a.title).localeCompare(b.caption || b.title));
    case "rating":
      return copy.sort((a, b) => b.rating - a.rating || a.position - b.position);
    default:
      return copy.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  }
}

export function coverFor(gallery: Gallery, photos: Photo[]): Photo | undefined {
  const live = livePhotos(photos);
  if (gallery.coverPhotoId) {
    const named = live.find((p) => p.id === gallery.coverPhotoId);
    if (named) return named;
  }
  return galleryPhotos(live, gallery.id)[0];
}

export function vaultBytes(photos: Photo[]) {
  const seen = new Set<string>();
  let total = 0;
  for (const p of photos) {
    if (p.archived) continue;
    const key = p.hash || p.originalSrc || p.src;
    if (seen.has(key)) continue;
    if (!isBlobSrc(p.originalSrc || p.src)) continue;
    seen.add(key);
    total += p.bytes || 0;
  }
  return total;
}

export function publicGalleries(galleries: Gallery[]) {
  return galleries.filter((g) => g.privacy !== "private" && g.privacy !== "unlisted");
}

export function saleGalleries(galleries: Gallery[]) {
  return publicGalleries(galleries).filter((g) => g.forSale && g.priceListId);
}
