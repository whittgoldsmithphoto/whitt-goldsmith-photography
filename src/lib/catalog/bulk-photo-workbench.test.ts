import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPhotoSelection,
  planBulkPhotoAction,
  resetSelectionOnGalleryChange,
  selectAllVisiblePhotos,
  selectedPhotoCount,
  togglePhotoSelection,
} from "./bulk-photo-workbench.ts";
import type { OwnerCatalogPhoto } from "./types.ts";

const photos = [
  { id: "a", galleryId: "g1", filename: "a.jpg", caption: "A", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 2, revision: 7, updatedAt: "2025-01-01" },
  { id: "b", galleryId: "g1", filename: "b.jpg", caption: "B", width: 1, height: 1, src: "", thumbSrc: "", hidden: true, archived: false, displayOrder: 1, revision: 3, updatedAt: "2025-01-02" },
  { id: "c", galleryId: "g2", filename: "c.jpg", caption: "C", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 1, revision: 4, updatedAt: "2025-01-03" },
  { id: "d", galleryId: "g1", filename: "d.jpg", caption: "D", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: true, displayOrder: 3, revision: 5, updatedAt: "2025-01-04" },
] as OwnerCatalogPhoto[];

test("toggles selection without duplicate ids and preserves other selections", () => {
  assert.deepEqual(togglePhotoSelection([], "a", true), ["a"]);
  assert.deepEqual(togglePhotoSelection(["a"], "a", true), ["a"]);
  assert.deepEqual(togglePhotoSelection(["a", "b"], "a", false), ["b"]);
});

test("select all visible adds only visible ids and does not prune filtered selections", () => {
  assert.deepEqual(selectAllVisiblePhotos(["stale", "a"], [photos[0], photos[0]]), ["stale", "a"]);
  assert.deepEqual(selectAllVisiblePhotos(["c"], [photos[0], photos[1]]), ["c", "a", "b"]);
});

test("clear selection is the explicit pruning operation", () => {
  assert.deepEqual(clearPhotoSelection(), []);
  assert.equal(selectedPhotoCount(["a", "stale", "c"], photos, "g1"), 1);
});

test("switching galleries clears the previous gallery selection", () => {
  assert.deepEqual(resetSelectionOnGalleryChange("g1", "g2", ["a", "b"]), []);
  assert.deepEqual(resetSelectionOnGalleryChange("g1", "g1", ["a", "b"]), ["a", "b"]);
});

for (const [action, expected] of [
  ["hide", [
    { id: "a", revision: 7, caption: "A", hidden: true, archived: false, displayOrder: 2 },
    { id: "b", revision: 3, caption: "B", hidden: true, archived: false, displayOrder: 1 },
    { id: "d", revision: 5, caption: "D", hidden: true, archived: true, displayOrder: 3 },
  ]],
  ["unhide", [
    { id: "a", revision: 7, caption: "A", hidden: false, archived: false, displayOrder: 2 },
    { id: "b", revision: 3, caption: "B", hidden: false, archived: false, displayOrder: 1 },
    { id: "d", revision: 5, caption: "D", hidden: false, archived: true, displayOrder: 3 },
  ]],
  ["archive", [
    { id: "a", revision: 7, caption: "A", hidden: false, archived: true, displayOrder: 2 },
    { id: "b", revision: 3, caption: "B", hidden: true, archived: true, displayOrder: 1 },
    { id: "d", revision: 5, caption: "D", hidden: false, archived: true, displayOrder: 3 },
  ]],
  ["restore", [
    { id: "a", revision: 7, caption: "A", hidden: false, archived: false, displayOrder: 2 },
    { id: "b", revision: 3, caption: "B", hidden: true, archived: false, displayOrder: 1 },
    { id: "d", revision: 5, caption: "D", hidden: false, archived: false, displayOrder: 3 },
  ]],
] as const) {
  test(`plans ${action} while preserving the independent photo flag`, () => {
    assert.deepEqual(planBulkPhotoAction(photos, ["a", "b", "d", "c", "missing"], "g1", action), expected);
  });
}
