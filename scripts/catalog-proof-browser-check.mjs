import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";
import { chromium } from "playwright";

// Explicit local integration harness. Real app HTTP routes, real local Better Auth,
// real shared PGlite SQL; only image processing/storage and displayed bytes are fixtures.
// No provider credentials, remote DB, deployed accounts or production photos are used.
if (process.env.DATABASE_URL || process.env.HYPERDRIVE || process.env.CLOUDFLARE_ENV)
  throw new Error("Run this harness without remote database/environment configuration");
const origin = "http://localhost:8092";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "fixture-owner-before-registration";
const server = await createServer({
  server: { host: "127.0.0.1", port: 8092, strictPort: true },
  logLevel: "error",
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(Boolean(runtime.databaseConnectionString()), false, "Only local PGlite is allowed");
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const { createCatalog, digest } = await server.ssrLoadModule("/src/lib/catalog/repository.ts");
  const objects = new Map();
  const bytes = new Uint8Array([255, 216, 255, 1, 2, 3]);
  const catalog = createCatalog(await getSql(), {
    get: async (key) => objects.get(key),
    putOriginal: async (key, value) => {
      objects.set(key, value);
    },
    putDerivative: async (key, value) => {
      objects.set(key, value);
    },
    process: async () => ({ width: 600, height: 400, preview: bytes, thumb: bytes }),
  });
  let gallery = await catalog.saveGallery(
    {
      title: "SYNTHETIC LOCAL PROOF TEST",
      description: "Not portfolio content",
      category: "Test",
      folderId: null,
      visibility: "private",
      published: false,
    },
    "fixture-owner",
  );
  const reservation = await catalog.reserve(
    {
      galleryId: gallery.id,
      filename: "synthetic.jpg",
      mime: "image/jpeg",
      bytes: bytes.length,
      checksum: await digest(bytes),
    },
    "fixture-owner",
  );
  await catalog.upload(reservation.id, bytes, "fixture-owner");
  gallery = await catalog.saveGallery(
    {
      id: gallery.id,
      revision: gallery.revision,
      title: gallery.title,
      description: gallery.description,
      category: gallery.category,
      folderId: null,
      visibility: "public",
      published: true,
    },
    "fixture-owner",
  );
  await server.listen();
  const invariant = await promisify(execFile)(process.execPath, [
    "scripts/check-auth-invariant.mjs",
    "--dev-url",
    origin,
  ]);
  assert.match(invariant.stdout, /dev and build agree: sign-in on/);
  browser = await chromium.launch({ headless: true });
  const customer = await browser.newContext();
  const second = await browser.newContext();
  const owner = await browser.newContext();
  const anonymous = await browser.newContext();
  const email = `proof-${randomUUID()}@example.invalid`,
    password = randomUUID() + randomUUID();
  const signup = await customer.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { email, password, name: "Test customer" },
  });
  assert.equal(signup.status(), 200, "Customer registration");
  const signin = await second.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { Origin: origin },
    data: { email, password },
  });
  assert.equal(signin.status(), 200, "Second-device customer session");
  const ownerSignup = await owner.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: {
      email: `owner-${randomUUID()}@example.invalid`,
      password: randomUUID() + randomUUID(),
      name: "Test owner",
    },
  });
  assert.equal(ownerSignup.status(), 200);
  process.env.OWNER_USER_IDS = (await ownerSignup.json()).user.id;
  const diagnostics = await owner.request.get(`${origin}/api/catalog?op=diagnostics`);
  assert.equal(diagnostics.status(), 200);
  const readiness = await diagnostics.json();
  assert.equal(readiness.database, "ephemeral-local-pglite");
  assert.equal(readiness.verification, "configuration-only");
  assert.deepEqual(readiness.missingMigrations, []);
  assert.equal((await anonymous.request.get(`${origin}/api/catalog?op=diagnostics`)).status(), 401);
  assert.equal((await customer.request.get(`${origin}/api/catalog?op=owner-proofs`)).status(), 403);
  assert.equal(
    (await anonymous.request.get(`${origin}/api/catalog?op=proof&id=${gallery.id}`)).status(),
    401,
  );
  assert.equal(
    (
      await customer.request.post(`${origin}/api/catalog?op=proof`, {
        headers: { Origin: "https://elsewhere.invalid" },
        data: {},
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await anonymous.request.get(
        `${origin}/api/catalog?op=media&id=${reservation.id}&kind=original`,
      )
    ).status(),
    404,
  );
  const pages = [];
  const errors = [];
  for (const context of [customer, second, owner]) {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/catalog?op=media&**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#444"/><text x="100" y="200" fill="white">SYNTHETIC TEST</text></svg>',
      }),
    );
    pages.push(page);
  }
  const [firstPage, secondPage, ownerPage] = pages;
  await firstPage.goto(`${origin}/checkout`);
  await firstPage.getByRole("heading", { name: "Checkout is not available yet" }).waitFor();
  assert.equal(await firstPage.getByRole("button", { name: "Pay with card" }).count(), 0);
  await firstPage.goto(`${origin}/galleries/${gallery.id}`);
  await firstPage.getByRole("button", { name: "Select favorite", exact: true }).click();
  await firstPage.getByLabel("Note to Whitt").fill("Please review this frame.");
  await firstPage.getByRole("button", { name: "Save selection", exact: true }).click();
  await firstPage
    .getByText("Saved to your account and sent to the owner’s proof inbox.", { exact: true })
    .waitFor();
  await firstPage.reload();
  await firstPage.getByRole("button", { name: "Selected", exact: true }).waitFor();
  assert.equal(
    await firstPage.getByLabel("Note to Whitt").inputValue(),
    "Please review this frame.",
  );
  await secondPage.goto(`${origin}/galleries/${gallery.id}`);
  await secondPage.getByRole("button", { name: "Selected", exact: true }).waitFor();
  assert.equal(
    await secondPage.getByLabel("Note to Whitt").inputValue(),
    "Please review this frame.",
  );
  await ownerPage.goto(`${origin}/favorites`);
  await ownerPage.getByText("Please review this frame.", { exact: true }).waitFor();
  await ownerPage.getByRole("button", { name: "Mark this version reviewed", exact: true }).click();
  await ownerPage.getByRole("heading", { name: /SYNTHETIC LOCAL PROOF TEST · Reviewed/ }).waitFor();
  await firstPage.getByLabel("Note to Whitt").fill("Updated from the first device.");
  await firstPage.getByRole("button", { name: "Save selection", exact: true }).click();
  await firstPage
    .getByText("Saved to your account and sent to the owner’s proof inbox.", { exact: true })
    .waitFor();
  await secondPage.getByLabel("Note to Whitt").fill("Stale second-device draft");
  await secondPage.getByRole("button", { name: "Save selection", exact: true }).click();
  await secondPage.getByText(/Selection or gallery changed/).waitFor();
  assert.equal(
    await secondPage.getByLabel("Note to Whitt").inputValue(),
    "Stale second-device draft",
  );
  await ownerPage.getByRole("button", { name: "Refresh inbox", exact: true }).click();
  await ownerPage.getByText("Updated from the first device.", { exact: true }).waitFor();
  await ownerPage.getByRole("heading", { name: /New or updated/ }).waitFor();
  for (const width of [375, 768, 1440]) {
    await firstPage.setViewportSize({ width, height: 900 });
    assert.equal(
      await firstPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Gallery overflow at ${width}`,
    );
    await ownerPage.setViewportSize({ width, height: 900 });
    assert.equal(
      await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Inbox overflow at ${width}`,
    );
  }
  await firstPage.getByRole("button", { name: "Open synthetic.jpg", exact: true }).click();
  await firstPage
    .getByRole("dialog")
    .getByRole("button", { name: "Selected favorite", exact: true })
    .click();
  await firstPage.keyboard.press("Escape");
  await firstPage.getByRole("button", { name: "Select favorite", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local HTTP/auth/SQL proof persistence across two customer sessions and owner inbox; version review, stale-save retention, anonymous/CSRF/non-owner denial, lightbox favorites, 375/768/1440 layouts. Media is a synthetic fixture; not a live-provider test.",
  );
} finally {
  await browser?.close();
  await server.close();
}
