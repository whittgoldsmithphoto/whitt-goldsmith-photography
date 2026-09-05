import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPhotoSelection,
  planBulkPhotoAction,
  selectAllVisiblePhotos,
  selectedPhotoCount,
  togglePhotoSelection,
  type BulkPhotoAction,
} from "./bulk-photo-workbench.ts";
import type { OwnerCatalogPhoto } from "./types.ts";

const photos = [
  { id: "a", galleryId: "g1", filename: "a.jpg", caption: "A", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 2, revision: 7, updatedAt: "2025-01-01" },
  { id: "b", galleryId: "g1", filename: "b.jpg", caption: "B", width: 1, height: 1, src: "", thumbSrc: "", hidden: true, archived: false, displayOrder: 1, revision: 3, updatedAt: "2025-01-02" },
  { id: "c", galleryId: "g2", filename: "c.jpg", caption: "C", width: 1, height: 1, src: "", thumbSrc: "", hidden: false, archived: false, displayOrder: 1, revision: 4, updatedAt: "2025-01-03" },
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

const expectedByAction = {
  hide: { hidden: true, archived: false },
  unhide: { hidden: false, archived: false },
  archive: { hidden: false, archived: true },
  restore: { hidden: false, archived: false },
} satisfies Record<BulkPhotoAction, Pick<OwnerCatalogPhoto, "hidden" | "archived">>;

for (const action of ["hide", "unhide", "archive", "restore"] as BulkPhotoAction[]) {
  test(`plans ${action} with one revision-preserving input per selected photo in the active gallery`, () => {
    assert.deepEqual(planBulkPhotoAction(photos, ["a", "b", "c", "missing"], "g1", action), [
      { id: "a", revision: 7, caption: "A", ...expectedByAction[action], displayOrder: 2 },
      { id: "b", revision: 3, caption: "B", ...expectedByAction[action], displayOrder: 1 },
    ]);
  });
}
