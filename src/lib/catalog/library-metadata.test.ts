import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createLibraryMetadata } from "./library-metadata.ts";

async function fixture() {
  const db = new PGlite();
  for (const name of ["0005_catalog.sql", "0006_photo_management.sql", "0030_library_metadata.sql"])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  await db.exec(`insert into catalog_galleries(id,title) values ('gallery','Game');
    insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status)
    select 'photo-'||n,'gallery','owner','SWG'||n||'.jpg','image/jpeg',6,repeat(md5(n::text),2),'original-'||n,'ready'
    from generate_series(1,3) n`);
  const sql = { query: async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows } as Sql;
  return { db, service: createLibraryMetadata(sql) };
}
test("bulk metadata normalizes keywords and persists ratings with filtered library reads", async () => {
  const f = await fixture();
  try {
    await f.service.bulk(
      {
        photos: [
          { id: "photo-1", revision: 0 },
          { id: "photo-2", revision: 0 },
        ],
        patch: { addKeywords: [" Football ", "football", "CCES"], rating: 5, label: "select" },
      },
      "owner",
    );
    const result = await f.service.list(
      new URLSearchParams("keyword=football&rating=5&label=select"),
    );
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0].keywords, ["cces", "football"]);
    assert.equal(result.items[0].revision, 1);
    await f.service.bulk(
      { photos: [{ id: "photo-1", revision: 1 }], patch: { removeKeywords: ["football"] } },
      "owner",
    );
    assert.equal((await f.service.list(new URLSearchParams("keyword=football"))).items.length, 1);
  } finally {
    await f.db.close();
  }
});
test("one stale or missing photo rolls back the entire bulk edit", async () => {
  const f = await fixture();
  try {
    await f.service.bulk(
      { photos: [{ id: "photo-2", revision: 0 }], patch: { rating: 2 } },
      "owner",
    );
    for (const second of [
      { id: "photo-2", revision: 0 },
      { id: "missing", revision: 0 },
    ]) {
      await assert.rejects(
        f.service.bulk(
          { photos: [{ id: "photo-1", revision: 0 }, second], patch: { rating: 5 } },
          "owner",
        ),
      );
      const first = (await f.service.list(new URLSearchParams("q=SWG1"))).items[0];
      assert.equal(first.rating, 0);
      assert.equal(first.revision, 0);
    }
    assert.equal(
      (await f.db.query("select * from catalog_audit where action='metadata.bulk'")).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("metadata input rejects unknown fields, duplicate targets and invalid filters", async () => {
  const f = await fixture();
  try {
    for (const input of [
      {
        photos: [
          { id: "photo-1", revision: 0 },
          { id: "photo-1", revision: 0 },
        ],
        patch: { rating: 1 },
      },
      { photos: [{ id: "photo-1", revision: 0 }], patch: { rating: 6 } },
      { photos: [{ id: "photo-1", revision: 0 }], patch: { published: true } },
      { photos: [{ id: "photo-1", revision: 0 }], patch: {} },
    ])
      await assert.rejects(f.service.bulk(input, "owner"));
    await assert.rejects(f.service.list(new URLSearchParams("rating=oops")));
    await assert.rejects(f.service.list(new URLSearchParams("label=unknown")));
  } finally {
    await f.db.close();
  }
});
