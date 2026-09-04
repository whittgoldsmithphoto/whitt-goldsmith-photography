import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";

// Real local owner auth/catalog reservation/database/UI. Transfer completion and
// image processing are explicitly simulated; this is not an R2/Images test.
if (process.env.DATABASE_URL || process.env.HYPERDRIVE || process.env.CLOUDFLARE_ENV)
  throw new Error("Run without remote database/environment configuration");
const origin = "http://localhost:8094";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "not-registered-yet";
const server = await createServer({
  server: { host: "127.0.0.1", port: 8094, strictPort: true },
  logLevel: "error",
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(Boolean(runtime.databaseConnectionString()), false);
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await getSql();
  const galleryId = randomUUID();
  await sql`insert into catalog_galleries(id,title) values(${galleryId},'SYNTHETIC BATCH TEST')`;
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const signup = await context.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: {
      email: `batch-${randomUUID()}@example.invalid`,
      password: randomUUID() + randomUUID(),
      name: "Synthetic batch owner",
    },
  });
  assert.equal(signup.status(), 200);
  process.env.OWNER_USER_IDS = (await signup.json()).user.id;
  const page = await context.newPage(),
    reservations = [],
    transfers = [],
    errors = [];
  let releaseSlow, notifySlow;
  const slowStarted = new Promise((resolve) => {
    notifySlow = resolve;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/catalog?op=reserve"))
      reservations.push(request.postDataJSON().filename);
  });
  await page.route("**/api/catalog?op=media&**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#444"/></svg>',
    }),
  );
  await page.route("**/api/catalog?op=upload&**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    const [photo] = await sql`select filename, bytes from catalog_photos where id=${id}`;
    assert.ok(photo, "Upload requires a real server reservation");
    assert.equal(route.request().postDataBuffer().length, photo.bytes);
    transfers.push(photo.filename);
    if (photo.filename === "slow-first.jpg") {
      const released = new Promise((resolve) => {
        releaseSlow = resolve;
      });
      notifySlow();
      await released;
    }
    // Simulate the provider storing the object and processor completing. No real photo bytes are stored.
    await sql`update catalog_photos set status='ready',width=100,height=100 where id=${id}`;
    for (const kind of ["thumb", "preview"])
      await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
      values(${id},${kind},${`${id}-${kind}`},5,'synthetic') on conflict(photo_id,kind) do nothing`;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(photo.filename === "uncertain.jpg" ? {} : { status: "ready" }),
    });
  });
  await page.goto(`${origin}/organize`);
  await page.getByRole("button", { name: /SYNTHETIC BATCH TEST/ }).click();
  const input = page.locator('input[type="file"]');
  const jpeg = (name, value) => ({
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from([255, 216, 255, value]),
  });
  const batch = page.getByRole("region", { name: "Current upload batch" });
  await input.setInputFiles([
    { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    jpeg("original camera name.jpg", 1),
  ]);
  await batch.getByText("original camera name.jpg — ready", { exact: true }).waitFor();
  await batch.getByText("bad.txt — failed", { exact: false }).waitFor();
  assert.deepEqual(transfers, ["original camera name.jpg"]);
  assert.deepEqual(reservations, ["original camera name.jpg"]);
  const [record] = await sql`select filename from catalog_photos where gallery_id=${galleryId}`;
  assert.equal(record.filename, "original camera name.jpg");
  await input.setInputFiles([jpeg("original camera name.jpg", 1)]);
  await batch.getByText("original camera name.jpg — duplicate", { exact: true }).waitFor();
  assert.deepEqual(transfers, ["original camera name.jpg"], "Duplicate must not retransmit bytes");
  await input.setInputFiles([jpeg("uncertain.jpg", 2), jpeg("healthy.jpg", 3)]);
  await batch.getByText("healthy.jpg — ready", { exact: true }).waitFor();
  await batch
    .getByText("Upload completion was not confirmed. Retry this file to check its saved state.", {
      exact: true,
    })
    .waitFor();
  assert.equal(reservations.filter((name) => name === "healthy.jpg").length, 1);
  await batch.getByRole("button", { name: "Retry failed or unstarted files", exact: true }).click();
  await batch.getByText("uncertain.jpg — duplicate", { exact: true }).waitFor();
  assert.equal(reservations.filter((name) => name === "uncertain.jpg").length, 2);
  assert.equal(transfers.filter((name) => name === "uncertain.jpg").length, 1);
  assert.equal(
    reservations.filter((name) => name === "healthy.jpg").length,
    1,
    "Retry only failed files",
  );
  await input.setInputFiles([jpeg("slow-first.jpg", 4), jpeg("unstarted-second.jpg", 5)]);
  await slowStarted;
  await batch.getByRole("button", { name: "Stop after current file", exact: true }).click();
  await batch.getByText(/Stopping after the current file/).waitFor();
  releaseSlow();
  await batch.getByText("slow-first.jpg — ready", { exact: true }).waitFor();
  await batch.getByText("unstarted-second.jpg — cancelled", { exact: true }).waitFor();
  assert.equal(reservations.includes("unstarted-second.jpg"), false);
  await batch.getByRole("button", { name: "Retry failed or unstarted files", exact: true }).click();
  await batch.getByText("unstarted-second.jpg — ready", { exact: true }).waitFor();
  assert.equal(transfers.filter((name) => name === "slow-first.jpg").length, 1);
  assert.equal(transfers.filter((name) => name === "unstarted-second.jpg").length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local owner authentication/catalog reservations and mounted batch UI; invalid file does not stop good file, duplicate never transfers again, original filename preserved, unconfirmed completion fails then safely re-reserves, retry selects failed/unstarted only, stop waits for current file then skips remaining files. Upload completion/image processing explicitly simulated; not live-provider acceptance.",
  );
} finally {
  await browser?.close();
  await server.close();
}
