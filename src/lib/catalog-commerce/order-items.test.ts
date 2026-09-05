import { test } from "node:test";
import assert from "node:assert/strict";
import { entitlementsForItem } from "./order-items.ts";
import type { QuoteItem } from "./service.ts";

const item: QuoteItem = {
  productId: "album",
  photoId: "cover",
  name: "Album",
  kind: "gallery_download",
  license: "No resale",
  filename: "Gallery",
  quantity: 1,
  unitCents: 2995,
  lineCents: 2995,
  photoIds: ["one", "two"],
};
const grants = [
  { id: "a", photo_id: "one" },
  { id: "b", photo_id: "unrelated" },
  { id: "c", photo_id: "two" },
];
test("album delivery lists only photos in its purchased snapshot", () => {
  assert.deepEqual(
    entitlementsForItem(item, grants).map((grant) => grant.id),
    ["a", "c"],
  );
});
test("album with absent or empty snapshot fails closed", () => {
  assert.deepEqual(entitlementsForItem({ ...item, photoIds: undefined }, grants), []);
  assert.deepEqual(entitlementsForItem({ ...item, photoIds: [] }, grants), []);
});
test("single photo delivery is limited to its own photo", () => {
  assert.deepEqual(
    entitlementsForItem({ ...item, kind: "digital_photo", photoId: "two" }, grants),
    [grants[2]],
  );
});
