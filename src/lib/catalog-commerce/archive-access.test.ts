import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";
import { paidArchiveAccess } from "./archive-access.ts";
import { createArchiveJobs } from "./archive-jobs.ts";
import { createArchiveHandler } from "./archive-http.ts";
import { createHash, randomUUID } from "node:crypto";

test("archive access uses only the paid album snapshot and rejects changed access", async () => {
  const db = new PGlite();
  try {
    for (const name of [
      "0005_catalog.sql",
      "0006_photo_management.sql",
      "0008_commerce.sql",
      "0012_gallery_customer_policy.sql",
      "0028_gallery_downloads.sql",
    ])
      await db.exec(
        await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"),
      );
    const sql = Object.assign(
      async () => {
        throw new Error("query only");
      },
      {
        query: async <T>(query: string, values: unknown[] = []) =>
          (await db.query<T>(query, values)).rows,
      },
    ) as Sql;
    await sql.query(
      "INSERT INTO catalog_galleries(id,title,published,visibility,download_policy) VALUES('g','Public album',true,'public','purchased_only')",
    );
    for (const id of ["p1", "p2"])
      await sql.query(
        "INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) VALUES($1,'g','owner',$2,'image/jpeg',3,$3,$4,'ready')",
        [id, `${id}.jpg`, (id === "p1" ? "a" : "b").repeat(64), `catalog/originals/${id}`],
      );
    await sql.query(
      "INSERT INTO commerce_price_lists(id,name,is_default) VALUES('default','Default',true)",
    );
    await sql.query(
      "INSERT INTO commerce_products(id,name,kind,license,active) VALUES('album','Album','gallery_download','Perpetual personal and commercial use; no resale',true)",
    );
    await sql.query(
      "INSERT INTO commerce_prices(price_list_id,product_id,unit_cents) VALUES('default','album',2995)",
    );
    const commerce = createCommerce(sql, async () => 1);
    const quote = await commerce.quote("buyer", {
      galleryId: "g",
      items: [{ productId: "album", photoId: "p1", quantity: 1 }],
    });
    const order = await commerce.orderForQuote("buyer", quote.id);
    const access = paidArchiveAccess(sql);
    await assert.rejects(() => access.snapshot(order.id, "buyer"));
    await commerce.bindProviderSession(order.id, "cs_test_archive");
    await commerce.applyVerifiedPayment({
      eventId: "evt_archive",
      orderId: order.id,
      kind: "paid",
      sessionId: "cs_test_archive",
      paymentId: "pi_archive",
      amountCents: 2995,
      currency: "usd",
    });
    const manifest = await access.snapshot(order.id, "buyer");
    assert.deepEqual(
      manifest.map((p) => p.photoId),
      ["p1", "p2"],
    );
    await assert.rejects(() => access.snapshot(order.id, "intruder"));
    await sql.query(
      "INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) VALUES('later','g','owner','later.jpg','image/jpeg',3,$1,'catalog/originals/later','ready')",
      ["c".repeat(64)],
    );
    assert.equal((await access.snapshot(order.id, "buyer")).length, 2);
    await access.authorize({ order_id: order.id, customer_id: "buyer", manifest });
    await assert.rejects(() =>
      access.authorize({
        order_id: order.id,
        customer_id: "buyer",
        manifest: [{ ...manifest[0], objectKey: "private/unpurchased" }, manifest[1]],
      }),
    );
    await assert.rejects(() =>
      access.authorize({ order_id: order.id, customer_id: "buyer", manifest: [manifest[0]] }),
    );
    for (const change of [
      "downloads=max_downloads",
      "expires_at=now()-interval '1 second'",
      "revoked_at=now()",
    ]) {
      await sql.query(`UPDATE commerce_entitlements SET ${change} WHERE photo_id='p1'`);
      await assert.rejects(() => access.snapshot(order.id, "buyer"));
      await sql.query(
        "UPDATE commerce_entitlements SET downloads=0,expires_at=now()+interval '14 days',revoked_at=null WHERE photo_id='p1'",
      );
    }
    await sql.query("UPDATE catalog_galleries SET visibility='private' WHERE id='g'");
    await assert.rejects(() => access.snapshot(order.id, "buyer"));
    await sql.query("UPDATE catalog_galleries SET visibility='public' WHERE id='g'");
    await sql.query("UPDATE catalog_photos SET hidden=true WHERE id='p2'");
    await assert.rejects(() => access.snapshot(order.id, "buyer"));
    await sql.query("UPDATE catalog_photos SET hidden=false WHERE id='p2'");
    await sql.query("UPDATE commerce_orders SET status='refunded' WHERE id=$1", [order.id]);
    await assert.rejects(() => access.snapshot(order.id, "buyer"));
    await sql.query("UPDATE commerce_orders SET status='paid' WHERE id=$1", [order.id]);
    for (const name of ["0029_archive_jobs.sql", "0032_archive_delivery.sql"])
      await db.exec(
        await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"),
      );
    const job = await createArchiveJobs(sql).enqueue({
      orderId: order.id,
      customerId: "buyer",
      manifest,
    });
    const key = `catalog/archives/${job.id}/test.zip`;
    await sql.query(
      "UPDATE commerce_archive_jobs SET status='completed',output_key=$2,output_checksum=$3,output_bytes=99 WHERE id=$1",
      [job.id, key, "d".repeat(64)],
    );
    const reserve = async (customer = "buyer", objectKey = key) =>
      (
        await sql.query<{ allowed: boolean }>(
          "SELECT commerce_reserve_archive_download($1,$2,$3,$4,$5) AS allowed",
          [customer, job.id, objectKey, "d".repeat(64), 99],
        )
      )[0].allowed;
    assert.equal(await reserve("intruder"), false);
    assert.equal(await reserve("buyer", "private/other.zip"), false);
    for (let i = 0; i < 3; i++) assert.equal(await reserve(), true);
    assert.equal(await reserve(), false);
    assert.deepEqual(
      (
        await sql.query<{ downloads: number }>(
          "SELECT downloads FROM commerce_entitlements WHERE order_id=$1 ORDER BY photo_id",
          [order.id],
        )
      ).map((e) => e.downloads),
      [3, 3],
    );
    await sql.query(
      "UPDATE commerce_entitlements SET downloads=0 WHERE order_id=$1 AND photo_id='p1'",
      [order.id],
    );
    assert.equal(await reserve(), false);
    assert.equal(
      (
        await sql.query<{ downloads: number }>(
          "SELECT downloads FROM commerce_entitlements WHERE order_id=$1 AND photo_id='p1'",
          [order.id],
        )
      )[0].downloads,
      0,
    );
    await sql.query(
      "UPDATE commerce_entitlements SET downloads=0,expires_at=now()-interval '1 second' WHERE order_id=$1",
      [order.id],
    );
    assert.equal(await reserve(), false);
    await sql.query(
      "UPDATE commerce_entitlements SET expires_at=now()+interval '14 days' WHERE order_id=$1",
      [order.id],
    );
    await sql.query("UPDATE commerce_orders SET status='refunded' WHERE id=$1", [order.id]);
    assert.equal(await reserve(), false);
    // Exercise the actual HTTP boundary against the database, not a mocked
    // authorization result. These bytes stand in for an already verified ZIP.
    await sql.query("UPDATE commerce_orders SET status='paid' WHERE id=$1", [order.id]);
    await sql.query("UPDATE commerce_entitlements SET downloads=0 WHERE order_id=$1", [order.id]);
    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    const zipKey = `catalog/archives/${job.id}/${randomUUID()}.zip`;
    const zipHash = createHash("sha256").update(zipBytes).digest("hex");
    await sql.query(
      "UPDATE commerce_archive_jobs SET output_key=$2,output_checksum=$3,output_bytes=$4 WHERE id=$1",
      [job.id, zipKey, zipHash, zipBytes.length],
    );
    let identity = "buyer";
    let corrupt = false;
    const handler = createArchiveHandler(true, {
      sql,
      user: async () => identity,
      get: async (requestedKey) => {
        assert.equal(requestedKey, zipKey);
        return {
          size: zipBytes.length,
          etag: zipHash,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(corrupt ? new Uint8Array(4) : zipBytes);
              controller.close();
            },
          }),
        };
      },
    });
    const request = (op: string) =>
      handler(
        new Request("https://photos.example/api/commerce-archive", {
          method: "POST",
          headers: { origin: "https://photos.example", "content-type": "application/json" },
          body: JSON.stringify({ op, jobId: job.id }),
        }),
      );
    identity = "intruder";
    assert.equal((await request("deliver")).status, 404);
    identity = "buyer";
    const status = await request("status");
    assert.deepEqual(await status.json(), { jobId: job.id, status: "completed" });
    corrupt = true;
    assert.equal((await request("deliver")).status, 503);
    corrupt = false;
    for (let i = 0; i < 3; i++) {
      const response = await request("deliver");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zipBytes);
    }
    assert.equal((await request("deliver")).status, 404);
  } finally {
    await db.close();
  }
});
