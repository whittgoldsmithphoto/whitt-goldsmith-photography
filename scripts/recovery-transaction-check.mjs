import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const input = process.argv[2];
if (!input) throw new Error("Supply the generated, readback-verified recovery SQL");
const sql = await readFile(input, "utf8");
const db = new PGlite();
try {
  for (const name of [
    "0005_catalog.sql",
    "0006_photo_management.sql",
    "0008_commerce.sql",
    "0023_media_jobs.sql",
    "0024_media_variants.sql",
    "0026_media_job_progress.sql",
  ])
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const id = "6d169876-d149-489a-93c1-2f97acd3f5fa",
    gallery = "97c36bdd-7b15-46d6-83ae-950bc4d1b7b1";
  await db.query("insert into catalog_galleries(id,title) values($1,'CCES Football @ St. Joes')", [
    gallery,
  ]);
  await db.query(
    "insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) values($1,$2,'fixture','SWG01676.jpg','image/jpeg',20638004,$3,'catalog/quarantine/fixture','needs_review')",
    [id, gallery, "eae9996d7d57fa4cc62ca1c372cc59560d69266762bf6ed54abcb61b2c424c32"],
  );
  await db.query(
    "insert into catalog_media_jobs(id,photo_id,owner_id,transformation_version,status,attempts) values('job',$1,'fixture',1,'failed',5)",
    [id],
  );
  await db.exec(sql);
  assert.equal((await db.query("select status from catalog_photos")).rows[0].status, "ready");
  assert.equal((await db.query("select count(*) from catalog_media_variants")).rows[0].count, 7);
  assert.equal((await db.query("select count(*) from catalog_derivatives")).rows[0].count, 2);
  assert.equal(
    (await db.query("select status from catalog_media_jobs")).rows[0].status,
    "completed",
  );
  assert.equal((await db.query("select count(*) from catalog_audit")).rows[0].count, 1);
  await assert.rejects(() => db.exec(sql), /Recovery identity\/state guard failed/);
  await db.exec("rollback");
  console.log(
    "PASS: guarded recovery publishes all seven variants and audit atomically; repeat execution rejects changed state.",
  );
} finally {
  await db.close();
}
