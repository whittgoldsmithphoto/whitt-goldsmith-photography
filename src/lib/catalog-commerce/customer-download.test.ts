import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";
import {
  createCustomerDownloadHandler,
  customerDownloadsEnabled,
  CustomerDownloadError,
  type CustomerDownloadDependencies,
} from "./customer-download.ts";

async function fixture(includeMigration = true) {
  const db = new PGlite();
  for (const name of [
    "0005_catalog.sql",
    "0006_photo_management.sql",
    "0008_commerce.sql",
    "0012_gallery_customer_policy.sql",
    ...(includeMigration ? ["0013_customer_download_authorization.sql"] : []),
  ])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const sql = Object.assign(
    async () => {
      throw new Error("query only");
    },
    {
      query: async <T>(query: string, params: unknown[] = []) =>
        (await db.query<T>(query, params)).rows,
    },
  ) as Sql;
  const original = new Uint8Array([255, 216, 255, 5, 6, 7]);
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", original)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  await db.exec(
    `INSERT INTO catalog_galleries(id,title,published,visibility,download_policy) VALUES('gallery','Fixture',true,'public','purchased_only')`,
  );
  await db.query(
    `INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) VALUES('photo','gallery','owner',$1,'image/jpeg',$2,$3,'private/original.jpg','ready')`,
    ['Photo "one".jpg', original.length, checksum],
  );
  const commerce = createCommerce(sql, async () => 1);
  await commerce.configurePriceList({ id: "default", name: "Default", isDefault: true });
  await commerce.configureProduct({
    id: "digital",
    name: "Digital",
    license: "Personal",
    active: true,
  });
  await commerce.configurePrice({ priceListId: "default", productId: "digital", unitCents: 2500 });
  const q = await commerce.quote("customer", {
    galleryId: "gallery",
    items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
  });
  const order = await commerce.orderForQuote("customer", q.id);
  await commerce.bindProviderSession(order.id, "cs_test_fixture");
  const event = {
    eventId: "evt_paid",
    orderId: order.id,
    kind: "paid" as const,
    sessionId: "cs_test_fixture",
    paymentId: "pi_fixture",
    amountCents: 2500,
    currency: "usd" as const,
  };
  let customer = "customer";
  let allowGallery = true;
  let reads = 0;
  let grantHash: string | null = null;
  let readHook: () => Promise<Uint8Array> = async () => original;
  const deps: CustomerDownloadDependencies = {
    sql,
    user: async () => {
      if (!customer) throw new CustomerDownloadError("Sign in", 401);
      return customer;
    },
    authorizeGallery: async () => {
      if (!allowGallery) throw new CustomerDownloadError("Gallery password required", 401);
      return 1;
    },
    readOriginal: async () => {
      reads++;
      return readHook();
    },
    galleryGrantHash: async () => grantHash,
  };
  const handler = createCustomerDownloadHandler(true, deps);
  const request = (body: unknown, origin = "https://example.test", query = "") =>
    new Request(`https://example.test/api/commerce-download${query}`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const send = (body: unknown) => handler(request(body));
  const paid = () => commerce.applyVerifiedPayment(event);
  const issue = async () => {
    const response = await send({ op: "issue", entitlementId: `${order.id}:photo` });
    assert.equal(response.status, 200);
    return (await response.json()).token as string;
  };
  const attempts = async () =>
    (await db.query<{ downloads: number }>(`SELECT downloads FROM commerce_entitlements`)).rows[0]
      ?.downloads || 0;
  return {
    db,
    sql,
    original,
    commerce,
    order,
    event,
    deps,
    handler,
    request,
    send,
    paid,
    issue,
    attempts,
    reads: () => reads,
    setCustomer: (value: string) => {
      customer = value;
    },
    denyGallery: () => {
      allowGallery = false;
    },
    setRead: (fn: () => Promise<Uint8Array>) => {
      readHook = fn;
    },
    setGrantHash: (value: string | null) => {
      grantHash = value;
    },
  };
}

test("download feature defaults closed; auth, origin, body, method and query boundaries hold", async () => {
  const f = await fixture();
  try {
    assert.equal(
      customerDownloadsEnabled(() => ""),
      false,
    );
    const settings: Record<string, string> = {
      CATALOG_ENV: "staging",
      CATALOG_CUSTOMER_DOWNLOADS_ENABLED: "true",
      CATALOG_STRIPE_SANDBOX_ACCEPTED: "true",
    };
    assert.equal(
      customerDownloadsEnabled((name) => settings[name] || ""),
      true,
    );
    assert.equal(
      customerDownloadsEnabled((name) =>
        name === "CATALOG_ENV" ? "production" : settings[name] || "",
      ),
      false,
    );
    assert.equal(
      (
        await createCustomerDownloadHandler(
          false,
          f.deps,
        )(f.request({ op: "list", galleryId: "gallery" }))
      ).status,
      503,
    );
    assert.equal(
      (await f.handler(new Request("https://example.test/api/commerce-download"))).status,
      405,
    );
    assert.equal(
      (await f.handler(f.request({ op: "list", galleryId: "gallery" }, "https://evil.test")))
        .status,
      403,
    );
    assert.equal(
      (
        await f.handler(
          f.request({ op: "list", galleryId: "gallery" }, "https://example.test", "?token=secret"),
        )
      ).status,
      400,
    );
    assert.equal((await f.send({ data: "x".repeat(5000) })).status, 413);
    f.setCustomer("");
    assert.equal((await f.send({ op: "list", galleryId: "gallery" })).status, 401);
    assert.equal(f.reads(), 0);
  } finally {
    await f.db.close();
  }
});

test("paid customer gets exact original attachment with no object key or token URL", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.send({ op: "issue", entitlementId: `${f.order.id}:photo` })).status, 404);
    await f.paid();
    const list = await f.send({ op: "list", galleryId: "gallery" });
    const data = await list.json();
    assert.equal(data.entitlements.length, 1);
    assert.equal(JSON.stringify(data).includes("original_key"), false);
    const token = await f.issue();
    assert.match(token, /^[0-9a-f]{64}$/);
    const response = await f.send({ op: "deliver", token });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
    assert.match(response.headers.get("Content-Disposition") || "", /^attachment;/);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Content-Disposition")?.includes(token), false);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.original);
    assert.equal(await f.attempts(), 1);
    await f.db.query(`UPDATE catalog_photos SET filename=$1`, ["a".repeat(179) + "😀.jpg"]);
    const unicode = await f.send({ op: "deliver", token });
    assert.equal(unicode.status, 200);
    assert.match(unicode.headers.get("Content-Disposition") || "", /%F0%9F%98%80/);
    assert.deepEqual(new Uint8Array(await unicode.arrayBuffer()), f.original);
    assert.equal(await f.attempts(), 2);
  } finally {
    await f.db.close();
  }
});

test("customer, current gallery policy/access, visibility, expiry, rotation and use cap fail closed", async () => {
  const f = await fixture();
  try {
    await f.paid();
    const token = await f.issue();
    f.setCustomer("other");
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    f.setCustomer("customer");
    for (const statement of [
      `UPDATE catalog_galleries SET download_policy='none'`,
      `UPDATE catalog_photos SET hidden=true`,
      `UPDATE catalog_photos SET archived=true`,
      `UPDATE catalog_photos SET status='processing'`,
      `UPDATE commerce_entitlements SET expires_at=now()-interval '1 second'`,
      `UPDATE commerce_entitlements SET downloads=10`,
    ]) {
      await f.db.exec(statement);
      assert.equal((await f.send({ op: "deliver", token })).status, 404);
      await f.db.exec(
        `UPDATE catalog_galleries SET download_policy='purchased_only'; UPDATE catalog_photos SET hidden=false,archived=false,status='ready'; UPDATE commerce_entitlements SET downloads=0,expires_at=now()+interval '1 day'`,
      );
    }
    const replacement = await f.issue();
    assert.notEqual(token, replacement);
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    f.denyGallery();
    assert.equal((await f.send({ op: "deliver", token: replacement })).status, 401);
    assert.equal(f.reads(), 0);
  } finally {
    await f.db.close();
  }
});

test("missing/corrupt original consumes no attempt; policy or visibility change during read prevents delivery", async () => {
  const f = await fixture();
  try {
    await f.paid();
    const token = await f.issue();
    f.setRead(async () => {
      throw new Error("Object missing");
    });
    assert.equal((await f.send({ op: "deliver", token })).status, 503);
    assert.equal(await f.attempts(), 0);
    f.setRead(async () => new Uint8Array([0, 0, 0, 0, 0, 0]));
    assert.equal((await f.send({ op: "deliver", token })).status, 503);
    assert.equal(await f.attempts(), 0);
    for (const change of [
      `UPDATE catalog_galleries SET revision=revision+1`,
      `UPDATE catalog_galleries SET download_policy='none'`,
      `UPDATE catalog_photos SET hidden=true`,
    ]) {
      f.setRead(async () => {
        await f.db.exec(change);
        return f.original;
      });
      assert.equal((await f.send({ op: "deliver", token })).status, 404);
      assert.equal(await f.attempts(), 0);
      await f.db.exec(
        `UPDATE catalog_galleries SET revision=1,download_policy='purchased_only';UPDATE catalog_photos SET hidden=false`,
      );
    }
    f.setRead(async () => {
      await f.commerce.applyVerifiedPayment({
        ...f.event,
        eventId: "evt_refund",
        kind: "refunded",
      });
      return f.original;
    });
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    assert.equal(await f.attempts(), 0);
  } finally {
    await f.db.close();
  }
});

test("final authorization binds password grant expiry/version and the exact gallery scope", async () => {
  const f = await fixture();
  try {
    await f.paid();
    const token = await f.issue();
    await f.db.exec(
      `UPDATE catalog_galleries SET password_hash='test-hash';INSERT INTO catalog_access_grants(token_hash,gallery_id,access_version,expires_at) VALUES('grant','gallery',1,now()+interval '1 hour')`,
    );
    f.setGrantHash("grant");
    f.setRead(async () => {
      await f.db.exec(`UPDATE catalog_access_grants SET expires_at=now()-interval '1 second'`);
      return f.original;
    });
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    assert.equal(await f.attempts(), 0);
    await f.db.exec(
      `UPDATE catalog_access_grants SET expires_at=now()+interval '1 hour',access_version=2`,
    );
    f.setRead(async () => f.original);
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    assert.equal(await f.attempts(), 0);
    await f.db.exec(`UPDATE catalog_access_grants SET access_version=1`);
    assert.equal((await f.send({ op: "deliver", token })).status, 200);
    await f.db.exec(
      `INSERT INTO catalog_galleries(id,title,published,visibility,download_policy,revision) VALUES('othergallery','Other',true,'public','purchased_only',1)`,
    );
    f.setRead(async () => {
      await f.db.exec(`UPDATE catalog_photos SET gallery_id='othergallery'`);
      return f.original;
    });
    assert.equal((await f.send({ op: "deliver", token })).status, 404);
    assert.equal(await f.attempts(), 1);
  } finally {
    await f.db.close();
  }
});

test("concurrent last download has one winner; missing0013 never emits original bytes", async () => {
  const f = await fixture();
  try {
    await f.paid();
    const token = await f.issue();
    await f.db.exec(`UPDATE commerce_entitlements SET downloads=9`);
    const responses = await Promise.all([
      f.send({ op: "deliver", token }),
      f.send({ op: "deliver", token }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 404]);
    assert.equal(await f.attempts(), 10);
  } finally {
    await f.db.close();
  }
  const missing = await fixture(false);
  try {
    await missing.paid();
    const token = await missing.issue();
    const response = await missing.send({ op: "deliver", token });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Content-Disposition"), null);
    assert.equal(await missing.attempts(), 0);
  } finally {
    await missing.db.close();
  }
});
