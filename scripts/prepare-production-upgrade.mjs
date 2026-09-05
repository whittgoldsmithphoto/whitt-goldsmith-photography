// Produces a reviewable SQL artifact; never connects to or changes a remote DB.
import { readFile, readdir, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const names = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
assert.equal(names.at(-1), "0032_archive_delivery.sql");
const pending = names.filter((name) => name > "0022_payment_recovery.sql");
assert.equal(pending.length, 10);
const source = new Map(
  await Promise.all(
    names.map(async (name) => [name, await readFile(`migrations/${name}`, "utf8")]),
  ),
);
const sql = `BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s';
SELECT pg_advisory_xact_lock(742198035);
LOCK TABLE catalog_photos, commerce_orders, commerce_entitlements IN SHARE MODE;
DO $$ BEGIN
IF current_database()<>'neondb' OR (SELECT max(name) FROM _migrations)<>'0022_payment_recovery.sql'
 OR (SELECT count(*) FROM _migrations)<>22 OR (SELECT count(*) FROM catalog_photos)<>3
 OR EXISTS(SELECT 1 FROM commerce_orders) OR EXISTS(SELECT 1 FROM commerce_entitlements)
THEN RAISE EXCEPTION 'Production baseline changed; stop and inspect'; END IF; END $$;
CREATE TEMP TABLE wgp_photo_preservation ON COMMIT DROP AS SELECT id,to_jsonb(p) AS snapshot FROM catalog_photos p;
${pending.map((name) => `${source.get(name)}\nINSERT INTO _migrations(name) VALUES('${name}');`).join("\n")}
DO $$ BEGIN
IF (SELECT count(*) FROM _migrations)<>32 OR (SELECT max(name) FROM _migrations)<>'0032_archive_delivery.sql'
 OR (SELECT count(*) FROM catalog_photos)<>3 OR EXISTS(SELECT 1 FROM commerce_orders)
 OR EXISTS(SELECT 1 FROM commerce_entitlements)
 OR EXISTS(SELECT 1 FROM catalog_photos p FULL JOIN wgp_photo_preservation b ON b.id=p.id
   WHERE b.snapshot IS DISTINCT FROM to_jsonb(p))
THEN RAISE EXCEPTION 'Upgrade preservation check failed'; END IF; END $$;
COMMIT;
SELECT max(name) AS latest_migration,count(*) AS applied_migrations FROM _migrations;
`;
const db = new PGlite();
try {
  await db.exec("CREATE TABLE _migrations(name text primary key)");
  for (const name of names.filter((name) => !pending.includes(name))) {
    await db.exec(source.get(name));
    await db.query("INSERT INTO _migrations(name) VALUES($1)", [name]);
  }
  await db.exec("INSERT INTO catalog_galleries(id,title) VALUES('fixture','Recovery fixture')");
  for (const id of ["a", "b", "c"])
    await db.query(
      "INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) VALUES($1,'fixture','owner',$2,'image/jpeg',3,$3,$4,'ready')",
      [id, `${id}.jpg`, id.repeat(64), `catalog/originals/${id}`],
    );
  // PGlite uses a different database name. Only this exact identity term changes
  // for the dry run; the generated remote SQL retains the neondb guard.
  const local = sql.replace("current_database()<>'neondb'", "false");
  await db.exec(local);
  assert.equal((await db.query("SELECT count(*) AS n FROM _migrations")).rows[0].n, 32);
  await assert.rejects(db.exec(local), /Production baseline changed/);
  await db.exec("ROLLBACK");
} finally {
  await db.close();
}
const folder = await mkdtemp(join(tmpdir(), "wgp-production-upgrade-"));
const path = join(folder, "verified-production-upgrade.sql");
await writeFile(path, sql, { flag: "wx" });
console.log(JSON.stringify({ verified: true, pending, path, remoteDatabaseChanged: false }));
