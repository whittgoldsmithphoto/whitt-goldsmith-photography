import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { createServer } from "vite";
import { chromium } from "playwright";

// Local real auth/database/HTTP/UI; synthetic payment event and private ZIP.
for (const name of [
  "DATABASE_URL",
  "HYPERDRIVE",
  "CLOUDFLARE_ENV",
  "STRIPE_SECRET_KEY",
  "CATALOG_STRIPE_SECRET_KEY",
])
  if (process.env[name]) throw new Error(`Remove remote configuration ${name}`);
const origin = "http://localhost:8095";
Object.assign(process.env, {
  VITE_AUTH_ENABLED: "true",
  BETTER_AUTH_SECRET: "local-album-browser-fixture-not-provider-secret",
  BETTER_AUTH_URL: origin,
  OWNER_USER_IDS: "fixture-owner",
  CATALOG_ENV: "staging",
  CATALOG_CUSTOMER_DOWNLOADS_ENABLED: "true",
  CATALOG_STRIPE_SANDBOX_ACCEPTED: "true",
  CATALOG_ALBUM_ZIP_ENABLED: "true",
});
const original = new Uint8Array([255, 216, 255, 5, 6, 7]);
const archive = zipSync({ "fixture.jpg": original });
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
let archiveKey;
globalThis.__albumBrowserBucket = {
  async get(key) {
    assert.equal(key, archiveKey);
    return {
      size: archive.length,
      etag: checksum(archive),
      body: new ReadableStream({
        start(c) {
          c.enqueue(archive);
          c.close();
        },
      }),
    };
  },
};
const server = await createServer({
  server: { host: "127.0.0.1", port: 8095, strictPort: true },
  logLevel: "error",
  plugins: [
    {
      name: "album-fixture-storage",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/src/lib/node-worker-env.ts"))
          return `export const env = new Proxy(process.env, { get(target,key) { return key === 'CATALOG_BUCKET' ? globalThis.__albumBrowserBucket : target[key]; } });`;
      },
    },
  ],
});
let browser;
try {
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const { createCommerce } = await server.ssrLoadModule("/src/lib/catalog-commerce/service.ts");
  const sql = await getSql();
  const gallery = randomUUID(),
    photo = randomUUID();
  await sql.query(
    "insert into catalog_galleries(id,title,published,visibility,download_policy) values($1,'Synthetic album',true,'public','purchased_only')",
    [gallery],
  );
  await sql.query(
    "insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) values($1,$2,'fixture-owner','fixture.jpg','image/jpeg',$3,$4,$5,'ready')",
    [photo, gallery, original.length, checksum(original), `catalog/originals/${photo}`],
  );
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: {
      email: `${randomUUID()}@example.invalid`,
      password: randomUUID() + randomUUID(),
      name: "Synthetic album buyer",
    },
  });
  assert.equal(signup.status(), 200);
  const buyer = (await signup.json()).user.id;
  const commerce = createCommerce(sql, async () => 1);
  await commerce.configureProduct({
    id: "fixture-album",
    name: "Album",
    kind: "gallery_download",
    license: "Perpetual use; no resale",
    active: true,
  });
  await commerce.configurePriceList({ id: "fixture-prices", name: "Fixture", isDefault: true });
  await commerce.configurePrice({
    priceListId: "fixture-prices",
    productId: "fixture-album",
    unitCents: 2995,
  });
  const quote = await commerce.quote(buyer, {
    galleryId: gallery,
    items: [{ productId: "fixture-album", photoId: photo, quantity: 1 }],
  });
  const order = await commerce.orderForQuote(buyer, quote.id);
  await commerce.bindProviderSession(order.id, "cs_test_album_browser");
  await commerce.applyVerifiedPayment({
    eventId: "evt_album_browser",
    orderId: order.id,
    kind: "paid",
    sessionId: "cs_test_album_browser",
    paymentId: "pi_album_browser",
    amountCents: 2995,
    currency: "usd",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${origin}/checkout/complete?orderId=${order.id}`);
  await page.getByRole("button", { name: "Prepare album ZIP", exact: true }).click();
  await page.getByRole("button", { name: "Album preparation requested", exact: true }).waitFor();
  const [job] = await sql.query("select id from commerce_archive_jobs where order_id=$1", [
    order.id,
  ]);
  assert.ok(job);
  archiveKey = `catalog/archives/${job.id}/${randomUUID()}.zip`;
  await sql.query(
    "update commerce_archive_jobs set status='completed',output_key=$2,output_checksum=$3,output_bytes=$4 where id=$1",
    [job.id, archiveKey, checksum(archive), archive.length],
  );
  const button = page.getByRole("button", { name: "Download album ZIP", exact: true });
  await button.waitFor();
  const downloadEvent = page.waitForEvent("download");
  await button.click();
  const download = await downloadEvent;
  assert.deepEqual(new Uint8Array(await readFile(await download.path())), archive);
  assert.equal(download.suggestedFilename(), `album-${job.id}.zip`);
  const [allowance] = await sql.query(
    "select downloads from commerce_entitlements where order_id=$1",
    [order.id],
  );
  assert.equal(allowance.downloads, 1);
  assert.equal(
    (
      await context.request.post(`${origin}/api/commerce-archive`, {
        headers: { Origin: "https://hostile.invalid" },
        form: { op: "deliver", jobId: job.id },
      })
    ).status(),
    403,
  );
  console.log(
    "PASS: real customer UI prepares an album and native form download returns exact ZIP bytes, consuming one allowance; cross-origin form denied. Synthetic local payment/storage only.",
  );
} finally {
  await browser?.close();
  await server.close();
}
