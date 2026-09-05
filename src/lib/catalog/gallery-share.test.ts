import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryShareUrl, galleryQrSvg } from "./gallery-share.ts";

const gallery = {
  id: "97c36bdd-7b15-46d6-83ae-950bc4d1b7b1",
  published: true,
  visibility: "unlisted",
};
test("gallery sharing uses the current site and never includes access tokens", () => {
  assert.equal(
    galleryShareUrl("https://photos.example.com", gallery),
    `https://photos.example.com/galleries/${gallery.id}`,
  );
  for (const origin of [
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com/?token=secret",
  ])
    assert.throws(() => galleryShareUrl(origin, gallery));
  assert.throws(() => galleryShareUrl("https://example.com", { ...gallery, id: "../private" }));
});
test("draft and owner-only galleries cannot produce customer share codes", async () => {
  for (const hidden of [
    { ...gallery, published: false },
    { ...gallery, visibility: "private" },
  ])
    await assert.rejects(galleryQrSvg("https://example.com", hidden), /Publish/);
});
test("published gallery generates a standalone high-contrast SVG with a quiet zone", async () => {
  const svg = await galleryQrSvg("https://example.com", gallery);
  assert.match(svg, /<svg/);
  assert.match(svg, /#ffffff/);
  assert.match(svg, /#000000/);
  assert.doesNotMatch(svg, /<script|<foreignObject|https:\/\/.*token/);
});
