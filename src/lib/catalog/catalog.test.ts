import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createCatalog, digest, type CatalogMedia } from "./repository.ts";
import { assertCatalogOwner } from "./owner.ts";
import { bindingStorage } from "./r2-binding.ts";
import type { Sql } from "../db.ts";
import type { GalleryInput } from "./types.ts";

async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL("../../../migrations/0005_catalog.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("../../../migrations/0006_photo_management.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../../../migrations/0007_proof_selections.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../../../migrations/0012_gallery_customer_policy.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let query = strings[0];
    for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
    return (await db.query(query, values)).rows;
  }) as Sql;
  await db.exec(
    await readFile(
      new URL("../../../migrations/0015_gallery_client_limits.sql", import.meta.url),
      "utf8",
    ),
  );
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
test("gallery customer instructions and restrictive download policies persist without granting originals", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    assert.equal(g.customerInstructions, "");
    assert.equal(g.downloadPolicy, "none");
    const updated = await f.catalog.saveGallery(
      {
        ...f.input,
        id: g.id,
        revision: g.revision,
        customerInstructions: "Select favorites, then save a note.",
        downloadPolicy: "purchased_only",
      },
      "owner",
    );
    assert.equal(
      (await f.catalog.ownerIndex()).galleries[0].customerInstructions,
      "Select favorites, then save a note.",
    );
    assert.equal(
      (await f.catalog.publicIndex()).galleries.length,
      0,
      "Private instructions are not public",
    );
    await assert.rejects(
      f.catalog.saveGallery(
        { ...f.input, id: g.id, revision: g.revision, downloadPolicy: "none" },
        "owner",
      ),
      /changed/,
    );
    const invalid = { ...f.input, downloadPolicy: "public_originals" } as unknown as GalleryInput;
    await assert.rejects(f.catalog.saveGallery(invalid, "owner"));
    await assert.rejects(
      f.catalog.saveGallery({ ...f.input, customerInstructions: "x".repeat(4001) }, "owner"),
    );
    const photo = await f.reserve(g.id);
    await f.catalog.upload(photo.id, f.bytes, "owner");
    const published = await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: updated.revision, visibility: "public", published: true },
      "owner",
    );
    assert.equal(
      published.downloadPolicy,
      "purchased_only",
      "Legacy clients preserve omitted policy fields",
    );
    assert.equal(
      (await f.catalog.detail(g.id)).gallery.customerInstructions,
      updated.customerInstructions,
    );
    await assert.rejects(f.catalog.media(photo.id, "original"), /unavailable/);
    await f.catalog.saveGallery(
      {
        ...f.input,
        id: g.id,
        revision: published.revision,
        visibility: "public",
        published: true,
        downloadPolicy: "none",
        customerInstructions: "",
      },
      "owner",
    );
    assert.equal((await f.catalog.detail(g.id)).gallery.downloadPolicy, "none");
    assert.equal((await f.catalog.detail(g.id)).gallery.customerInstructions, "");
    await assert.rejects(f.catalog.media(photo.id, "original"), /unavailable/);
    assert.deepEqual(
      (await f.catalog.media(photo.id, "original", undefined, true)).bytes,
      f.bytes,
      "Owner access is unchanged",
    );
  } finally {
    await f.db.close();
  }
});
test("native R2 binding keeps originals immutable and reports storage failure", async () => {
  const objects = new Map<string, Uint8Array>();
  let fail = false,
    disconnectAfterWrite = false;
  const storage = bindingStorage({
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { arrayBuffer: async () => new Uint8Array(bytes).buffer } : null;
    },
    async put(key, bytes, options) {
      if (fail) throw new Error("Unavailable");
      assert.equal(options.sha256, await digest(bytes));
      if (options.onlyIf) {
        assert.equal(options.onlyIf.get("If-None-Match"), "*");
        if (objects.has(key)) return null;
      }
      objects.set(key, new Uint8Array(bytes));
      if (disconnectAfterWrite) throw new Error("Response lost");
      return { key };
    },
  });
  const bytes = new Uint8Array([1, 2, 3]);
  await storage.putOriginal("original", bytes, "image/jpeg");
  await storage.putOriginal("original", bytes, "image/jpeg");
  await assert.rejects(
    () => storage.putOriginal("original", new Uint8Array([4]), "image/jpeg"),
    /already exists/,
  );
  assert.deepEqual(await storage.get("original"), bytes);
  disconnectAfterWrite = true;
  await storage.putOriginal("response-lost", bytes, "image/jpeg");
  disconnectAfterWrite = false;
  fail = true;
  await assert.rejects(() => storage.putOriginal("new-failed", bytes, "image/jpeg"));
  await assert.rejects(() => storage.putDerivative("thumb", bytes), /Unavailable/);
  assert.equal(objects.has("new-failed"), false);
});
test("proof selections survive another device, isolate customers and notify the owner", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    await f.catalog.upload(r.id, f.bytes, "owner");
    await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: g.revision, published: true, visibility: "public" },
      "owner",
    );
    const input = {
      galleryId: g.id,
      photoIds: [r.id],
      note: "Please review this photograph.",
      revision: 0,
    };
    const saved = await f.catalog.saveProof(input, "customer-a");
    assert.ok(saved.id);
    assert.equal(saved.revision, 1);
    const otherDevice = createCatalog(f.sql, f.media);
    assert.deepEqual(await otherDevice.readProof(g.id, "customer-a"), saved);
    assert.equal((await otherDevice.readProof(g.id, "customer-b")).id, null);
    const inbox = await otherDevice.ownerProofs();
    assert.equal(inbox[0].note, input.note);
    assert.equal(inbox[0].photos[0].id, r.id);
    assert.equal(inbox[0].reviewedRevision, 0);
    await otherDevice.reviewProof({ id: saved.id!, revision: 1 }, "owner");
    assert.equal((await otherDevice.ownerProofs())[0].reviewedRevision, 1);
    await assert.rejects(() => f.catalog.saveProof(input, "customer-a"), /Reload/);
    const changed = await f.catalog.saveProof(
      { ...input, revision: 1, photoIds: [], note: "Changed my selection" },
      "customer-a",
    );
    assert.equal(changed.photoIds.length, 0);
    assert.equal(changed.revision, 2);
    assert.equal((await otherDevice.ownerProofs())[0].reviewedRevision, 1);
    await assert.rejects(
      () => otherDevice.reviewProof({ id: saved.id!, revision: 1 }, "owner"),
      /Reload/,
    );
    await assert.rejects(() => f.catalog.saveProof(input, "dev-user"), /Sign in/);
    await assert.rejects(() => f.catalog.readProof(g.id, ""), /Sign in/);
    const events = await f.sql`select * from catalog_audit where action='proof.updated'`;
    assert.equal(events.length, 2);
  } finally {
    await f.db.close();
  }
});

test("proof saves reject hidden, foreign and invalid photos and honor revoked gallery access", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    await f.catalog.upload(r.id, f.bytes, "owner");
    const input = { galleryId: g.id, photoIds: [r.id], note: "Private proof note", revision: 0 };
    await assert.rejects(() => f.catalog.saveProof(input, "customer"), /unavailable/);
    let gallery = await f.catalog.saveGallery(
      {
        ...f.input,
        id: g.id,
        revision: g.revision,
        published: true,
        visibility: "unlisted",
        password: "a long test password",
      },
      "owner",
    );
    await assert.rejects(() => f.catalog.saveProof(input, "customer"), /password/);
    const grant = await f.catalog.unlock(g.id, "a long test password");
    const saved = await f.catalog.saveProof(input, "customer", grant);
    await assert.rejects(
      () =>
        f.catalog.saveProof({ ...input, revision: 1, photoIds: [r.id, r.id] }, "customer", grant),
      /Duplicate/,
    );
    await assert.rejects(
      () =>
        f.catalog.saveProof(
          { ...input, revision: 1, photoIds: [crypto.randomUUID()] },
          "customer",
          grant,
        ),
      /Reload/,
    );
    const second = await f.create();
    const foreign = await f.reserve(second.id);
    await f.catalog.upload(foreign.id, f.bytes, "owner");
    await assert.rejects(
      () =>
        f.catalog.saveProof({ ...input, revision: 1, photoIds: [foreign.id] }, "customer", grant),
      /Reload/,
    );
    await f.catalog.savePhoto(
      { id: r.id, revision: 1, caption: "", hidden: true, archived: false, displayOrder: 0 },
      "owner",
    );
    const filtered = await f.catalog.readProof(g.id, "customer", grant);
    assert.equal(filtered.photoIds.length, 0);
    assert.equal(filtered.unavailableCount, 1);
    assert.equal(JSON.stringify(filtered).includes(r.id), false);
    await assert.rejects(
      () => f.catalog.saveProof({ ...input, revision: 1 }, "customer", grant),
      /Reload/,
    );
    assert.equal((await f.catalog.ownerProofs())[0].photos[0].unavailable, true);
    gallery = await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: gallery.revision, published: false, visibility: "private" },
      "owner",
    );
    assert.equal(gallery.visibility, "private");
    await assert.rejects(() => f.catalog.readProof(g.id, "customer", grant), /unavailable/);
    await assert.rejects(
      () =>
        f.catalog.saveProof(
          { ...input, revision: saved.revision, photoIds: [] },
          "customer",
          grant,
        ),
      /unavailable/,
    );
  } finally {
    await f.db.close();
  }
});

test("photo edits persist, protect hidden media, restore originals, and reject stale saves", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const r = await f.reserve(g.id);
    await f.catalog.upload(r.id, f.bytes, "owner");
    await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: g.revision, published: true, visibility: "public" },
      "owner",
    );
    const input = {
      id: r.id,
      revision: 1,
      caption: "CCES — test caption",
      hidden: false,
      archived: false,
      displayOrder: 12,
    };
    let saved = await f.catalog.savePhoto(input, "owner");
    const second = createCatalog(f.sql, f.media);
    assert.equal((await second.detail(g.id)).photos[0].caption, input.caption);
    assert.equal("revision" in (await second.publicIndex()).photos[0], false);
    await assert.rejects(() => f.catalog.savePhoto(input, "owner"), /Reload/);
    const original = await f.catalog.media(r.id, "original", undefined, true);
    for (const flag of ["hidden", "archived"] as const) {
      saved = await f.catalog.savePhoto(
        { ...input, revision: saved.revision, [flag]: true },
        "owner",
      );
      assert.equal((await second.publicIndex()).photos.length, 0);
      assert.equal((await second.detail(g.id)).photos.length, 0);
      for (const kind of ["preview", "thumb", "original"]) {
        await assert.rejects(() => second.media(r.id, kind), /unavailable/);
      }
      assert.equal((await second.ownerIndex()).photos[0][flag], true);
      assert.deepEqual(
        (await second.media(r.id, "original", undefined, true)).bytes,
        original.bytes,
      );
      saved = await f.catalog.savePhoto({ ...input, revision: saved.revision }, "owner");
      assert.equal((await second.detail(g.id)).photos.length, 1);
      assert.ok((await second.media(r.id, "preview")).bytes.length);
    }
    await assert.rejects(() =>
      f.catalog.savePhoto({ ...input, revision: saved.revision, displayOrder: -1 }, "owner"),
    );
    await assert.rejects(() =>
      f.catalog.savePhoto(
        { ...input, revision: saved.revision, caption: "x".repeat(2001) },
        "owner",
      ),
    );
    const events = await f.sql`select * from catalog_audit where action='photo.updated'`;
    assert.equal(events.length, 5);
  } finally {
    await f.db.close();
  }
});

test("photo display order is shared and deterministic", async () => {
  const f = await fixture();
  try {
    const g = await f.create();
    const a = await f.reserve(g.id);
    await f.catalog.upload(a.id, f.bytes, "owner");
    const bytes = new Uint8Array([...f.bytes, 4]);
    const b = await f.catalog.reserve(
      {
        galleryId: g.id,
        filename: "second.jpg",
        mime: "image/jpeg",
        bytes: bytes.length,
        checksum: await digest(bytes),
      },
      "owner",
    );
    await f.catalog.upload(b.id, bytes, "owner");
    await f.catalog.saveGallery(
      { ...f.input, id: g.id, revision: g.revision, published: true, visibility: "public" },
      "owner",
    );
    await f.catalog.savePhoto(
      { id: a.id, revision: 1, caption: "", hidden: false, archived: false, displayOrder: 20 },
      "owner",
    );
    assert.deepEqual(
      (await f.catalog.detail(g.id)).photos.map((p) => p.id),
      [b.id, a.id],
    );
    assert.deepEqual(
      (await f.catalog.ownerIndex()).photos.map((p) => p.id),
      [b.id, a.id],
    );
  } finally {
    await f.db.close();
  }
});

test("owner access rejects anonymous users, arbitrary accounts, and missing configuration", () => {
  assert.throws(() => assertCatalogOwner(undefined, "owner"), /Sign in/);
  assert.throws(() => assertCatalogOwner("dev-user", "dev-user"), /Sign in/);
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
    const cleanGrant = await f.catalog.unlock(g.id, "correct horse battery", "clean-client");
    assert.ok(cleanGrant, "one abusive client must not lock out a different client");
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
