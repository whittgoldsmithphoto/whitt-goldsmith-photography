import type { OwnerCatalogPhoto } from "./types";

export type OrganizerPhotoFilter = "all" | "visible" | "hidden" | "archived";
export type OrganizerPhotoSort = "display-order" | "filename" | "newest-updated";
type OrganizerPhoto = OwnerCatalogPhoto;

const compareFilename = (left: string, right: string) => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
};

const timestamp = (value: OrganizerPhoto["updatedAt"]) => {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
};

export function filterAndSortOwnerPhotos(
  photos: readonly OrganizerPhoto[],
  galleryId: string | undefined,
  filter: OrganizerPhotoFilter,
  sort: OrganizerPhotoSort,
): OrganizerPhoto[] {
  const scoped = photos.filter((photo) => {
    if (photo.galleryId !== galleryId) return false;
    if (filter === "hidden") return photo.hidden && !photo.archived;
    if (filter === "archived") return photo.archived;
    if (filter === "visible") return !photo.hidden && !photo.archived;
    return true;
  });
  return scoped
    .map((photo, index) => ({ photo, index }))
    .sort((left, right) => {
      let result = 0;
      if (sort === "display-order") result = left.photo.displayOrder - right.photo.displayOrder;
      if (sort === "filename") result = compareFilename(left.photo.filename, right.photo.filename);
      if (sort === "newest-updated") {
        const a = timestamp(left.photo.updatedAt);
        const b = timestamp(right.photo.updatedAt);
        result = a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : b - a;
      }
      return result || left.index - right.index;
    })
    .map(({ photo }) => photo);
}

export function reorderPhotoIds(ids: readonly string[], from: number, to: number): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= ids.length ||
    to >= ids.length
  )
    return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
