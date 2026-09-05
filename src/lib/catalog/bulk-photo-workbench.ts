import type { OwnerCatalogPhoto, PhotoInput } from "./types.ts";

export type BulkPhotoAction = "hide" | "unhide" | "archive" | "restore";

const BULK_ACTION_PAST_TENSE: Record<BulkPhotoAction, string> = {
  hide: "hidden",
  unhide: "unhidden",
  archive: "archived",
  restore: "restored",
};

export async function executeBulkPhotoAction(
  inputs: PhotoInput[],
  execute: (input: PhotoInput) => Promise<unknown>,
): Promise<void> {
  for (const input of inputs) await execute(input);
}

export async function executeBulkPhotoActionWithReload(
  inputs: PhotoInput[],
  execute: (input: PhotoInput) => Promise<unknown>,
  reload: () => void | Promise<void>,
): Promise<void> {
  try {
    await executeBulkPhotoAction(inputs, execute);
  } catch (error) {
    await reload();
    throw error;
  }
}

export function formatBulkPhotoSuccessMessage(count: number, action: BulkPhotoAction): string {
  return `${count} photograph${count === 1 ? "" : "s"} ${BULK_ACTION_PAST_TENSE[action]} successfully.`;
}

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

export function resetSelectionOnGalleryChange(
  previousGalleryId: string | null,
  nextGalleryId: string | null,
  selected: string[],
): string[] {
  return previousGalleryId === nextGalleryId ? selected : clearPhotoSelection();
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
      hidden: action === "hide" ? true : action === "unhide" ? false : photo.hidden,
      archived: action === "archive" ? true : action === "restore" ? false : photo.archived,
      displayOrder: photo.displayOrder,
    }));
}
