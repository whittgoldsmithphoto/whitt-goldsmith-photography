import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadBatch,
  reconcileProcessing,
  type UploadFile,
  type UploadItem,
} from "./upload-batch.ts";

test("processing recovery updates the exact photo without matching duplicate filenames", () => {
  const items: UploadItem[] = [
    { index: 0, filename: "same.jpg", photoId: "a", state: "review" },
    { index: 1, filename: "same.jpg", photoId: "b", state: "failed", error: "Retry" },
  ];
  const updated = reconcileProcessing(items, { id: "a", status: "ready" });
  assert.equal(updated[0].state, "ready");
  assert.equal(updated[1], items[1]);
  assert.equal(reconcileProcessing(items, { id: "a", status: "unknown" }), items);
  assert.equal(reconcileProcessing(items, { id: "a", status: "needs_review" })[0].state, "review");
});

function file(name = "photo.jpg", type = "image/jpeg"): UploadFile {
  const bytes = new Uint8Array([255, 216, 255, 1]);
  return { name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer };
}
test("a failed file does not stop later uploads and only verified ready is counted", async () => {
  let reservations = 0;
  const updates: UploadItem[] = [];
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file("first.jpg"), file("second.jpg")],
    onItem: (item) => updates.push(item),
    transport: async (query) => {
      if (query === "op=reserve")
        return { id: String(++reservations), status: "reserved", duplicate: false };
      if (query.endsWith("id=1")) throw new Error("Storage unavailable");
      return { status: "ready" };
    },
  });
  assert.deepEqual(
    results.map((item) => item.state),
    ["failed", "ready"],
  );
  assert.equal(results[0].error, "Storage unavailable");
  assert.deepEqual(
    updates.map((item) => item.state),
    ["hashing", "uploading", "failed", "hashing", "uploading", "ready"],
  );
});
test("a duplicate ready original is not retransmitted; processing failures remain review", async () => {
  let count = 0;
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file(), file()],
    onItem: () => {},
    transport: async (query) => {
      assert.equal(query, "op=reserve");
      return { id: "saved", status: ++count === 1 ? "ready" : "needs_review", duplicate: true };
    },
  });
  assert.deepEqual(
    results.map((item) => item.state),
    ["duplicate", "review"],
  );
});
test("stop finishes current file and never reserves remaining files", async () => {
  let stop = false;
  let calls = 0;
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file(), file(), file()],
    shouldStop: () => stop,
    onItem: () => {},
    transport: async (query) => {
      calls++;
      if (query === "op=reserve") return { id: "one", status: "reserved", duplicate: false };
      stop = true;
      return { status: "ready" };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    results.map((item) => item.state),
    ["ready", "cancelled", "cancelled"],
  );
});
test("unsupported and oversized files fail before any network operation", async () => {
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file("raw.nef", "application/octet-stream"), { ...file(), size: 20 * 1024 * 1024 + 1 }],
    onItem: () => {},
    transport: async () => {
      throw new Error("Network must not be used");
    },
  });
  assert.ok(results.every((item) => item.state === "failed" && item.error?.includes("20 MiB")));
});
test("uncertain completion cannot be reported as successful", async () => {
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file()],
    onItem: () => {},
    transport: async (query) =>
      query === "op=reserve" ? { id: "one", status: "reserved" } : { ok: true },
  });
  assert.equal(results[0].state, "failed");
});
test("reservation contains actual SHA-256, gallery, length and MIME; failed reservation can resume", async () => {
  let input: unknown;
  const original = file();
  const results = await uploadBatch({
    galleryId: "target-gallery",
    files: [original],
    onItem: () => {},
    transport: async (query, body, raw) => {
      if (query === "op=reserve") {
        input = body;
        return { id: "saved", status: "failed", duplicate: true };
      }
      assert.equal(raw, true);
      assert.deepEqual(body, await original.arrayBuffer());
      return { status: "needs_review" };
    },
  });
  assert.deepEqual(input, {
    galleryId: "target-gallery",
    filename: "photo.jpg",
    mime: "image/jpeg",
    bytes: 4,
    checksum: Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await original.arrayBuffer())),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    idempotencyKey: (input as { idempotencyKey: string }).idempotencyKey,
  });
  assert.match((input as { idempotencyKey: string }).idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(results[0].state, "review");
});

test("a lost reservation response replays once with the identical idempotency key", async () => {
  const bodies: unknown[] = [];
  const results = await uploadBatch({
    galleryId: "gallery",
    files: [file()],
    onItem: () => {},
    transport: async (query, body) => {
      if (query === "op=reserve") {
        bodies.push(body);
        if (bodies.length === 1) throw new Error("Response lost");
        return { id: "saved", status: "ready", duplicate: true };
      }
      throw new Error("Original must not be retransmitted");
    },
  });
  assert.equal(results[0].state, "duplicate");
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
});
