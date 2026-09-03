import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createCatalog, digest, type CatalogMedia } from "./repository.ts";
import { assertCatalogOwner } from "./owner.ts";
import type { Sql } from "../db.ts";
import type { GalleryInput } from "./types.ts";

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
  const objects = new Map<string, Uint8Array>();
  let failProcessing = false,
    failStorage = false,
    failReadback = false;
  const media: CatalogMedia = {
    async get(key) {
      const data = objects.get(key);
      if (!data) throw new Error("Missing");
      if (failReadback && key.includes("/thumb-")) return new Uint8Array([0]);
      return data;
    },
    async putOriginal(key, bytes) {
      if (failStorage) throw new Error("Storage unavailable");
      if (objects.has(key)) assert.deepEqual(objects.get(key), bytes);
      objects.set(key, bytes);
    },
    async putDerivative(key, bytes) {
      objects.set(key, bytes);
    },
    async process() {
      if (failProcessing) throw new Error("Processor unavailable");
      return {
        width: 600,
        height: 400,
        preview: new Uint8Array([255, 216, 255, 2]),
        thumb: new Uint8Array([255, 216, 255, 3]),
      };
    },
  };
  const catalog = createCatalog(sql, media);
  const input: GalleryInput = {
    title: "TEST — CCES fixture",
    description: "Synthetic test only",
    category: "Football",
    folderId: null,
    visibility: "private",
    published: false,
  };
  const create = () => catalog.saveGallery(input, "owner");
  const bytes = new Uint8Array([255, 216, 255, 1, 2, 3]);
  async function reserve(galleryId: string) {
    return catalog.reserve(
      {
        galleryId,
        filename: "synthetic.jpg",
        mime: "image/jpeg",
        bytes: bytes.length,
        checksum: await digest(bytes),
      },
      "owner",
    );
  }
  return {
    db,
    sql,
    catalog,
    create,
    input,
    bytes,
    reserve,
    objects,
    media,
    failProcessing: (v: boolean) => {
      failProcessing = v;
    },
    failStorage: (v: boolean) => {
      failStorage = v;
    },
    failReadback: (v: boolean) => {
      failReadback = v;
    },
  };
}
test("owner access rejects anonymous users, arbitrary accounts, and missing configuration", () => {
  assert.throws(() => assertCatalogOwner(undefined, "owner"), /Sign in/);
  assert.throws(() => assertCatalogOwner('dev-user', 'dev-user'), /Sign in/);
  assert.throws(() => assertCatalogOwner("attacker", "owner"), /not the studio owner/);
  assert.throws(() => assertCatalogOwner("owner", ""), /not been configured/);
  assert.equal(assertCatalogOwner("owner", "another, owner"), "owner");
});

test("expired processing attempts cannot overwrite a successful retry", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    f.failProcessing(true);
    await f.catalog.upload(r.id, f.bytes, "owner");
    f.failProcessing(false);
    const originalProcess = f.media.process;
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    f.media.process = async (bytes) => {
      if (calls++ === 0) {
        started();
        await wait;
        throw new Error("Late failure from old Worker");
      }
      return originalProcess(bytes);
    };
    const old = f.catalog.process(r.id, "owner");
    const oldResult = assert.rejects(old, /newer processing attempt/);
    await startedPromise;
    await f.sql`update catalog_photos set updated_at=now()-interval '6 minutes' where id=${r.id}`;
    assert.equal((await f.catalog.process(r.id, "owner")).status, "ready");
    release();
    await oldResult;
    assert.equal((await f.catalog.ownerIndex()).jobs[0].status, "ready");
  } finally {
    await f.db.close();
  }
});
test("shared catalog: private draft -> verified previews -> published to another repository instance", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.catalog.publicIndex(), { galleries: [], photos: [], folders: [] });
    const g = await f.create();
    const r = await f.reserve(g.id);
    assert.equal((await f.catalog.upload(r.id, f.bytes, "owner")).status, "ready");
    await assert.rejects(f.catalog.detail(g.id), /unavailable/);
    const saved = await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: g.revision, visibility: "public", published: true },
      "owner",
    );
    const publicData = await f.catalog.publicIndex();
    assert.equal(publicData.galleries[0].id, g.id);
    assert.equal(publicData.photos.length, 1);
    assert.ok(!JSON.stringify(publicData).includes("original_key"));
    assert.ok(!JSON.stringify(publicData).includes("checksum"));
    assert.ok(!JSON.stringify(publicData).includes("catalog/originals"));
    const other = createCatalog(f.sql, { get: async (key) => f.objects.get(key)! } as CatalogMedia);
    assert.equal((await other.detail(g.id)).gallery.title, saved.title);
    assert.deepEqual(
      (await other.media(r.id, "preview")).bytes,
      new Uint8Array([255, 216, 255, 2]),
    );
    await assert.rejects(other.media(r.id, "original"), /unavailable/);
    assert.deepEqual((await other.media(r.id, "original", undefined, true)).bytes, f.bytes);
  } finally {
    await f.db.close();
  }
});
test("password grants are scoped, expiring, revocable and never disclose credentials", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    await f.catalog.upload(r.id, f.bytes, "owner");
    let saved = await f.catalog.saveGallery(
      {
        ...f.input,
        id: g.id,
        revision: g.revision,
        visibility: "unlisted",
        published: true,
        password: "correct horse battery",
      },
      "owner",
    );
    assert.equal((await f.catalog.publicIndex()).galleries.length, 0);
    await assert.rejects(f.catalog.detail(g.id), /password required/);
    await assert.rejects(f.catalog.unlock(g.id, "wrong"), /Incorrect/);
    const grant = await f.catalog.unlock(g.id, "correct horse battery");
    assert.equal((await f.catalog.detail(g.id, grant)).photos.length, 1);
    assert.ok(!JSON.stringify(await f.catalog.ownerIndex()).includes("correct horse"));
    assert.ok(!JSON.stringify(await f.catalog.ownerIndex()).includes("password_hash"));
    const other = await f.create();
    await assert.rejects(f.catalog.detail(other.id, grant), /unavailable/);
    saved = await f.catalog.saveGallery(
      {
        ...f.input,
        id: g.id,
        revision: saved.revision,
        visibility: "unlisted",
        published: true,
        revokeAccess: true,
      },
      "owner",
    );
    await assert.rejects(f.catalog.media(r.id, "preview", grant), /password required/);
    const next = await f.catalog.unlock(g.id, "correct horse battery");
    await f.sql`update catalog_access_grants set expires_at=now()-interval '1 second'`;
    await assert.rejects(f.catalog.detail(g.id, next), /password required/);
    for (let i = 0; i < 7; i++) await assert.rejects(f.catalog.unlock(g.id, "wrong"), /Incorrect/);
    await assert.rejects(f.catalog.unlock(g.id, "wrong"), /Too many/);
    await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: saved.revision, visibility: "private", published: true },
      "owner",
    );
    await assert.rejects(f.catalog.detail(g.id, next), /unavailable/);
  } finally {
    await f.db.close();
  }
});
test("upload failures stay durable and retries verify derivatives before ready", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    await assert.rejects(
      f.catalog.saveGallery(
        { ...f.input, id: g.id, revision: g.revision, published: true },
        "owner",
      ),
      /process at least/,
    );
    await assert.rejects(f.catalog.upload(r.id, f.bytes, "attacker"), /unavailable/);
    await assert.rejects(f.catalog.upload(r.id, new Uint8Array([0]), "owner"), /does not match/);
    assert.equal((await f.catalog.ownerIndex()).jobs[0].status, "failed");
    f.failStorage(true);
    await assert.rejects(f.catalog.upload(r.id, f.bytes, "owner"), /Storage unavailable/);
    f.failStorage(false);
    f.failProcessing(true);
    assert.equal((await f.catalog.upload(r.id, f.bytes, "owner")).status, "needs_review");
    assert.equal((await f.catalog.ownerIndex()).photos.length, 0);
    assert.equal(f.objects.size, 1);
    f.failProcessing(false);
    f.failReadback(true);
    assert.equal((await f.catalog.process(r.id, "owner")).status, "needs_review");
    f.failReadback(false);
    assert.equal((await f.catalog.process(r.id, "owner")).status, "ready");
    assert.equal((await f.catalog.ownerIndex()).photos.length, 1);
    await assert.rejects(f.catalog.upload(r.id, f.bytes, "owner"), /already received/);
  } finally {
    await f.db.close();
  }
});
test("duplicate reservations, expiry and gallery revision conflicts", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    const duplicate = await f.reserve(g.id);
    assert.equal(duplicate.id, r.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await f.catalog.ownerIndex()).jobs.length, 1);
    await f.sql`update catalog_photos set reserved_until=now()-interval '1 hour' where id=${r.id}`;
    await assert.rejects(f.catalog.upload(r.id, f.bytes, "owner"), /expired/);
    await f.reserve(g.id);
    assert.equal((await f.catalog.upload(r.id, f.bytes, "owner")).status, "ready");
    await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: g.revision, title: "Renamed" },
      "owner",
    );
    await assert.rejects(
      f.catalog.saveGallery(
        { ...f.input, id: g.id, revision: g.revision, title: "Stale" },
        "owner",
      ),
      /another device/,
    );
    await assert.rejects(
      f.catalog.reserve(
        {
          galleryId: g.id,
          filename: "x.raw",
          mime: "image/tiff",
          bytes: 10,
          checksum: "a".repeat(64),
        },
        "owner",
      ),
    );
    const row = (
      await f.sql<{
        original_key: string;
      }>`select original_key from catalog_photos where id=${r.id}`
    )[0];
    assert.deepEqual(f.objects.get(row.original_key), f.bytes);
  } finally {
    await f.db.close();
  }
});
