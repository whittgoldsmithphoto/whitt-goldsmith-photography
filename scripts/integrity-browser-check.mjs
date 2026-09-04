import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";

// Real local owner/customer/auth/database and mounted panel. Integrity response
// and displayed media are network fixtures, not an R2/provider acceptance test.
if (process.env.DATABASE_URL || process.env.HYPERDRIVE || process.env.CLOUDFLARE_ENV)
  throw new Error("Run without remote configuration");
const origin = "http://localhost:8095";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "not-registered";
const server = await createServer({
  server: { host: "127.0.0.1", port: 8095, strictPort: true },
  logLevel: "error",
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(Boolean(runtime.databaseConnectionString()), false);
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await getSql();
  const galleryId = randomUUID(),
    photoIds = [randomUUID(), randomUUID()];
  await sql`insert into catalog_galleries(id,title) values(${galleryId},'SYNTHETIC INTEGRITY TEST')`;
  for (let i = 0; i < photoIds.length; i++) {
    const id = photoIds[i];
    await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
      values(${id},${galleryId},'fixture-owner',${`integrity-${i}.jpg`},'image/jpeg',6,${(i ? "b" : "a").repeat(64)},${`catalog/originals/${id}`},'ready',100,100)`;
    for (const kind of ["thumb", "preview"])
      await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum) values(${id},${kind},${`${id}-${kind}`},5,'synthetic')`;
  }
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext(),
    customer = await browser.newContext(),
    anon = await browser.newContext();
  for (const [name, context] of [
    ["Owner", owner],
    ["Customer", customer],
  ]) {
    const result = await context.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { Origin: origin },
      data: {
        email: `integrity-${randomUUID()}@example.invalid`,
        password: randomUUID() + randomUUID(),
        name,
      },
    });
    assert.equal(result.status(), 200);
    if (name === "Owner") process.env.OWNER_USER_IDS = (await result.json()).user.id;
  }
  for (const [context, status] of [
    [anon, 401],
    [customer, 403],
    [owner, 503],
  ]) {
    const response = await context.request.post(`${origin}/api/catalog-integrity`, {
      headers: { Origin: origin },
      data: { photoId: photoIds[0] },
    });
    assert.equal(response.status(), status, "Actual HTTP auth/default missing local binding");
  }
  const page = await owner.newPage(),
    errors = [],
    requested = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key"))
      errors.push(message.text());
  });
  await page.route("**/api/catalog?op=media&**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#444"/></svg>',
    }),
  );
  let mode = "verified",
    release,
    started;
  await page.route("**/api/catalog-integrity", async (route) => {
    const photoId = route.request().postDataJSON().photoId;
    requested.push(photoId);
    const current = mode;
    if (current === "delayed") {
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      started();
      await wait;
    }
    if (current === "unavailable")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Fixture storage unavailable. No files changed." }),
      });
    if (current === "network-error") return route.abort("failed");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        photoId,
        status: current === "delayed" ? "verified" : current,
        checkedAt: new Date().toISOString(),
        expectedBytes: 6,
        message: "Explicit synthetic integrity response.",
      }),
    });
  });
  await page.goto(`${origin}/organize`);
  await page.getByRole("button", { name: /SYNTHETIC INTEGRITY TEST/ }).click();
  const selectPhoto = (index) =>
    page.getByRole("button", { name: new RegExp(`integrity-${index}.jpg.*Edit`) }).click();
  await selectPhoto(0);
  const panel = page.getByRole("region", { name: "Original integrity check" });
  const check = () =>
    panel.getByRole("button", { name: "Check original integrity", exact: true }).click();
  mode = "delayed";
  const firstStarted = new Promise((resolve) => {
    started = resolve;
  });
  await check();
  await firstStarted;
  assert.equal(
    await panel.getByRole("button", { name: "Checking original…", exact: true }).isDisabled(),
    true,
  );
  release();
  await panel.getByText(/^VERIFIED:/).waitFor();
  for (const state of ["missing", "mismatch"]) {
    mode = state;
    await check();
    await panel.getByText(new RegExp(`^${state.toUpperCase()}:`)).waitFor();
    assert.equal(await panel.getByText(/^VERIFIED:/).count(), 0);
  }
  mode = "unavailable";
  await check();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByText(/^VERIFIED:/).count(), 0);
  mode = "network-error";
  await check();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByText(/^VERIFIED:/).count(), 0);
  mode = "verified";
  await check();
  await panel.getByText(/^VERIFIED:/).waitFor();
  assert.equal(await panel.getByRole("alert").count(), 0);
  // Switch photo while a request is in flight; the old response must never label
  // the newly selected original as verified.
  mode = "delayed";
  const oldStarted = new Promise((resolve) => {
    started = resolve;
  });
  await check();
  await oldStarted;
  await selectPhoto(1);
  assert.equal(await panel.getByRole("status").count(), 0);
  release();
  await page.waitForResponse((response) => response.url().endsWith("/api/catalog-integrity"));
  await page.waitForLoadState("networkidle");
  assert.equal(await panel.getByRole("status").count(), 0);
  mode = "verified";
  await check();
  await panel.getByText(/^VERIFIED:/).waitFor();
  assert.equal(requested.at(-1), photoIds[1]);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local owner/customer/anonymous integrity API auth and missing-binding failure; mounted panel checking/verified/missing/mismatch/provider-error/network-error/retry states; late response cannot verify another selected photo; 375/768/1440 layouts. Integrity/media responses are explicit network fixtures, not live R2 verification.",
  );
} finally {
  await browser?.close();
  await server.close();
}
