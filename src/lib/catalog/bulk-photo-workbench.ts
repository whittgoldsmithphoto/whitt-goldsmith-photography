import type { OwnerCatalogPhoto, PhotoInput } from "./types.ts";

export type BulkPhotoAction = "hide" | "unhide" | "archive" | "restore";

export function togglePhotoSelection(selected: string[], id: string, checked: boolean): string[] {
  const unique = [...new Set(selected)];
  return checked ? (unique.includes(id) ? unique : [...unique, id]) : unique.filter((value) => value !== id);
}

export function selectAllVisiblePhotos(selected: string[], visiblePhotos: OwnerCatalogPhoto[]): string[] {
  return [...new Set([...selected, ...visiblePhotos.map((photo) => photo.id)])];
}

export function clearPhotoSelection(): string[] {
  return [];
}

export function selectedPhotoCount(
  selected: string[],
  photos: OwnerCatalogPhoto[],
  activeGalleryId: string | undefined,
): number {
  const ids = new Set(selected);
  return photos.filter((photo) => photo.galleryId === activeGalleryId && ids.has(photo.id)).length;
}

export function planBulkPhotoAction(
  photos: OwnerCatalogPhoto[],
  selected: string[],
  activeGalleryId: string | undefined,
  action: BulkPhotoAction,
): PhotoInput[] {
  const ids = new Set(selected);
  return photos
    .filter((photo) => photo.galleryId === activeGalleryId && ids.has(photo.id))
    .map((photo) => ({
      id: photo.id,
      revision: photo.revision,
      caption: photo.caption,
      hidden: action === "hide" ? true : false,
      archived: action === "archive" ? true : false,
      displayOrder: photo.displayOrder,
    }));
}
