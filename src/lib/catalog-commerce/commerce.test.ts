import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createCommerce, type VerifiedPayment } from "./service.ts";
import { createCommerceHandler } from "./http.ts";

async function fixture() {
  const db = new PGlite();
  for (const name of ["0005_catalog.sql", "0006_photo_management.sql", "0008_commerce.sql"])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const sql = Object.assign(
    async () => {
      throw new Error("Use query");
    },
    {
      query: async <T>(query: string, values: unknown[] = []) =>
        (await db.query<T>(query, values)).rows,
    },
  ) as Sql;
  let authorized = true;
  const authorizeGallery = async (galleryId: string) => {
    if (!authorized) throw new Error("Gallery access denied");
    return (
      (
        await sql.query<{ revision: number }>(
          `SELECT revision FROM catalog_galleries WHERE id=$1`,
          [galleryId],
        )
      )[0]?.revision || 1
    );
  };
  const commerce = createCommerce(sql, authorizeGallery);
  await db.exec(`INSERT INTO catalog_galleries(id,title,visibility,published) VALUES('gallery','Football','public',true),('private','Private','private',false);
    INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
    VALUES('photo','gallery','owner','real.jpg','image/jpeg',500,'hash','private/original.jpg','ready',6000,4000),
    ('photo2','gallery','owner','second.jpg','image/jpeg',600,'hash2','private/second.jpg','ready',6000,4000);`);
  await commerce.configurePriceList({ id: "default", name: "Default", isDefault: true });
  await commerce.configureProduct({
    id: "digital",
    name: "Digital original",
    license: "Personal use only",
    active: true,
  });
  await commerce.configurePrice({ priceListId: "default", productId: "digital", unitCents: 2500 });
  const request = {
    galleryId: "gallery",
    items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
  };
  async function pending() {
    const q = await commerce.quote("customer", request);
    const o = await commerce.orderForQuote("customer", q.id);
    await commerce.bindProviderSession(o.id, `cs_${o.id}`);
    const event: VerifiedPayment = {
      eventId: `evt_${o.id}`,
      orderId: o.id,
      kind: "paid",
      sessionId: `cs_${o.id}`,
      paymentId: `pi_${o.id}`,
      amountCents: q.total_cents,
      currency: "usd",
    };
    return { q, o, event };
  }
  return {
    db,
    sql,
    commerce,
    request,
    pending,
    authorizeGallery,
    deny: () => {
      authorized = false;
    },
  };
}

test("quote uses database prices/licenses, inherits default and explicit gallery list", async () => {
  const f = await fixture();
  try {
    const q = await f.commerce.quote("customer", f.request);
    assert.equal(q.total_cents, 2500);
    assert.equal(q.items[0].license, "Personal use only");
    assert.equal(q.items[0].name, "Digital original");
    await assert.rejects(f.commerce.quote("customer", { ...f.request, totalCents: 1 }));
    await assert.rejects(
      f.commerce.quote("customer", {
        ...f.request,
        items: [{ ...f.request.items[0], unitCents: 1 }],
      }),
    );
    await f.commerce.configurePriceList({ id: "event", name: "Event prices", isDefault: false });
    await f.commerce.configurePrice({
      priceListId: "event",
      productId: "digital",
      unitCents: 1700,
    });
    await f.commerce.assignGalleryPriceList("gallery", "event");
    assert.equal((await f.commerce.quote("customer", f.request)).total_cents, 1700);
    assert.equal(
      (
        await f.db.query<{ total_cents: number }>(
          `SELECT total_cents FROM commerce_quotes WHERE id=$1`,
          [q.id],
        )
      ).rows[0].total_cents,
      2500,
    );
    assert.ok(new Date(q.expires_at).getTime() <= Date.now() + 901000);
  } finally {
    await f.db.close();
  }
});

test("quotes reject inaccessible, hidden, archived, unavailable, duplicate and invalid selections", async () => {
  const f = await fixture();
  try {
    for (const values of [{ hidden: true }, { archived: true }, { status: "processing" }]) {
      const [key, value] = Object.entries(values)[0];
      await f.db.query(`UPDATE catalog_photos SET ${key}=$1 WHERE id='photo'`, [value]);
      await assert.rejects(f.commerce.quote("customer", f.request), /Photo unavailable/);
      await f.db.exec(`UPDATE catalog_photos SET hidden=false,archived=false,status='ready'`);
    }
    await assert.rejects(
      f.commerce.quote("customer", {
        ...f.request,
        items: [...f.request.items, ...f.request.items],
      }),
      /Duplicate/,
    );
    await assert.rejects(
      f.commerce.quote("customer", {
        ...f.request,
        items: [{ ...f.request.items[0], quantity: 2 }],
      }),
      /not enabled/,
    );
    await assert.rejects(
      f.commerce.quote("customer", { ...f.request, galleryId: "private" }),
      /Gallery unavailable/,
    );
    await f.db.exec(`UPDATE commerce_products SET active=false`);
    await assert.rejects(f.commerce.quote("customer", f.request), /Product unavailable/);
    f.deny();
    await assert.rejects(f.commerce.quote("customer", f.request), /access denied/);
  } finally {
    await f.db.close();
  }
});

test("coupon reservations enforce limits, expiry, scope, minimum and consumption exactly once", async () => {
  const f = await fixture();
  try {
    await f.commerce.configureCoupon({
      code: "GAME25",
      percentOff: 25,
      maxUses: 1,
      minimumCents: 2000,
      galleryId: "gallery",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      active: true,
    });
    const request = { ...f.request, couponCode: "game25" };
    const q = await f.commerce.quote("customer", request);
    assert.equal(q.total_cents, 1875);
    assert.equal(q.discount_cents, 625);
    await assert.rejects(f.commerce.quote("other", request), /exhausted/);
    await f.db.query(
      `UPDATE commerce_quotes SET expires_at=now()-interval '1 second' WHERE id=$1`,
      [q.id],
    );
    const replacement = await f.commerce.quote("customer", request);
    const o = await f.commerce.orderForQuote("customer", replacement.id);
    await f.commerce.bindProviderSession(o.id, "session");
    await f.db.query(
      `UPDATE commerce_quotes SET expires_at=now()-interval '1 second' WHERE id=$1`,
      [replacement.id],
    );
    await assert.rejects(f.commerce.quote("other", request), /exhausted/);
    const event: VerifiedPayment = {
      eventId: "event",
      orderId: o.id,
      kind: "paid",
      sessionId: "session",
      paymentId: "payment",
      amountCents: 1875,
      currency: "usd",
    };
    await f.commerce.applyVerifiedPayment(event);
    await f.commerce.applyVerifiedPayment(event);
    assert.equal(
      (await f.db.query<{ consumed: number }>(`SELECT consumed FROM commerce_coupons`)).rows[0]
        .consumed,
      1,
    );
    await assert.rejects(f.commerce.quote("other", request), /exhausted/);
  } finally {
    await f.db.close();
  }
});

test("orders are customer-scoped, idempotent, expiring and recheck gallery access version", async () => {
  const f = await fixture();
  try {
    const q = await f.commerce.quote("customer", f.request);
    await assert.rejects(f.commerce.orderForQuote("other", q.id), /unavailable/);
    await f.db.query(
      `UPDATE commerce_quotes SET expires_at=now()-interval '1 second' WHERE id=$1`,
      [q.id],
    );
    await assert.rejects(f.commerce.orderForQuote("customer", q.id), /expired/);
    const q2 = await f.commerce.quote("customer", f.request);
    await f.db.exec(`UPDATE catalog_galleries SET access_version=access_version+1`);
    await assert.rejects(f.commerce.orderForQuote("customer", q2.id), /no longer available/);
    const { q: q3, o } = await f.pending();
    assert.equal((await f.commerce.orderForQuote("customer", q3.id)).id, o.id);
    await assert.rejects(f.commerce.customerOrder("other", o.id), /unavailable/);
    assert.equal((await f.commerce.customerOrder("customer", o.id)).status, "pending");
    await assert.rejects(f.commerce.bindProviderSession(o.id, "changed"), /cannot be replaced/);
  } finally {
    await f.db.close();
  }
});

test("payment rejects amount/session/identity mismatches and webhook replays grant once", async () => {
  const f = await fixture();
  try {
    const { o, event } = await f.pending();
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, amountCents: 1 }),
      /does not match/,
    );
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, sessionId: "wrong" }),
      /does not match/,
    );
    assert.equal((await f.commerce.applyVerifiedPayment(event)).status, "paid");
    assert.equal((await f.commerce.applyVerifiedPayment(event)).status, "paid");
    await f.commerce.applyVerifiedPayment({ ...event, eventId: "different-delivery" });
    assert.equal(
      (await f.db.query(`SELECT * FROM commerce_entitlements WHERE order_id=$1`, [o.id])).rows
        .length,
      1,
    );
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, kind: "refunded" }),
      /Conflicting event replay/,
    );
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, eventId: "other", paymentId: "wrong" }),
      /identity mismatch/,
    );
    assert.equal(
      (await f.commerce.applyVerifiedPayment({ ...event, eventId: "late-failure", kind: "failed" }))
        .status,
      "paid",
    );
  } finally {
    await f.db.close();
  }
});

test("hashed tokens are customer-scoped, rotate, cap downloads, expire and revoke on full refund", async () => {
  const f = await fixture();
  try {
    const { o, event } = await f.pending();
    await assert.rejects(f.commerce.issueDownloadToken("customer", `${o.id}:photo`), /unavailable/);
    await f.commerce.applyVerifiedPayment(event);
    const entitlement = `${o.id}:photo`;
    await assert.rejects(f.commerce.issueDownloadToken("other", entitlement), /unavailable/);
    const first = await f.commerce.issueDownloadToken("customer", entitlement);
    const second = await f.commerce.issueDownloadToken("customer", entitlement);
    const stored = (
      await f.db.query<{ token_hash: string }>(`SELECT token_hash FROM commerce_entitlements`)
    ).rows[0].token_hash;
    assert.notEqual(stored, second.token);
    await assert.rejects(f.commerce.reserveDownload("customer", first.token), /unavailable/);
    await assert.rejects(f.commerce.reserveDownload("other", second.token), /unavailable/);
    assert.notEqual(first.token, second.token);
    await assert.rejects(
      f.commerce.reserveDownload("customer", second.token),
      /legacy reservation disabled/,
    );
    await f.db.exec(`UPDATE commerce_entitlements SET downloads=10`);
    await assert.rejects(f.commerce.reserveDownload("customer", second.token), /unavailable/);
    await f.db.exec(
      `UPDATE commerce_entitlements SET downloads=0,expires_at=now()-interval '1 second'`,
    );
    await assert.rejects(f.commerce.reserveDownload("customer", second.token), /unavailable/);
    await f.db.exec(`UPDATE commerce_entitlements SET expires_at=now()+interval '1 day'`);
    assert.equal(
      (await f.commerce.applyVerifiedPayment({ ...event, eventId: "refund", kind: "refunded" }))
        .status,
      "refunded",
    );
    await assert.rejects(f.commerce.reserveDownload("customer", second.token), /unavailable/);
    await assert.rejects(f.commerce.issueDownloadToken("customer", entitlement), /unavailable/);
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, eventId: "late-paid" }),
      /Invalid payment transition/,
    );
  } finally {
    await f.db.close();
  }
});

test("failed provider event releases reserved coupon and cannot grant downloads", async () => {
  const f = await fixture();
  try {
    await f.commerce.configureCoupon({
      code: "ONEUSE",
      percentOff: 10,
      maxUses: 1,
      minimumCents: 0,
      galleryId: null,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      active: true,
    });
    const request = { ...f.request, couponCode: "ONEUSE" };
    const q = await f.commerce.quote("customer", request);
    const o = await f.commerce.orderForQuote("customer", q.id);
    await f.commerce.bindProviderSession(o.id, "session");
    const event: VerifiedPayment = {
      eventId: "event",
      orderId: o.id,
      kind: "paid",
      sessionId: "session",
      paymentId: "payment",
      amountCents: q.total_cents,
      currency: "usd",
    };
    await assert.rejects(f.commerce.quote("other", request), /exhausted/);
    assert.equal(
      (await f.commerce.applyVerifiedPayment({ ...event, kind: "failed" })).status,
      "failed",
    );
    await assert.rejects(
      f.commerce.applyVerifiedPayment({ ...event, eventId: "late-paid" }),
      /Invalid payment transition/,
    );
    assert.equal(
      (await f.db.query(`SELECT * FROM commerce_entitlements WHERE order_id=$1`, [o.id])).rows
        .length,
      0,
    );
    assert.equal((await f.commerce.quote("other", request)).total_cents, 2250);
  } finally {
    await f.db.close();
  }
});

test("concurrent coupon reservation has one winner; repeated order creation returns one order", async () => {
  const f = await fixture();
  try {
    await f.commerce.configureCoupon({
      code: "LIMIT",
      percentOff: 10,
      maxUses: 1,
      minimumCents: 0,
      galleryId: null,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      active: true,
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, n) =>
        f.commerce.quote(`customer${n}`, { ...f.request, couponCode: "LIMIT" }),
      ),
    );
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const q = await f.commerce.quote("customer", f.request);
    const orders = await Promise.all(
      Array.from({ length: 5 }, () => f.commerce.orderForQuote("customer", q.id)),
    );
    assert.equal(new Set(orders.map((order) => order.id)).size, 1);
  } finally {
    await f.db.close();
  }
});

test("gallery authorization revision cannot be reused after access settings change", async () => {
  const f = await fixture();
  try {
    const racing = createCommerce(f.sql, async () => {
      await f.db.exec(
        `UPDATE catalog_galleries SET revision=revision+1,access_version=access_version+1 WHERE id='gallery'`,
      );
      return 1;
    });
    await assert.rejects(racing.quote("customer", f.request), /Gallery unavailable/);
  } finally {
    await f.db.close();
  }
});

test("HTTP rejects anonymous/non-owner mutations, cross-origin, oversized payloads, forged payments and checkout", async () => {
  const f = await fixture();
  try {
    let signedIn = false;
    let isOwner = false;
    const denied = (status: number) => Object.assign(new Error("Denied"), { status });
    const handler = createCommerceHandler({
      sql: f.sql,
      authorizeGallery: f.authorizeGallery,
      user: async () => {
        if (!signedIn) throw denied(401);
        return "customer";
      },
      owner: async () => {
        if (!signedIn) throw denied(401);
        if (!isOwner) throw denied(403);
        return "owner";
      },
    });
    const req = (op: string, body?: unknown, origin = "https://example.test") =>
      new Request(`https://example.test/api/commerce?op=${op}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    assert.equal((await handler(req("owner"))).status, 401);
    assert.equal((await handler(req("quote", f.request))).status, 401);
    signedIn = true;
    assert.equal((await handler(req("owner"))).status, 403);
    assert.equal((await handler(req("product", {}))).status, 403);
    assert.equal((await handler(req("quote", f.request, "https://evil.test"))).status, 403);
    assert.equal((await handler(req("quote", { data: "x".repeat(33000) }))).status, 413);
    assert.equal((await handler(req("payment", { status: "paid" }))).status, 404);
    assert.equal((await handler(req("checkout", { quoteId: "fake" }))).status, 503);
    isOwner = true;
    assert.equal((await handler(req("owner"))).status, 200);
    const response = await handler(req("quote", f.request));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const data = await response.json();
    assert.equal(data.quote.total_cents, 2500);
    assert.equal(data.checkoutAvailable, false);
  } finally {
    await f.db.close();
  }
});
