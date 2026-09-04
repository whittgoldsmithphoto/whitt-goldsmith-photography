import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";

test("tax and payment settle atomically, replay once, and refund revokes grants", async () => {
  const db = new PGlite();
  try {
    const directory = new URL("../../../migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    const sql = Object.assign(
      async () => {
        throw new Error("query only");
      },
      {
        query: async <T>(query: string, args: unknown[] = []) =>
          (await db.query<T>(query, args)).rows,
      },
    ) as Sql;
    await db.exec(`INSERT INTO catalog_galleries(id,title,published,visibility,download_policy) VALUES('g','Tax test',true,'public','purchased_only');
      INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
      VALUES('p','g','owner','test.jpg','image/jpeg',100,'hash','private/test.jpg','ready',100,100)`);
    const commerce = createCommerce(sql, async () => 1);
    await commerce.configurePriceList({ id: "default", name: "Default", isDefault: true });
    await commerce.configureProduct({
      id: "d",
      name: "Digital",
      license: "Personal",
      active: true,
    });
    await commerce.configurePrice({ priceListId: "default", productId: "d", unitCents: 2500 });
    const quote = await commerce.quote("buyer", {
      galleryId: "g",
      items: [{ photoId: "p", productId: "d", quantity: 1 }],
    });
    const order = await commerce.orderForQuote("buyer", quote.id);
    await commerce.bindProviderSession(order.id, "cs_live_tax");
    await sql.query(
      `INSERT INTO commerce_checkout_attempts(order_id,account_id,origin,environment,params,expires_at,provider_session_id,state)
      VALUES($1,'acct_fixture','https://photos.example.com','production','{"automatic_tax":{"enabled":true}}',now()+interval '1 hour','cs_live_tax','bound')`,
      [order.id],
    );
    const apply = (eid: string, kind: string, tax: number, amount: number, review = false) =>
      sql.query(
        "SELECT * FROM commerce_apply_taxed_payment($1,$2,'cs_live_tax','pi_tax',$3,$4,$5,'usd',$6)",
        [eid, order.id, kind, amount, tax, review],
      );
    await assert.rejects(apply("evt_bad", "paid", 175, 2500), /mismatch/);
    assert.equal(
      (await sql.query<{ n: number }>("SELECT count(*)::int n FROM commerce_tax_settlements"))[0].n,
      0,
    );
    await assert.rejects(apply("evt_bad", "invalid", 175, 2675));
    assert.equal(
      (
        await sql.query<{ tax_cents: number }>(
          "SELECT tax_cents FROM commerce_quotes WHERE id=$1",
          [quote.id],
        )
      )[0].tax_cents,
      0,
    );
    await apply("evt_paid", "paid", 175, 2675);
    await apply("evt_paid", "paid", 175, 2675);
    assert.equal(
      (
        await sql.query<{ n: number }>(
          "SELECT count(*)::int n FROM commerce_entitlements WHERE order_id=$1",
          [order.id],
        )
      )[0].n,
      1,
    );
    assert.equal(
      (
        await sql.query<{ total_cents: number }>(
          "SELECT total_cents FROM commerce_quotes WHERE id=$1",
          [quote.id],
        )
      )[0].total_cents,
      2675,
    );
    await assert.rejects(apply("evt_changed", "paid", 176, 2676), /Conflicting tax/);
    await apply("evt_refund", "full_refund", 175, 2675, true);
    assert.equal((await commerce.customerOrder("buyer", order.id)).status, "refunded");
    await assert.rejects(apply("evt_late", "paid", 175, 2675));
    assert.equal(
      (
        await sql.query<{ n: number }>(
          "SELECT count(*)::int n FROM commerce_entitlements WHERE order_id=$1 AND revoked_at IS NULL",
          [order.id],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
