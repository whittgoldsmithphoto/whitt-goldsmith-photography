import assert from "node:assert/strict";
import test from "node:test";
import { filterAndSortOwnerPhotos, type OrganizerPhotoFilter } from "./organizer-photo-view.ts";
import type { OwnerCatalogPhoto } from "./types.ts";

const photos = [
  { id: "z", galleryId: "g1", filename: "zeta.jpg", caption: "", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 2, revision: 1, updatedAt: "2024-01-02T00:00:00Z" },
  { id: "a", galleryId: "g1", filename: "Alpha.jpg", caption: "", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 2, revision: 1, updatedAt: "2024-01-04T00:00:00Z" },
  { id: "h", galleryId: "g1", filename: "hidden.jpg", caption: "", width: 1, height: 1, src: "", thumbSrc: "", hidden: true, archived: false, displayOrder: 1, revision: 1, updatedAt: "2024-01-03T00:00:00Z" },
  { id: "r", galleryId: "g1", filename: "archived.jpg", caption: "", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: true, displayOrder: 0, revision: 1, updatedAt: "2024-01-05T00:00:00Z" },
  { id: "other", galleryId: "g2", filename: "other.jpg", caption: "", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 0, revision: 1, updatedAt: "2025-01-01T00:00:00Z" },
] as OwnerCatalogPhoto[];

for (const filter of ["all", "visible", "hidden", "archived"] as OrganizerPhotoFilter[]) {
  test(`filters active gallery photos by ${filter}`, () => {
    const result = filterAndSortOwnerPhotos(photos, "g1", filter, "display-order");
    assert.deepEqual(result.map((photo) => photo.id), filter === "all" ? ["r", "h", "z", "a"] : filter === "visible" ? ["z", "a"] : filter === "hidden" ? ["h"] : ["r"]);
  });
}

test("sorts display order with upload/id tie-break", () => {
  assert.deepEqual(filterAndSortOwnerPhotos(photos, "g1", "all", "display-order").map((photo) => photo.id), ["r", "h", "z", "a"]);
});

test("sorts filenames with deterministic locale-insensitive comparison", () => {
  assert.deepEqual(filterAndSortOwnerPhotos(photos, "g1", "all", "filename").map((photo) => photo.filename), ["Alpha.jpg", "archived.jpg", "hidden.jpg", "zeta.jpg"]);
});

test("sorts newest updated safely when timestamps are invalid", () => {
  const input = photos.map((photo) => photo.id === "a" ? { ...photo, updatedAt: "not-a-date" } : photo);
  assert.deepEqual(filterAndSortOwnerPhotos(input, "g1", "all", "newest-updated").map((photo) => photo.id), ["r", "h", "z", "a"]);
});
