import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { assertCatalogOwner } from "../catalog/owner.ts";
import { createIntegrityService, readVerifiedOriginal, type IntegrityObject } from "./service.ts";
import { handleIntegrityRequest } from "./http.ts";

const bytes = new Uint8Array([255, 216, 255, 1, 2, 3]);
const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
function object(value = bytes, size = value.length): IntegrityObject {
  return {
    size,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(value);
        controller.close();
      },
    }),
  };
}
async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL("../../../migrations/0005_catalog.sql", import.meta.url), "utf8"),
  );
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let query = strings[0];
    for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
    return (await db.query(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, values: unknown[] = []) =>
    (await db.query<T>(query, values)).rows;
  const photoId = crypto.randomUUID(),
    galleryId = crypto.randomUUID();
  await sql`insert into catalog_galleries(id,title) values(${galleryId},'Integrity fixture')`;
  await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status)
    values(${photoId},${galleryId},'owner','synthetic.jpg','image/jpeg',${bytes.length},${checksum},${`catalog/originals/${photoId}`},'ready')`;
  return { db, sql, photoId };
}
test("owner integrity returns verified without keys/bytes, reads exactly one original and changes no database rows", async () => {
  const f = await fixture();
  try {
    const before = await f.sql`select * from catalog_photos`;
    const keys: string[] = [];
    const verify = createIntegrityService(f.sql, {
      get: async (key) => {
        keys.push(key);
        return object();
      },
    });
    const result = await verify({ photoId: f.photoId });
    assert.equal(result.status, "verified");
    assert.equal(result.expectedBytes, bytes.length);
    assert.deepEqual(keys, [`catalog/originals/${f.photoId}`]);
    assert.ok(!JSON.stringify(result).includes("catalog/originals"));
    assert.ok(!("bytes" in result));
    assert.deepEqual(await f.sql`select * from catalog_photos`, before);
    assert.equal((await f.sql`select * from catalog_audit`).length, 0);
  } finally {
    await f.db.close();
  }
});
test("integrity distinguishes missing objects, wrong hashes and wrong sizes; provider failure is not reported missing", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await createIntegrityService(f.sql, { get: async () => null })({ photoId: f.photoId }))
        .status,
      "missing",
    );
    for (const wrong of [
      object(new Uint8Array([255, 216, 255, 9, 9, 9])),
      object(bytes, bytes.length + 1),
      object(bytes.subarray(0, 4), bytes.length),
    ]) {
      assert.equal(
        (await createIntegrityService(f.sql, { get: async () => wrong })({ photoId: f.photoId }))
          .status,
        "mismatch",
      );
    }
    const response = await handleIntegrityRequest(
      new Request("https://local.invalid/api/catalog-integrity", {
        method: "POST",
        headers: { origin: "https://local.invalid" },
        body: JSON.stringify({ photoId: f.photoId }),
      }),
      {
        owner: async () => "owner",
        verify: createIntegrityService(f.sql, {
          get: async () => {
            throw new Error("SECRET provider key");
          },
        }),
      },
    );
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("SECRET"));
  } finally {
    await f.db.close();
  }
});
test("bounded reader rejects oversized metadata before reading, cancels overflow and returns exact verified bytes", async () => {
  let reads = 0,
    cancelled = false;
  const oversized = {
    size: 100_000_000,
    body: new ReadableStream<Uint8Array>(
      {
        pull() {
          reads++;
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
  };
  assert.equal((await readVerifiedOriginal(oversized, bytes.length, checksum)).status, "mismatch");
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
  let overflowCancelled = false;
  const overflow = {
    size: bytes.length,
    body: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(bytes.length + 1));
        },
        cancel() {
          overflowCancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
  };
  assert.equal((await readVerifiedOriginal(overflow, bytes.length, checksum)).status, "mismatch");
  assert.equal(overflowCancelled, true);
  const verified = await readVerifiedOriginal(object(), bytes.length, checksum);
  assert.equal(verified.status, "verified");
  if (verified.status === "verified") assert.deepEqual(verified.bytes, bytes);
  const reused = new Uint8Array(3);
  let part = 0;
  const chunked = await readVerifiedOriginal(
    {
      size: bytes.length,
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (part === 2) {
              controller.close();
              return;
            }
            reused.set(bytes.subarray(part * 3, part * 3 + 3));
            part++;
            controller.enqueue(reused);
          },
        },
        { highWaterMark: 0 },
      ),
    },
    bytes.length,
    checksum,
  );
  assert.equal(
    chunked.status,
    "verified",
    "Each chunk is copied directly into the one bounded buffer",
  );
  if (chunked.status === "verified") assert.deepEqual(chunked.bytes, bytes);
  await assert.rejects(readVerifiedOriginal(object(), 20 * 1024 * 1024 + 1, checksum), /safely/);
  await assert.rejects(readVerifiedOriginal(object(), bytes.length, "bad"), /safely/);
  await assert.rejects(
    readVerifiedOriginal(
      {
        size: bytes.length,
        body: new ReadableStream({
          start(controller) {
            controller.error(new Error("Stream disconnected"));
          },
        }),
      },
      bytes.length,
      checksum,
    ),
    /disconnected/,
  );
});
test("HTTP rejects signed-out/non-owner and cross-origin calls before reading storage", async () => {
  let calls = 0;
  for (const actor of [undefined, "dev-user", "customer"]) {
    const response = await handleIntegrityRequest(
      new Request("https://local.invalid/api/catalog-integrity", {
        method: "POST",
        headers: { origin: "https://local.invalid" },
        body: "{}",
      }),
      {
        owner: async () => assertCatalogOwner(actor, "owner"),
        verify: async () => {
          calls++;
          throw new Error("Must not read");
        },
      },
    );
    assert.ok(response.status === 401 || response.status === 403);
  }
  const denied = await handleIntegrityRequest(
    new Request("https://local.invalid/api/catalog-integrity", {
      method: "POST",
      headers: { origin: "https://evil.invalid" },
      body: "{}",
    }),
    {
      owner: async () => "owner",
      verify: async () => {
        calls++;
        throw new Error("Must not read");
      },
    },
  );
  assert.equal(denied.status, 403);
  assert.equal(calls, 0);
});
test("HTTP accepts one strict photo ID, rejects bulk/extra/oversized/malformed input and never follows arbitrary keys", async () => {
  const f = await fixture();
  try {
    let reads = 0;
    const deps = {
      owner: async () => "owner",
      verify: createIntegrityService(f.sql, {
        get: async () => {
          reads++;
          return object();
        },
      }),
    };
    const post = (body: string) =>
      handleIntegrityRequest(
        new Request("https://local.invalid/api/catalog-integrity", {
          method: "POST",
          headers: { origin: "https://local.invalid" },
          body,
        }),
        deps,
      );
    for (const body of [
      "{",
      JSON.stringify({ photoIds: [f.photoId] }),
      JSON.stringify({ photoId: f.photoId, key: "elsewhere" }),
      JSON.stringify({ photoId: "bad" }),
    ])
      assert.equal((await post(body)).status, 400);
    assert.equal((await post("x".repeat(513))).status, 413);
    assert.equal(reads, 0);
    const response = await post(JSON.stringify({ photoId: f.photoId }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(reads, 1);
    await f.sql`update catalog_photos set original_key='unexpected-secret-key' where id=${f.photoId}`;
    assert.equal((await post(JSON.stringify({ photoId: f.photoId }))).status, 409);
    assert.equal(reads, 1);
    assert.equal((await post(JSON.stringify({ photoId: crypto.randomUUID() }))).status, 404);
  } finally {
    await f.db.close();
  }
});
