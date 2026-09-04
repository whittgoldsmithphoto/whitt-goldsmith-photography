import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createCatalog, digest, type CatalogMedia } from "./repository.ts";
import { createGalleryService } from "./gallery-service.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("cover updates are same-gallery, revision-safe and audited without publication", async () => {
  const f = await fixture();
  try {
    const gallery = await f.gallery(1, "Private", "private", null, false),
      other = await f.gallery(2);
    const cover = await f.photo(100, gallery),
      foreign = await f.photo(101, other),
      hidden = await f.photo(102, gallery, 2, true);
    for (const photoId of [foreign, hidden])
      await assert.rejects(
        f.service.setCover(gallery, { photoId, revision: 1 }, "owner"),
        /unavailable/,
      );
    const saved = await f.service.setCover(gallery, { photoId: cover, revision: 1 }, "owner");
    assert.equal(saved.revision, 2);
    assert.equal(saved.published, false);
    await assert.rejects(
      f.service.setCover(gallery, { photoId: null, revision: 1 }, "owner"),
      /changed/,
    );
    const [audit] = await f.query<{ count: number }>(
      "select count(*)::int as count from catalog_audit where action='gallery-cover'",
    );
    assert.equal(audit.count, 1);
    assert.equal(
      (await f.service.galleries(new URLSearchParams(), true)).data.find((g) => g.id === gallery)
        ?.coverPhotoId,
      cover,
    );
    await f.service.setCover(gallery, { photoId: null, revision: 2 }, "owner");
  } finally {
    await f.db.close();
  }
});
async function fixture() {
  const db = new PGlite();
  for (const name of [
    "0005_catalog.sql",
    "0006_photo_management.sql",
    "0012_gallery_customer_policy.sql",
    "0016_catalog_pagination_and_covers.sql",
  ])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const query = async <T>(text: string, values: unknown[] = []) =>
    (await db.query<T>(text, values)).rows;
  const sql = Object.assign(
    async <T>(parts: TemplateStringsArray, ...values: unknown[]) =>
      query<T>(
        parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""),
        values,
      ),
    { query },
  ) as Sql;
  const unavailable = async (): Promise<never> => {
    throw new Error("Media provider must not be called by resource list");
  };
  const media: CatalogMedia = {
    get: unavailable,
    putOriginal: unavailable,
    deleteOriginal: unavailable,
    process: unavailable,
    putDerivative: unavailable,
  };
  const service = createGalleryService(sql, createCatalog(sql, media).authorizeGallery);
  async function gallery(
    n: number,
    title = "Same title",
    visibility = "public",
    password: string | null = null,
    published = true,
  ) {
    await query(
      "INSERT INTO catalog_galleries(id,title,visibility,password_hash,published) VALUES($1,$2,$3,$4,$5)",
      [uuid(n), title, visibility, password, published],
    );
    return uuid(n);
  }
  async function photo(n: number, galleryId: string, derivatives = 2, hidden = false) {
    await query(
      `INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height,hidden)
      VALUES($1,$2,'owner',$3,'image/jpeg',500,$3,$4,'ready',6000,4000,$5)`,
      [uuid(n), galleryId, `frame-${n}.jpg`, `PRIVATE-ORIGINAL-${n}`, hidden],
    );
    for (const kind of ["thumb", "preview"].slice(0, derivatives))
      await query(
        "INSERT INTO catalog_derivatives(photo_id,kind,object_key,bytes,checksum) VALUES($1,$2,$3,10,'hash')",
        [uuid(n), kind, `PRIVATE-DERIVATIVE-${n}-${kind}`],
      );
    return uuid(n);
  }
  return { db, query, service, gallery, photo };
}

test("public summary keyset pagination handles tied titles and deleted cursor rows, excludes protected galleries", async () => {
  const f = await fixture();
  try {
    await f.gallery(1);
    await f.gallery(2);
    await f.gallery(3);
    await f.gallery(4, "Private", "private");
    await f.gallery(5, "Locked", "public", "passwordhash");
    await f.gallery(6, "Unlisted", "unlisted");
    await f.gallery(7, "Draft", "public", null, false);
    const first = await f.service.galleries(new URLSearchParams("limit=1"));
    assert.deepEqual(
      first.data.map((g) => g.id),
      [uuid(1)],
    );
    assert.equal(first.page.hasMore, true);
    await f.query("DELETE FROM catalog_galleries WHERE id=$1", [uuid(1)]);
    const next = await f.service.galleries(
      new URLSearchParams({ limit: "2", cursor: first.page.nextCursor! }),
    );
    assert.deepEqual(
      next.data.map((g) => g.id),
      [uuid(2), uuid(3)],
    );
    assert.equal(next.page.nextCursor, null);
    const allOwner = await f.service.galleries(new URLSearchParams(), true);
    assert.equal(allOwner.data.length, 6);
    assert.ok(!JSON.stringify(allOwner).includes("passwordhash"));
    await assert.rejects(
      f.service.galleries(new URLSearchParams({ cursor: first.page.nextCursor!, q: "changed" })),
    );
  } finally {
    await f.db.close();
  }
});

test("covers and counts require same gallery, visible ready photos and both derivatives", async () => {
  const f = await fixture();
  try {
    const gallery = await f.gallery(1),
      other = await f.gallery(2, "Other");
    const good = await f.photo(11, gallery),
      good2 = await f.photo(12, gallery);
    const hidden = await f.photo(13, gallery, 2, true);
    const partial = await f.photo(14, gallery, 1);
    const foreign = await f.photo(15, other);
    for (const selected of [hidden, partial, foreign]) {
      await f.query("UPDATE catalog_galleries SET cover_photo_id=$1 WHERE id=$2", [
        selected,
        gallery,
      ]);
      const row = (await f.service.galleries(new URLSearchParams())).data.find(
        (g) => g.id === gallery,
      )!;
      assert.equal(row.coverPhotoId, good);
      assert.equal(row.photoCount, 2);
      assert.ok(!JSON.stringify(row).includes("PRIVATE-"));
    }
    await f.query("UPDATE catalog_galleries SET cover_photo_id=$1 WHERE id=$2", [good2, gallery]);
    assert.equal(
      (await f.service.galleries(new URLSearchParams())).data.find((g) => g.id === gallery)!
        .coverPhotoId,
      good2,
    );
    const page = await f.service.photos(gallery, new URLSearchParams("limit=1"));
    assert.equal(page.data[0].id, good);
    await f.query("UPDATE catalog_photos SET archived=true WHERE id=$1", [good]);
    const later = await f.service.photos(
      gallery,
      new URLSearchParams({ limit: "1", cursor: page.page.nextCursor! }),
    );
    assert.deepEqual(
      later.data.map((p) => p.id),
      [good2],
    );
    await assert.rejects(
      f.service.photos(gallery, new URLSearchParams("sort=filename")),
      /Unsupported photo sort/,
    );
    const library = await f.service.library(new URLSearchParams("q=frame"));
    assert.equal(library.data.length, 5);
    const serialized = JSON.stringify(library);
    for (const forbidden of [
      "PRIVATE-",
      "original_key",
      "checksum",
      "owner_id",
      "password_hash",
      "operation_token",
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
  } finally {
    await f.db.close();
  }
});

test("later protected photo pages reauthorize current password grant and publication state", async () => {
  const f = await fixture();
  try {
    const gallery = await f.gallery(1, "Protected", "public", "hash");
    await f.photo(11, gallery);
    await f.photo(12, gallery);
    const token = "test-only-grant";
    await f.query(
      "INSERT INTO catalog_access_grants(token_hash,gallery_id,access_version,expires_at) VALUES($1,$2,1,now()+interval '1 hour')",
      [await digest(new TextEncoder().encode(token)), gallery],
    );
    await assert.rejects(
      f.service.photos(gallery, new URLSearchParams("limit=1")),
      /password required/,
    );
    const first = await f.service.photos(gallery, new URLSearchParams("limit=1"), token);
    await f.query("UPDATE catalog_galleries SET access_version=2 WHERE id=$1", [gallery]);
    await assert.rejects(
      f.service.photos(gallery, new URLSearchParams({ cursor: first.page.nextCursor! }), token),
      /password required/,
    );
    await f.query("UPDATE catalog_galleries SET access_version=1,published=false WHERE id=$1", [
      gallery,
    ]);
    await assert.rejects(
      f.service.photos(gallery, new URLSearchParams({ cursor: first.page.nextCursor! }), token),
      /unavailable/,
    );
    const owner = await f.service.photos(gallery, new URLSearchParams(), undefined, true);
    assert.equal(owner.data.length, 2);
  } finally {
    await f.db.close();
  }
});

test("folder tree is bounded and excludes branches containing only private galleries; publication timestamps are recorded", async () => {
  const f = await fixture();
  try {
    await f.query(
      "INSERT INTO catalog_folders(id,title) VALUES($1,'Visible root'),($2,'Private root')",
      [uuid(101), uuid(103)],
    );
    await f.query("INSERT INTO catalog_folders(id,title,parent_id) VALUES($1,'Visible child',$2)", [
      uuid(102),
      uuid(101),
    ]);
    const pub = await f.gallery(1),
      priv = await f.gallery(2, "Private", "private");
    await f.query("UPDATE catalog_galleries SET folder_id=$1 WHERE id=$2", [uuid(102), pub]);
    await f.query("UPDATE catalog_galleries SET folder_id=$1 WHERE id=$2", [uuid(103), priv]);
    const first = await f.service.folders(new URLSearchParams("limit=1"));
    assert.deepEqual(
      first.data.map((v) => v.id),
      [uuid(101)],
    );
    const second = await f.service.folders(
      new URLSearchParams({ limit: "1", cursor: first.page.nextCursor! }),
    );
    assert.deepEqual(
      second.data.map((v) => v.id),
      [uuid(102)],
    );
    assert.equal(second.page.nextCursor, null);
    assert.equal((await f.service.folders(new URLSearchParams(), true)).data.length, 3);
    const visible = await f.service.galleries(new URLSearchParams({ folder: uuid(101) }));
    assert.deepEqual(
      visible.data.map((v) => v.id),
      [pub],
    );
    assert.ok(visible.data[0].publishedAt);
    const draft = await f.gallery(3, "Draft", "private", null, false);
    assert.equal(
      (await f.service.galleries(new URLSearchParams(), true)).data.find((v) => v.id === draft)
        ?.publishedAt,
      null,
    );
    await f.query("UPDATE catalog_galleries SET published=true WHERE id=$1", [draft]);
    assert.ok(
      (await f.service.galleries(new URLSearchParams(), true)).data.find((v) => v.id === draft)
        ?.publishedAt,
    );
  } finally {
    await f.db.close();
  }
});
