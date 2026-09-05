import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createArchiveJobs } from "./archive-jobs.ts";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { privateArchiveStorage, runArchiveWorker } from "./archive-worker.ts";
import type { ArchiveBucket } from "./archive-r2.ts";

test("durable archive worker produces a verified ZIP through the real storage adapter", async () => {
  const f = await fixture();
  const photo = new Uint8Array([255, 216, 255, 1, 2, 3]);
  const objects = new Map<string, Blob>([["catalog/originals/photo", new Blob([photo])]]);
  const bucket: ArchiveBucket = {
    get: async (key) => {
      const blob = objects.get(key);
      return blob ? { size: blob.size, body: blob.stream() } : null;
    },
    delete: async (key) => {
      objects.delete(key);
    },
    createMultipartUpload: async (key) => {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      return {
        uploadPart: async (_number, bytes) => {
          parts.push(bytes.slice());
          return { etag: String(parts.length) };
        },
        complete: async () => {
          objects.set(key, new Blob(parts));
        },
        abort: async () => {},
      };
    },
  };
  try {
    const job = await f.jobs.enqueue({
      ...input,
      manifest: [
        { ...input.manifest[0], checksum: createHash("sha256").update(photo).digest("hex") },
      ],
    });
    assert.equal(
      await runArchiveWorker({
        jobs: f.jobs,
        ...privateArchiveStorage(bucket),
        authorize: async (current) => {
          assert.equal(current.customer_id, "buyer");
          assert.equal(current.order_id, "order");
        },
      }),
      "completed",
    );
    const saved = (await f.jobs.get(job.id, "buyer"))!;
    const zip = objects.get(saved.output_key!)!;
    assert.deepEqual(unzipSync(new Uint8Array(await zip.arrayBuffer()))["0001-photo.jpg"], photo);
    assert.equal(objects.has("catalog/originals/photo"), true);
  } finally {
    await f.db.close();
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(
    "create table commerce_orders(id text primary key); insert into commerce_orders values ('order')",
  );
  await db.exec(
    await readFile(new URL("../../../migrations/0029_archive_jobs.sql", import.meta.url), "utf8"),
  );
  const sql = {
    query: async (text: string, values: unknown[] = []) => (await db.query(text, values)).rows,
  } as Sql;
  return { db, jobs: createArchiveJobs(sql) };
}
const input = {
  orderId: "order",
  customerId: "buyer",
  manifestHash: "a".repeat(64),
  manifest: [
    {
      photoId: "photo",
      filename: "photo.jpg",
      objectKey: "catalog/originals/photo",
      bytes: 6,
      checksum: "b".repeat(64),
    },
  ],
};

test("archive jobs persist idempotently, are customer scoped and exclusively leased", async () => {
  const f = await fixture();
  try {
    const job = await f.jobs.enqueue(input);
    assert.equal((await f.jobs.enqueue(input)).id, job.id);
    assert.equal(await f.jobs.get(job.id, "stranger"), null);
    const first = await f.jobs.claim();
    assert.equal(first?.id, job.id);
    assert.ok(first?.lease_token);
    assert.equal(await f.jobs.claim(), null);
    assert.equal(await f.jobs.complete(job.id, "wrong", "c".repeat(64), 20), false);
    assert.equal(await f.jobs.complete(job.id, first!.lease_token!, "c".repeat(64), 20), true);
    assert.equal((await f.jobs.get(job.id, "buyer"))?.status, "completed");
  } finally {
    await f.db.close();
  }
});

test("expired leases cannot publish and reclaimed attempts have different private output keys", async () => {
  const f = await fixture();
  try {
    const job = await f.jobs.enqueue(input);
    const first = (await f.jobs.claim())!;
    await f.db.exec("update commerce_archive_jobs set leased_until=now()-interval '1 second'");
    assert.equal(await f.jobs.complete(job.id, first.lease_token!, "c".repeat(64), 20), false);
    const next = (await f.jobs.claim())!;
    assert.notEqual(next.output_key, first.output_key);
    assert.equal(await f.jobs.heartbeat(job.id, first.lease_token!), false);
    assert.equal(await f.jobs.heartbeat(job.id, next.lease_token!), true);
    assert.equal(await f.jobs.cancel(job.id, "stranger"), false);
    assert.equal(await f.jobs.cancel(job.id, "buyer"), true);
    assert.equal(await f.jobs.complete(job.id, next.lease_token!, "c".repeat(64), 20), false);
    assert.equal(await f.jobs.claim(), null);
  } finally {
    await f.db.close();
  }
});

test("retry attempts are bounded and stale exhausted jobs become failed", async () => {
  const f = await fixture();
  try {
    const job = await f.jobs.enqueue(input);
    for (let n = 0; n < 5; n++) {
      const lease = (await f.jobs.claim())!;
      assert.equal(lease.attempts, n + 1);
      await f.db.exec("update commerce_archive_jobs set leased_until=now()-interval '1 second'");
    }
    assert.equal(await f.jobs.claim(), null);
    assert.equal((await f.jobs.get(job.id, "buyer"))?.status, "failed");
  } finally {
    await f.db.close();
  }
});
