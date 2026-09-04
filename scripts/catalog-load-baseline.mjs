import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createGalleryService } from "../src/lib/catalog/gallery-service.ts";

export const BASELINE_BUDGETS = Object.freeze({ maxItems: 50, maxResponseBytes: 128 * 1024, maxQueries: 2, maxRowsPerQuery: 51 });
const galleryId = "10000000-0000-4000-8000-000000000001";

/** Always a fresh in-memory database; deliberately never reads DATABASE_URL. */
export async function createBaselineFixture() {
  const db = new PGlite();
  try {
    for (const name of ["0005_catalog.sql", "0006_photo_management.sql", "0012_gallery_customer_policy.sql", "0016_catalog_pagination_and_covers.sql"]) {
      await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    await db.exec(`
      insert into catalog_galleries(id,title,published,visibility)
      select '10000000-0000-4000-8000-' || lpad(i::text,12,'0'), 'Synthetic gallery ' || lpad(i::text,3,'0'),true,'public' from generate_series(1,100) i;
      insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height,display_order)
      select '20000000-0000-4000-8000-' || lpad(i::text,12,'0'),
        '10000000-0000-4000-8000-' || lpad((((i-1)/100)+1)::text,12,'0'),
        'synthetic-owner','fixture-'||i||'.jpg','image/jpeg',1000,md5(i::text),'private-fixture/'||i,'ready',6000,4000,(i-1)%100
      from generate_series(1,10000) i;
      insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
      select id,k.kind,'private-derivative/'||id||'/'||k.kind,100,checksum
      from catalog_photos cross join (values ('thumb'),('preview')) k(kind);
      analyze catalog_galleries; analyze catalog_photos; analyze catalog_derivatives;
    `);
    const queries = [];
    const query = async (text, params = []) => {
      const start = performance.now();
      const result = await db.query(text, params);
      queries.push({ durationMs: performance.now() - start, rows: result.rows.length });
      return result.rows;
    };
    const sql = (strings, ...values) => query(strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values);
    sql.query = query;
    const service = createGalleryService(sql, async id => {
      const rows = await query("select * from catalog_galleries where id=$1 and published and visibility='public' and password_hash is null", [id]);
      if (!rows[0]) throw new Error("Synthetic gallery unavailable");
      return rows[0];
    });
    return { service, queries, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

export function assertBoundedResponse(response) {
  if (!Array.isArray(response.data) || response.data.length > BASELINE_BUDGETS.maxItems) throw new Error("Resource response is not bounded");
  const serialized = JSON.stringify(response);
  if (/"(?:original_key|originalKey|object_key|objectKey|password_hash|passwordHash|operation_token|checksum)"\s*:/.test(serialized) || serialized.includes("private-fixture/") || serialized.includes("private-derivative/")) throw new Error("Resource response exposed private storage metadata");
  const responseBytes = Buffer.byteLength(serialized);
  if (responseBytes > BASELINE_BUDGETS.maxResponseBytes) throw new Error("Resource response bytes exceed fixture budget");
  return { itemCount: response.data.length, coverCount: response.data.filter(item => item.cover != null).length, responseBytes };
}

export async function measureBaseline(fixture) {
  const resources = {};
  const operations = {
    publicIndex: () => fixture.service.galleries(new URLSearchParams({ limit: "50" })),
    galleryPhotos: () => fixture.service.photos(galleryId, new URLSearchParams({ limit: "50" })),
    ownerLibrary: () => fixture.service.library(new URLSearchParams({ limit: "50" })),
  };
  for (const [name, operation] of Object.entries(operations)) {
    fixture.queries.length = 0;
    const memoryBefore = process.memoryUsage();
    const start = performance.now();
    const response = await operation();
    const durationMs = performance.now() - start;
    const memoryAfter = process.memoryUsage();
    const shape = assertBoundedResponse(response);
    const queryCount = fixture.queries.length;
    const maxRowsReturned = Math.max(0, ...fixture.queries.map(query => query.rows));
    if (queryCount > BASELINE_BUDGETS.maxQueries || maxRowsReturned > BASELINE_BUDGETS.maxRowsPerQuery) throw new Error("Resource query budget exceeded");
    resources[name] = { ...shape, durationMs, queryCount, maxRowsReturned, heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed, rssBytes: memoryAfter.rss };
  }
  return { schemaVersion: 1, measuredAt: new Date().toISOString(), engine: "in-memory PGlite; synthetic fixtures; not production SLO evidence", fixture: { galleries: 100, photos: 10000, derivatives: 20000 }, budgets: BASELINE_BUDGETS, resources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1])) throw new Error("Usage: node --experimental-strip-types scripts/catalog-load-baseline.mjs [--output new-file.json]");
  const fixture = await createBaselineFixture();
  try {
    const report = JSON.stringify(await measureBaseline(fixture), null, 2) + "\n";
    if (args.length) await writeFile(args[1], report, { flag: "wx" });
    else process.stdout.write(report);
  } finally { await fixture.close(); }
}
