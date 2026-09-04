import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createMultipartSessions } from "./multipart-session.ts";

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
  await db.exec(
    "INSERT INTO catalog_galleries(id,title) VALUES('gallery','Private ingest target')",
  );
  return { db, sql, sessions: createMultipartSessions(sql) };
}
const declaration = {
  galleryId: "gallery",
  filename: "game.jpg",
  mime: "image/jpeg" as const,
  bytes: 11 * 1024 * 1024,
  checksum: "a".repeat(64),
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
};

test("multipart session declaration is owner-scoped, replayable and never exposes storage identity", async () => {
  const f = await fixture();
  try {
    const created = await f.sessions.declare("owner-a", declaration);
    assert.equal(created.status, "creating");
    assert.equal(created.partSize, 5 * 1024 * 1024);
    assert.equal(created.partCount, 3);
    assert.ok(!JSON.stringify(created).includes("objectKey"));
    assert.deepEqual(await f.sessions.declare("owner-a", declaration), created);
    await assert.rejects(f.sessions.declare("owner-b", declaration), /different upload/);
    await assert.rejects(
      f.sessions.declare("owner-a", { ...declaration, bytes: declaration.bytes + 1 }),
      /different upload/,
    );
    await assert.rejects(f.sessions.resume("owner-b", created.id), /unavailable/);
    await assert.rejects(
      f.sessions.recordPart("owner-a", created.id, {
        number: 1,
        bytes: 5,
        checksum: "b".repeat(64),
        etag: "etag",
      }),
      /not open/,
    );
    await f.sessions.bindProvider(
      created.id,
      "provider-upload-private",
      "private/key-never-returned",
    );
    const resumed = await f.sessions.resume("owner-a", created.id);
    assert.equal(resumed.status, "open");
    assert.ok(!JSON.stringify(resumed).includes("provider-upload-private"));
    assert.ok(!JSON.stringify(resumed).includes("private/key"));
  } finally {
    await f.db.close();
  }
});

test("parts enforce exact geometry, immutable idempotency and complete manifests", async () => {
  const f = await fixture();
  try {
    const session = await f.sessions.declare("owner", declaration);
    await f.sessions.bindProvider(session.id, "provider", "private/key");
    const MiB = 1024 * 1024;
    const first = { number: 1, bytes: 5 * MiB, checksum: "1".repeat(64), etag: "one" };
    assert.deepEqual(await f.sessions.recordPart("owner", session.id, first), {
      number: 1,
      bytes: 5 * MiB,
    });
    assert.deepEqual(await f.sessions.recordPart("owner", session.id, first), {
      number: 1,
      bytes: 5 * MiB,
    });
    await assert.rejects(
      f.sessions.recordPart("owner", session.id, { ...first, bytes: 4 * MiB }),
      /does not match/,
    );
    await assert.rejects(
      f.sessions.recordPart("owner", session.id, { ...first, number: 4 }),
      /number/,
    );
    await f.sessions.recordPart("owner", session.id, {
      number: 3,
      bytes: 1 * MiB,
      checksum: "3".repeat(64),
      etag: "three",
    });
    await assert.rejects(f.sessions.prepareCommit("owner", session.id), /incomplete/);
    await f.sessions.recordPart("owner", session.id, {
      number: 2,
      bytes: 5 * MiB,
      checksum: "2".repeat(64),
      etag: "two",
    });
    const manifest = await f.sessions.prepareCommit("owner", session.id);
    assert.deepEqual(
      manifest.parts.map((p) => p.number),
      [1, 2, 3],
    );
    assert.equal(manifest.providerUploadId, "provider");
    assert.equal(manifest.objectKey, "private/key");
    assert.equal((await f.sessions.resume("owner", session.id)).status, "committing");
    assert.deepEqual(await f.sessions.prepareCommit("owner", session.id), manifest);
    await f.sessions.markCommitted(session.id);
    assert.equal((await f.sessions.resume("owner", session.id)).status, "committed");
    await assert.rejects(f.sessions.recordPart("owner", session.id, first), /not open/);
  } finally {
    await f.db.close();
  }
});

test("cancel and expiry are terminal and provider cleanup remains explicit", async () => {
  const f = await fixture();
  try {
    const session = await f.sessions.declare("owner", declaration);
    const creating = await f.sessions.declare("owner", { ...declaration, idempotencyKey: "00000000-0000-4000-8000-000000000002" });
    assert.deepEqual(await f.sessions.cancel("owner", creating.id), { providerUploadId: null, objectKey: null, status: "cancelled" });
    await f.sessions.bindProvider(session.id, "provider", "private/key");
    assert.deepEqual(await f.sessions.cancel("owner", session.id), {
      providerUploadId: "provider",
      objectKey: "private/key",
      status: "cancelled",
    });
    assert.deepEqual(await f.sessions.cancel("owner", session.id), {
      providerUploadId: "provider",
      objectKey: "private/key",
      status: "cancelled",
    });
    await assert.rejects(f.sessions.bindProvider(session.id, "other", "other/key"), /not creating/);
    const expired = "00000000-0000-4000-8000-000000000099";
    await f.sql.query(
      `insert into catalog_multipart_uploads(id,idempotency_key,owner_id,gallery_id,filename,mime,total_bytes,
      checksum,request_signature,part_size,part_count,provider_upload_id,object_key,status,created_at,updated_at,expires_at)
      values($1,$1,'owner','gallery','old.jpg','image/jpeg',10,$2,$2,5242880,1,'old-provider','old-key','open',
      now()-interval '2 days',now()-interval '2 days',now()-interval '1 day')`,
      [expired, "a".repeat(64)],
    );
    await assert.rejects(f.sessions.resume("owner", expired), /expired/);
    assert.equal(
      (await f.sessions.cancel("owner", expired)).status,
      "cancelled",
      "Expired provider uploads remain explicitly abortable",
    );
  } finally {
    await f.db.close();
  }
});
