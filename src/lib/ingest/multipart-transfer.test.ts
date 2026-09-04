import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createMultipartTransfer, type MultipartTransferStore } from "./multipart-transfer.ts";

async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function fixture() {
  const db = new PGlite();
  for (const migration of ["0005_catalog.sql", "0027_multipart_uploads.sql"])
    await db.exec(
      await readFile(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"),
    );
  const sql = Object.assign(
    async () => {
      throw new Error("Use query");
    },
    {
      query: async <T>(query: string, values: unknown[] = []) =>
        (await db.query<T>(query, values)).rows,
    },
  ) as Sql;
  await db.exec("insert into catalog_galleries(id,title) values('gallery','Target')");
  const uploads = new Map<
    string,
    {
      key: string;
      parts: Map<number, { checksum: string; etag: string; bytes: number }>;
      aborted: boolean;
    }
  >();
  let completeFailures = 0;
  const controls = { failCreateOnce: false };
  const store: MultipartTransferStore = {
    create: async ({ idempotencyKey, objectKey }) => {
      uploads.set(
        idempotencyKey,
        uploads.get(idempotencyKey) ?? { key: objectKey, parts: new Map(), aborted: false },
      );
      if (controls.failCreateOnce) {
        controls.failCreateOnce = false;
        throw new Error("Ambiguous provider creation response");
      }
      return { uploadId: idempotencyKey };
    },
    uploadPart: async ({ uploadId, objectKey, number, bytes, checksum }) => {
      const upload = uploads.get(uploadId)!;
      assert.equal(objectKey, upload.key);
      const existing = upload.parts.get(number);
      if (existing && (existing.checksum !== checksum || existing.bytes !== bytes.byteLength))
        throw new Error("Provider part conflict");
      const saved = existing ?? { checksum, bytes: bytes.byteLength, etag: `etag-${number}` };
      upload.parts.set(number, saved);
      return { etag: saved.etag };
    },
    complete: async ({ uploadId, objectKey, parts }) => {
      if (completeFailures++ === 0) throw new Error("Ambiguous completion response");
      const upload = uploads.get(uploadId)!;
      assert.equal(objectKey, upload.key);
      assert.deepEqual(
        parts.map((p) => p.number),
        [1, 2, 3],
      );
      return { bytes: 11 * 1024 * 1024, checksum: "f".repeat(64) };
    },
    abort: async ({ uploadId, objectKey }) => {
      const upload = uploads.get(uploadId)!;
      assert.equal(objectKey, upload.key);
      upload.aborted = true;
    },
  };
  return { db, sql, store, uploads, controls, transfer: createMultipartTransfer(sql, store) };
}
const declaration = {
  galleryId: "gallery",
  filename: "game.jpg",
  mime: "image/jpeg",
  bytes: 11 * 1024 * 1024,
  checksum: "f".repeat(64),
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
};

test("transfer drives idempotent provider creation and exact part writes without exposing identities", async () => {
  const f = await fixture();
  try {
    f.controls.failCreateOnce = true;
    await assert.rejects(f.transfer.begin("owner", declaration), /Ambiguous provider creation/);
    assert.equal(f.uploads.size, 1);
    const session = await f.transfer.begin("owner", declaration);
    assert.equal(session.status, "open");
    assert.equal(f.uploads.size, 1);
    assert.deepEqual(await f.transfer.begin("owner", declaration), session);
    assert.equal(f.uploads.size, 1);
    assert.ok(!JSON.stringify(session).includes("catalog/quarantine"));
    const five = new Uint8Array(5 * 1024 * 1024),
      one = new Uint8Array(1024 * 1024);
    const checks = [await sha(five), await sha(five), await sha(one)];
    await assert.rejects(
      f.transfer.uploadPart("other", session.id, { number: 1, checksum: checks[0], bytes: five }),
      /unavailable/,
    );
    await assert.rejects(
      f.transfer.uploadPart("owner", session.id, {
        number: 1,
        checksum: "a".repeat(64),
        bytes: five,
      }),
      /checksum/,
    );
    await assert.rejects(
      f.transfer.uploadPart("owner", session.id, {
        number: 3,
        checksum: await sha(five),
        bytes: five,
      }),
      /size/,
    );
    await f.transfer.uploadPart("owner", session.id, {
      number: 1,
      checksum: checks[0],
      bytes: five,
    });
    assert.deepEqual(
      await f.transfer.uploadPart("owner", session.id, {
        number: 1,
        checksum: checks[0],
        bytes: five,
      }),
      { number: 1, bytes: five.byteLength },
    );
    await f.transfer.uploadPart("owner", session.id, {
      number: 2,
      checksum: checks[1],
      bytes: five,
    });
    await f.transfer.uploadPart("owner", session.id, {
      number: 3,
      checksum: checks[2],
      bytes: one,
    });
    await assert.rejects(f.transfer.complete("owner", session.id), /Ambiguous completion/);
    const done = await f.transfer.complete("owner", session.id);
    assert.deepEqual(done, {
      id: session.id,
      status: "committed",
      bytes: declaration.bytes,
      checksum: declaration.checksum,
    });
    await assert.rejects(
      f.transfer.uploadPart("owner", session.id, { number: 1, checksum: checks[0], bytes: five }),
      /not open/,
    );
  } finally {
    await f.db.close();
  }
});

test("integrity mismatch never commits and abort is owner-scoped and idempotent", async () => {
  const f = await fixture();
  try {
    f.store.complete = async () => ({ bytes: declaration.bytes, checksum: "0".repeat(64) });
    const session = await f.transfer.begin("owner", declaration);
    await assert.rejects(f.transfer.abort("other", session.id), /unavailable/);
    assert.deepEqual(await f.transfer.abort("owner", session.id), {
      id: session.id,
      status: "cancelled",
    });
    assert.deepEqual(await f.transfer.abort("owner", session.id), {
      id: session.id,
      status: "cancelled",
    });
    assert.equal(f.uploads.get(session.id)?.aborted, true);
  } finally {
    await f.db.close();
  }
});

test("completion requires provider verification of the complete object", async () => {
  const f = await fixture();
  try {
    const bytes = new Uint8Array([1, 2, 3]);
    const mini = {
      ...declaration,
      bytes: bytes.byteLength,
      checksum: await sha(bytes),
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
    };
    f.store.complete = async () => ({ bytes: 2, checksum: mini.checksum });
    const session = await f.transfer.begin("owner", mini);
    await f.transfer.uploadPart("owner", session.id, { number: 1, checksum: mini.checksum, bytes });
    await assert.rejects(f.transfer.complete("owner", session.id), /integrity/);
    const [stored] = await f.sql.query<{ status: string }>(
      "select status from catalog_multipart_uploads where id=$1",
      [session.id],
    );
    assert.equal(
      stored.status,
      "committing",
      "Unverified completion remains retryable, never claimed committed",
    );
  } finally {
    await f.db.close();
  }
});
