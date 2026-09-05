import { test } from "node:test";
import assert from "node:assert/strict";
import { processArchiveQueueBatch } from "./archive-queue.ts";

test("archive queue handles only its strict envelope and leaves media messages alone", async () => {
  let ack = 0,
    calls = 0;
  const message = (body: unknown) => ({
    body,
    attempts: 1,
    ack: () => {
      ack++;
    },
    retry: () => {},
  });
  const media = message({ version: 1, jobId: "photo-job" });
  const forged = message({ version: 1, kind: "album_archive", objectKey: "private/forged" });
  const remaining = await processArchiveQueueBatch(
    { messages: [media, forged, message({ version: 1, kind: "album_archive" })] },
    async () => {
      calls++;
      return "completed";
    },
  );
  assert.deepEqual(remaining, [media, forged]);
  assert.equal(ack, 1);
  assert.equal(calls, 1);
});
test("archive queue retries provider failures and acknowledges idle or disabled processing", async () => {
  for (const outcome of ["retry", "throws", "idle", "disabled"] as const) {
    let ack = 0,
      retries = 0;
    await processArchiveQueueBatch(
      {
        messages: [
          {
            body: { version: 1, kind: "album_archive" },
            attempts: 1,
            ack: () => {
              ack++;
            },
            retry: () => {
              retries++;
            },
          },
        ],
      },
      async () => {
        if (outcome === "throws") throw new Error("private error");
        return outcome;
      },
    );
    assert.equal(retries, outcome === "retry" || outcome === "throws" ? 1 : 0);
    assert.equal(ack, 1 - retries);
  }
});
