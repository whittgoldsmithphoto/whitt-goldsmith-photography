import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";

test("gallery download quotes snapshot all ready photos and grants bounded entitlements", async () => {
  const db = new PGlite();
  try {
    for (const name of ["0005_catalog.sql", "0006_photo_management.sql", "0008_commerce.sql", "0012_gallery_customer_policy.sql", "0028_gallery_downloads.sql"])
      await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
    const sql = Object.assign(
      async () => { throw new Error("query only"); },
      { query: async <T>(query: string, values: unknown[] = []) => (await db.query<T>(query, values)).rows },
    ) as Sql;
    await sql.query("INSERT INTO catalog_galleries(id,title,published,visibility,download_policy) VALUES('g','Test gallery',true,'public','purchased_only')");
    for (const [id, order] of [["p1", 1], ["p2", 2]] as const)
      await sql.query(
        "INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,display_order) VALUES($1,'g','owner',$2,'image/jpeg',3,$1,$1,'ready',$3)",
        [id, `${id}.jpg`, order],
      );
    await sql.query("INSERT INTO commerce_price_lists(id,name,is_default) VALUES('default','Default',true)");
    await sql.query("INSERT INTO commerce_products(id,name,kind,license,active) VALUES('album','Complete gallery','gallery_download','Personal and commercial use; no resale',true)");
    await sql.query("INSERT INTO commerce_prices(price_list_id,product_id,unit_cents) VALUES('default','album',2995)");
    const commerce = createCommerce(sql, async () => 1);
    const quote = await commerce.quote("customer", { galleryId: "g", items: [{ productId: "album", photoId: "p1", quantity: 1 }] });
    assert.equal(quote.total_cents, 2995);
    assert.deepEqual(quote.items[0].photoIds, ["p1", "p2"]);
    const order = await commerce.orderForQuote("customer", quote.id);
    await commerce.bindProviderSession(order.id, "cs_test_album");
    await commerce.applyVerifiedPayment({ eventId: "evt_album", orderId: order.id, kind: "paid", sessionId: "cs_test_album", paymentId: "pi_album", amountCents: 2995, currency: "usd" });
    const entitlements = await sql.query<{ photo_id: string; max_downloads: number }>("SELECT photo_id,max_downloads FROM commerce_entitlements WHERE order_id=$1 ORDER BY photo_id", [order.id]);
    assert.deepEqual(entitlements, [{ photo_id: "p1", max_downloads: 3 }, { photo_id: "p2", max_downloads: 3 }]);
  } finally {
    await db.close();
  }
});
