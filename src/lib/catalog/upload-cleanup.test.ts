import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import type { CatalogMedia } from "./repository.ts";
import { cleanupExpiredUploads } from "./upload-cleanup.ts";

async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL("../../../migrations/0005_catalog.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("../../../migrations/0025_upload_sessions.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let query = strings[0];
    for (let index = 0; index < values.length; index++)
      query += `$${index + 1}${strings[index + 1]}`;
    return (await db.query(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, values: unknown[] = []) =>
    (await db.query<T>(query, values)).rows;
  await sql`insert into catalog_galleries(id,title) values ('gallery','Cleanup')`;
  const objects = new Set<string>();
  let failDelete = false;
  const media = {
    async deleteOriginal(key: string) {
      if (failDelete) throw new Error("R2 unavailable");
      objects.delete(key);
    },
  } as CatalogMedia;
  async function photo(
    id: string,
    status: "reserved" | "uploaded" | "ready",
    key: string,
    expired: boolean,
  ) {
    await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,reserved_until)
      values(${id},'gallery','owner',${`${id}.jpg`},'image/jpeg',4,${id.padEnd(64, "a")},${key},${status},
        ${expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60_000)})`;
    objects.add(key);
  }
  return { db, sql, media, objects, photo, failDelete: (value: boolean) => (failDelete = value) };
}

test("expired quarantine cleanup is bounded, fenced, audited, and excludes trusted or durable rows", async () => {
  const f = await fixture();
  try {
    await f.photo("expired", "reserved", "catalog/quarantine/expired/hash", true);
    await f.sql`insert into catalog_upload_sessions(idempotency_key,photo_id,owner_id,request_signature,expires_at)
      values('session','expired','owner',${"a".repeat(64)},now()-interval '1 second')`;
    await f.photo("future", "reserved", "catalog/quarantine/future/hash", false);
    await f.photo("uploaded", "uploaded", "catalog/quarantine/uploaded/hash", true);
    await f.photo("trusted", "reserved", "catalog/originals/trusted/hash", true);

    assert.deepEqual(await cleanupExpiredUploads(f.sql, f.media, 1), {
      claimed: 1,
      deleted: 1,
      failed: 0,
    });
    assert.equal(f.objects.has("catalog/quarantine/expired/hash"), false);
    assert.deepEqual(await f.sql<{ id: string }>`select id from catalog_photos order by id`, [
      { id: "future" },
      { id: "trusted" },
      { id: "uploaded" },
    ]);
    assert.equal((await f.sql`select idempotency_key from catalog_upload_sessions`).length, 0);
    assert.deepEqual(await f.sql<{ action: string }>`select action from catalog_audit`, [
      { action: "upload.expired" },
    ]);
    await assert.rejects(() => cleanupExpiredUploads(f.sql, f.media, 0), /Invalid cleanup limit/);
  } finally {
    await f.db.close();
  }
});

test("a storage outage retains the fenced reservation for a later cleanup retry", async () => {
  const f = await fixture();
  try {
    await f.photo("retry", "reserved", "catalog/quarantine/retry/hash", true);
    f.failDelete(true);
    assert.deepEqual(await cleanupExpiredUploads(f.sql, f.media, 10), {
      claimed: 1,
      deleted: 0,
      failed: 1,
    });
    assert.equal((await f.sql`select id from catalog_photos where id='retry'`).length, 1);
    assert.equal(f.objects.has("catalog/quarantine/retry/hash"), true);
    f.failDelete(false);
    assert.equal((await cleanupExpiredUploads(f.sql, f.media, 10)).deleted, 1);
  } finally {
    await f.db.close();
  }
});
