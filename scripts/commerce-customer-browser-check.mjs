import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

// Real local HTTP + Better Auth + PGlite + download authorization/integrity path.
// Only R2 bytes and provider transition inputs are synthetic. Not Stripe acceptance.
for (const name of [
  "DATABASE_URL",
  "HYPERDRIVE",
  "CLOUDFLARE_ENV",
  "STRIPE_SECRET_KEY",
  "CATALOG_STRIPE_SECRET_KEY",
])
  if (process.env[name]) throw new Error(`Remove remote configuration ${name} before local test`);
const origin = "http://localhost:8094";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "local-commerce-browser-fixture-not-provider-secret";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "synthetic-owner-only";
process.env.CATALOG_ENV = "staging";
process.env.CATALOG_CUSTOMER_DOWNLOADS_ENABLED = "true";
process.env.CATALOG_STRIPE_SANDBOX_ACCEPTED = "true";
const original = new Uint8Array([255, 216, 255, 5, 6, 7]);
globalThis.__commerceBrowserBucket = {
  async get(key) {
    assert.equal(key, "synthetic-private-original");
    return {
      size: original.length,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(original);
          controller.close();
        },
      }),
    };
  },
};
const server = await createServer({
  server: { host: "127.0.0.1", port: 8094, strictPort: true },
  logLevel: "error",
  plugins: [
    {
      name: "local-commerce-fixture-bucket",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/src/lib/node-worker-env.ts"))
          return `export const env = new Proxy(process.env, { get(target,key) { return key === 'CATALOG_BUCKET' ? globalThis.__commerceBrowserBucket : target[key]; } });`;
      },
    },
  ],
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(Boolean(runtime.databaseConnectionString()), false);
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const { createCommerce } = await server.ssrLoadModule("/src/lib/catalog-commerce/service.ts");
  const sql = await getSql();
  const galleryId = randomUUID(),
    photoId = randomUUID();
  await sql.query(
    "insert into catalog_galleries(id,title,published,visibility,download_policy) values($1,'SYNTHETIC COMMERCE FIXTURE',true,'public','purchased_only')",
    [galleryId],
  );
  await sql.query(
    "insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height) values($1,$2,'fixture-owner','synthetic-purchase.jpg','image/jpeg',$3,$4,'synthetic-private-original','ready',600,400)",
    [photoId, galleryId, original.length, createHash("sha256").update(original).digest("hex")],
  );
  for (const kind of ["thumb", "preview"])
    await sql.query(
      "insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum) values($1,$2,$3,6,'fixture')",
      [photoId, kind, `synthetic-${kind}`],
    );
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const customer = await browser.newContext({ acceptDownloads: true }),
    other = await browser.newContext(),
    anonymous = await browser.newContext();
  async function signup(context) {
    const response = await context.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { Origin: origin },
      data: {
        email: `${randomUUID()}@example.invalid`,
        password: randomUUID() + randomUUID(),
        name: "Synthetic customer",
      },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).user.id;
  }
  const customerId = await signup(customer);
  await signup(other);
  const commerce = createCommerce(sql, async () => 1);
  await commerce.configureProduct({
    id: "fixture-digital",
    name: "Personal digital original",
    license: "Synthetic personal-use fixture",
    active: true,
  });
  await commerce.configurePriceList({ id: "fixture-default", name: "Fixture", isDefault: true });
  await commerce.configurePrice({
    priceListId: "fixture-default",
    productId: "fixture-digital",
    unitCents: 2500,
  });
  const quote = await commerce.quote(customerId, {
    galleryId,
    items: [{ productId: "fixture-digital", photoId, quantity: 1 }],
  });
  const order = await commerce.orderForQuote(customerId, quote.id);
  await commerce.bindProviderSession(order.id, "cs_test_browser_fixture");
  const event = {
    eventId: "evt_browser_paid",
    orderId: order.id,
    kind: "paid",
    sessionId: "cs_test_browser_fixture",
    paymentId: "pi_browser_fixture",
    amountCents: 2500,
    currency: "usd",
  };
  assert.equal((await anonymous.request.get(`${origin}/api/commerce?op=orders`)).status(), 401);
  const otherOrders = await other.request.get(`${origin}/api/commerce?op=orders`);
  assert.equal(otherOrders.status(), 200);
  assert.equal((await otherOrders.json()).data.length, 0);
  const denied = await other.request.get(`${origin}/api/commerce?op=order&id=${order.id}`);
  assert.notEqual(denied.status(), 200, "Other account cannot read order detail");
  const page = await customer.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/purchases`);
  await page.getByRole("heading", { name: "Your purchases", exact: true }).waitFor();
  await page.getByText(`Order ${order.id}`, { exact: true }).click();
  await page.getByRole("heading", { name: "pending", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Download original", exact: true }).count(),
    0,
  );
  await page.goto(`${origin}/checkout/cancel?orderId=${order.id}`);
  await page.getByRole("heading", { name: "Checkout closed", exact: true }).waitFor();
  await page.getByRole("heading", { name: "pending", exact: true }).waitFor();
  assert.equal(
    (await sql.query("select status from commerce_orders where id=$1", [order.id]))[0].status,
    "pending",
  );
  await page.goto(`${origin}/checkout/complete?orderId=${order.id}`);
  await page.getByRole("heading", { name: "pending", exact: true }).waitFor();
  await commerce.applyVerifiedPayment(event);
  await page.getByRole("heading", { name: "paid", exact: true }).waitFor({ timeout: 15000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "synthetic-purchase.jpg");
  assert.deepEqual(new Uint8Array(await readFile(await download.path())), original);
  const [entitlement] = await sql.query(
    "select id,downloads from commerce_entitlements where order_id=$1",
    [order.id],
  );
  assert.equal(entitlement.downloads, 1);
  const stolen = await other.request.post(`${origin}/api/commerce-download`, {
    headers: { Origin: origin },
    data: { op: "issue", entitlementId: entitlement.id },
  });
  assert.notEqual(stolen.status(), 200, "Other account cannot issue token");
  await commerce.applyVerifiedPayment({
    ...event,
    eventId: "evt_browser_refund",
    kind: "refunded",
  });
  await page.getByRole("button", { name: "Refresh order status", exact: true }).click();
  await page.getByRole("heading", { name: "refunded", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Download original", exact: true }).count(),
    0,
  );
  const revoked = await customer.request.post(`${origin}/api/commerce-download`, {
    headers: { Origin: origin },
    data: { op: "issue", entitlementId: entitlement.id },
  });
  assert.notEqual(revoked.status(), 200, "Refund revokes future download authorization");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local auth/order isolation, history/detail, bounded pending polling to paid, cancellation does not mutate payment, actual UI synthetic-byte download through integrity/authorization, attempt counting, other-account token denial, and refund UI/server revocation. Provider event inputs and R2 binding are fixtures, NOT Stripe/R2 live acceptance.",
  );
} finally {
  await browser?.close();
  await server.close();
  delete globalThis.__commerceBrowserBucket;
}
