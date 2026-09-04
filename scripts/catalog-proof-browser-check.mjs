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
process.env.BETTER_AUTH_SECRET = "local-browser-test-only-not-a-provider-secret";
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
  assert.equal(
    (await (await customer.request.get(`${origin}/api/catalog?op=capabilities`)).json()).isOwner,
    false,
  );
  assert.equal(
    (await (await owner.request.get(`${origin}/api/catalog?op=capabilities`)).json()).isOwner,
    true,
  );
  await ownerPage.goto(`${origin}/settings`);
  await ownerPage.getByRole("heading", { name: "Legacy tools are disabled" }).waitFor();
  assert.equal(await ownerPage.getByRole("button", { name: "Empty the catalog" }).count(), 0);
  await firstPage.goto(`${origin}/checkout`);
  await firstPage.getByRole("heading", { name: "Checkout is not available yet" }).waitFor();
  assert.equal(await firstPage.getByRole("button", { name: "Pay with card" }).count(), 0);
  await firstPage.goto(`${origin}/galleries/${gallery.id}`);
  await firstPage.getByRole("button", { name: "Select favorite", exact: true }).click();
  assert.equal(
    await firstPage
      .getByRole("navigation")
      .getByRole("link", { name: "Organizer", exact: true })
      .count(),
    0,
  );
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
  assert.equal(
    (await anonymous.request.get(`${origin}/api/catalog?op=owner-proof-page`)).status(),
    401,
  );
  assert.equal(
    (await customer.request.get(`${origin}/api/catalog?op=owner-proof-page`)).status(),
    403,
  );
  assert.equal(
    (await owner.request.get(`${origin}/api/catalog?op=owner-proof-page&limit=9999`)).status(),
    400,
  );
  // Exercise pagination with real database records, not mocked inbox responses.
  const sql = await getSql();
  for (let i = 0; i < 24; i++)
    await sql`insert into catalog_proofs(id,gallery_id,customer_id,note)
    values(${randomUUID()},${gallery.id},${`inbox-fixture-${i}-${randomUUID()}`},${`Additional selection ${i}`})`;
  await ownerPage.getByRole("button", { name: "Refresh inbox", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Next page", exact: true }).waitFor();
  await ownerPage.getByRole("button", { name: "Next page", exact: true }).click();
  await ownerPage.getByText("Page 2", { exact: true }).waitFor();
  await ownerPage.getByText("Updated from the first device.", { exact: true }).waitFor();
  await ownerPage.getByRole("button", { name: "First page", exact: true }).click();
  await ownerPage
    .getByLabel("Search gallery, note, or reference")
    .fill("Updated from the first device.");
  await ownerPage.getByRole("button", { name: "Search", exact: true }).click();
  await ownerPage.getByText("Updated from the first device.", { exact: true }).waitFor();
  assert.equal(
    await ownerPage
      .getByRole("button", { name: "Mark this version reviewed", exact: true })
      .count(),
    1,
  );
  await ownerPage.getByLabel("Review status").selectOption("reviewed");
  await ownerPage.getByText(/No selections match this page/).waitFor();
  await ownerPage.getByLabel("Review status").selectOption("unreviewed");
  await ownerPage.getByText("Updated from the first device.", { exact: true }).waitFor();
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
  async function checkPreviewDeterrent(image) {
    assert.deepEqual(
      await image.evaluate((element) => {
        const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        element.dispatchEvent(context);
        const drag = new Event("dragstart", { bubbles: true, cancelable: true });
        element.dispatchEvent(drag);
        return {
          context: context.defaultPrevented,
          drag: drag.defaultPrevented,
          draggable: element.draggable,
          selection: getComputedStyle(element).userSelect,
        };
      }),
      { context: true, drag: true, draggable: false, selection: "none" },
    );
    await firstPage
      .getByText("Protected preview. Original downloads require permission.", { exact: true })
      .last()
      .waitFor();
  }
  await checkPreviewDeterrent(
    firstPage.getByRole("button", { name: "Open synthetic.jpg", exact: true }).locator("img"),
  );
  assert.equal(
    await firstPage
      .getByRole("button", { name: "Copy gallery link", exact: true })
      .evaluate((element) => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    false,
    "Non-photo controls keep normal context menus",
  );
  let simulatedPreviewFailure = false;
  await firstPage.route("**/api/catalog?op=media&**", async (route) => {
    if (route.request().url().includes("previewAttempt=0") && !simulatedPreviewFailure) {
      simulatedPreviewFailure = true;
      await route.abort("failed");
    } else await route.fallback();
  });
  await firstPage.getByRole("button", { name: "Open synthetic.jpg", exact: true }).click();
  await firstPage.getByRole("button", { name: "Retry preview", exact: true }).click();
  await firstPage.getByRole("button", { name: "Zoom preview", exact: true }).click();
  await firstPage.getByRole("button", { name: "Fit preview to screen", exact: true }).click();
  await checkPreviewDeterrent(firstPage.getByRole("dialog").locator("img"));
  await firstPage
    .getByRole("dialog")
    .getByRole("button", { name: "Selected favorite", exact: true })
    .click();
  await firstPage.keyboard.press("Escape");
  await firstPage.getByRole("button", { name: "Select favorite", exact: true }).waitFor();
  assert.equal(
    await firstPage
      .getByRole("button", { name: "Open synthetic.jpg", exact: true })
      .evaluate((element) => document.activeElement === element),
    true,
    "Lightbox restores focus to thumbnail",
  );
  await firstPage.getByRole("button", { name: "Open synthetic.jpg", exact: true }).click();
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) await firstPage.keyboard.press(key);
  await firstPage.getByRole("dialog").getByText("synthetic.jpg · 1/1", { exact: true }).waitFor();
  await firstPage.keyboard.press("Escape");
  const unloadBlocked = await firstPage.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(unloadBlocked, true, "Unsaved selection registers reload warning");
  let navigationWarning = false;
  firstPage.once("dialog", async (dialog) => {
    navigationWarning = dialog.message().includes("unsaved changes");
    await dialog.dismiss();
  });
  await firstPage.getByRole("link", { name: "All galleries", exact: true }).click();
  assert.equal(navigationWarning, true, "SPA navigation warns about unsaved changes");
  assert.equal(
    new URL(firstPage.url()).pathname,
    `/galleries/${gallery.id}`,
    "Cancel preserves current draft",
  );
  await ownerPage.goto(`${origin}/organize`);
  const manager = ownerPage.getByRole("region", { name: "Folder manager", exact: true });
  await manager.getByLabel("Folder title", { exact: true }).fill("Browser folder test");
  await manager.getByRole("button", { name: "Create folder", exact: true }).click();
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Browser folder test" });
  await manager.getByLabel("Folder title", { exact: true }).fill("Renamed browser folder");
  await manager.getByRole("button", { name: "Save folder changes", exact: true }).click();
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Renamed browser folder" });
  await ownerPage.reload();
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Renamed browser folder" });
  assert.equal(
    await manager.getByLabel("Folder title", { exact: true }).inputValue(),
    "Renamed browser folder",
  );
  await manager.getByLabel("Folder to edit", { exact: true }).selectOption("");
  await manager.getByLabel("Folder title", { exact: true }).fill("Browser Parent");
  await manager.getByRole("button", { name: "Create folder", exact: true }).click();
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Browser Parent" });
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Renamed browser folder" });
  await manager
    .getByLabel("Parent folder", { exact: true })
    .selectOption({ label: "Browser Parent" });
  await manager.getByRole("button", { name: "Save folder changes", exact: true }).click();
  await manager
    .getByLabel("Folder to edit", { exact: true })
    .selectOption({ label: "Browser Parent / Renamed browser folder" });
  const folderTree = await (await owner.request.get(`${origin}/api/catalog?op=folder-tree`)).json();
  assert.equal(
    folderTree.folders.find((folder) => folder.title === "Renamed browser folder").depth,
    2,
    "Browser move persisted nesting",
  );
  await ownerPage.getByRole("button", { name: /SYNTHETIC LOCAL PROOF TEST/ }).click();
  await ownerPage.getByRole("button", { name: "Gallery settings", exact: true }).click();
  await ownerPage
    .getByLabel("Instructions for customers", { exact: true })
    .fill("Select your favorites, then save a note for Whitt.");
  await ownerPage
    .getByLabel("Customer download policy", { exact: true })
    .selectOption("purchased_only");
  await ownerPage.setViewportSize({ width: 375, height: 900 });
  assert.equal(
    await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "Gallery policy editor fits mobile width",
  );
  await ownerPage.setViewportSize({ width: 1440, height: 900 });
  let failGalleryWrite = true;
  await ownerPage.route("**/api/catalog?op=gallery", async (route) => {
    if (failGalleryWrite) {
      failGalleryWrite = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic gallery save failure" }),
      });
    } else await route.fallback();
  });
  await ownerPage.getByRole("button", { name: "Save gallery", exact: true }).click();
  await ownerPage.getByText("Synthetic gallery save failure", { exact: true }).waitFor();
  assert.equal(
    await ownerPage.getByLabel("Instructions for customers", { exact: true }).inputValue(),
    "Select your favorites, then save a note for Whitt.",
    "Gallery save failure preserves draft instructions",
  );
  assert.equal(
    await ownerPage.getByLabel("Customer download policy", { exact: true }).inputValue(),
    "purchased_only",
    "Gallery save failure preserves draft policy",
  );
  await ownerPage.getByRole("button", { name: "Save gallery", exact: true }).click();
  await ownerPage
    .getByRole("heading", { name: "Edit gallery", exact: true })
    .waitFor({ state: "hidden" });
  const policyPage = await anonymous.newPage();
  await policyPage.goto(`${origin}/galleries/${gallery.id}`);
  await policyPage
    .getByText("Select your favorites, then save a note for Whitt.", { exact: true })
    .waitFor();
  await policyPage.getByText(/Download policy: purchased files only/).waitFor();
  assert.equal(
    await policyPage.getByRole("link", { name: /Download private original/ }).count(),
    0,
  );
  assert.equal(
    (
      await anonymous.request.get(
        `${origin}/api/catalog?op=media&id=${reservation.id}&kind=original`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await customer.request.post(`${origin}/api/catalog?op=gallery`, {
        headers: { Origin: origin },
        data: { downloadPolicy: "purchased_only" },
      })
    ).status(),
    403,
  );
  await ownerPage.getByRole("button", { name: "Gallery settings", exact: true }).click();
  assert.equal(
    await ownerPage.getByLabel("Customer download policy", { exact: true }).inputValue(),
    "purchased_only",
  );
  assert.equal(
    await ownerPage.getByLabel("Instructions for customers", { exact: true }).inputValue(),
    "Select your favorites, then save a note for Whitt.",
  );
  await ownerPage.getByLabel("Customer download policy", { exact: true }).selectOption("none");
  await ownerPage.getByRole("button", { name: "Save gallery", exact: true }).click();
  await ownerPage
    .getByRole("heading", { name: "Edit gallery", exact: true })
    .waitFor({ state: "hidden" });
  await policyPage.reload();
  await policyPage.getByText(/Download policy: no customer downloads/).waitFor();
  await policyPage.close();
  assert.equal((await anonymous.request.get(`${origin}/api/catalog?op=folder-tree`)).status(), 401);
  assert.equal((await customer.request.get(`${origin}/api/catalog?op=folder-tree`)).status(), 403);
  let failPricingRead = true;
  await ownerPage.route("**/api/commerce?op=owner", async (route) => {
    if (failPricingRead) {
      failPricingRead = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic pricing read failure" }),
      });
    } else await route.fallback();
  });
  await ownerPage.goto(`${origin}/sell`);
  await ownerPage.getByText("Synthetic pricing read failure", { exact: false }).waitFor();
  await ownerPage.getByRole("button", { name: "Retry loading", exact: true }).click();
  await ownerPage.getByText("No price lists have been saved.", { exact: true }).waitFor();
  const listForm = ownerPage.locator("form").filter({
    has: ownerPage.getByRole("heading", {
      name: "1. Create or update a price list",
      exact: true,
    }),
  });
  const listId = `browser-list-${"l".repeat(90)}`;
  await listForm.getByLabel("List ID", { exact: true }).fill(listId);
  await listForm.getByLabel("Name", { exact: true }).fill("Browser test price list");
  await listForm.getByLabel("Default for galleries without an override", { exact: true }).check();
  let failPricingWrite = true;
  await ownerPage.route("**/api/commerce?op=price-list", async (route) => {
    if (failPricingWrite) {
      failPricingWrite = false;
      await route.abort("failed");
    } else await route.fallback();
  });
  await listForm.getByRole("button", { name: "Save price list", exact: true }).click();
  await ownerPage.getByRole("alert").waitFor();
  assert.equal(
    await listForm.getByLabel("List ID", { exact: true }).inputValue(),
    listId,
    "Pricing save failure preserves draft ID",
  );
  assert.equal(
    await listForm.getByLabel("Name", { exact: true }).inputValue(),
    "Browser test price list",
    "Pricing save failure preserves draft name",
  );
  await listForm.getByRole("button", { name: "Save price list", exact: true }).click();
  await ownerPage.getByText(`ID: ${listId}`, { exact: true }).waitFor();
  const productForm = ownerPage.locator("form").filter({
    has: ownerPage.getByRole("heading", {
      name: "2. Create or update a digital product",
      exact: true,
    }),
  });
  const productId = `browser-product-${"p".repeat(90)}`;
  await productForm.getByLabel("Product ID", { exact: true }).fill(productId);
  await productForm.getByLabel("Name", { exact: true }).fill("Browser digital product");
  await productForm
    .getByLabel("License terms", { exact: true })
    .fill("Synthetic local test license; not a real offer.");
  await productForm.getByLabel("Available for quote previews", { exact: true }).check();
  await productForm.getByRole("button", { name: "Save product", exact: true }).click();
  await ownerPage
    .getByText(`${productId} · Browser digital product · quotable`, { exact: true })
    .waitFor();
  for (const width of [375, 768, 1440]) {
    await ownerPage.setViewportSize({ width, height: 900 });
    assert.equal(
      await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Selling overflow at ${width}`,
    );
  }
  const priceForm = ownerPage.locator("form").filter({
    has: ownerPage.getByRole("heading", { name: "3. Set a product price", exact: true }),
  });
  await priceForm.getByLabel("Price list", { exact: true }).selectOption(listId);
  await priceForm.getByLabel("Product", { exact: true }).selectOption(productId);
  await priceForm.getByLabel("Price in cents", { exact: true }).fill("2500");
  await priceForm.getByRole("button", { name: "Save price", exact: true }).click();
  await ownerPage.getByText("Browser digital product: $25.00", { exact: true }).waitFor();
  const quoteForm = ownerPage.locator("form").filter({
    has: ownerPage.getByRole("heading", { name: "Quote preview — no payment", exact: true }),
  });
  await quoteForm.getByLabel("Gallery ID", { exact: true }).fill(gallery.id);
  await quoteForm.getByLabel("Photo ID", { exact: true }).fill(reservation.id);
  await quoteForm.getByLabel("Product", { exact: true }).selectOption(productId);
  await quoteForm.getByRole("button", { name: "Preview server quote", exact: true }).click();
  await quoteForm.getByText("Pre-tax preview: $25.00 USD", { exact: true }).waitFor();
  const overrideForm = ownerPage.locator("form").filter({
    has: ownerPage.getByRole("heading", { name: "Gallery price override", exact: true }),
  });
  await overrideForm.getByLabel("Gallery ID", { exact: true }).fill(gallery.id);
  await overrideForm.getByLabel("Price list", { exact: true }).selectOption(listId);
  await overrideForm.getByRole("button", { name: "Save gallery pricing", exact: true }).click();
  const couponForm = ownerPage
    .locator("form")
    .filter({ has: ownerPage.getByRole("heading", { name: "Create a coupon", exact: true }) });
  await couponForm.getByLabel("Code", { exact: true }).fill("BROWSER10");
  await couponForm.getByLabel("Percent off", { exact: true }).fill("10");
  await couponForm.getByLabel("Maximum uses", { exact: true }).fill("5");
  await couponForm.getByLabel("Minimum subtotal in cents", { exact: true }).fill("0");
  await couponForm.getByLabel("Gallery ID (optional)", { exact: true }).fill(gallery.id);
  await couponForm
    .getByLabel("Expires (your local time)", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await couponForm.getByRole("button", { name: "Create coupon", exact: true }).click();
  await ownerPage.getByText(/BROWSER10: 10%/).waitFor();
  await quoteForm.getByLabel("Coupon (optional)", { exact: true }).fill("BROWSER10");
  await quoteForm.getByRole("button", { name: "Preview server quote", exact: true }).click();
  await quoteForm.getByText("Pre-tax preview: $22.50 USD", { exact: true }).waitFor();
  assert.equal(
    (
      await owner.request.post(`${origin}/api/commerce?op=checkout`, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
    503,
    "Pricing setup never enables checkout",
  );
  const currentGallery = (await catalog.ownerIndex()).galleries.find((g) => g.id === gallery.id);
  await catalog.saveGallery(
    {
      id: gallery.id,
      revision: currentGallery.revision,
      title: currentGallery.title,
      description: currentGallery.description,
      category: currentGallery.category,
      folderId: currentGallery.folderId,
      visibility: "unlisted",
      published: true,
      password: "local-proof-unlock-test",
    },
    process.env.OWNER_USER_IDS,
  );
  await firstPage.goto(`${origin}/galleries/${gallery.id}`);
  await firstPage.getByLabel("Gallery password").fill("local-proof-unlock-test");
  await firstPage.getByRole("button", { name: "Open gallery", exact: true }).click();
  await firstPage.getByLabel("Note to Whitt").waitFor();
  assert.equal(
    await firstPage.getByRole("button", { name: "Save selection", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real local HTTP/auth/SQL proof persistence across two customer sessions and owner inbox; paginated search and review filters; version review, stale-save retention, anonymous/CSRF/non-owner denial, lightbox favorites/keyboard/focus restoration, unsaved navigation warnings, folder create/rename/move/reload, customer instructions and restrictive download policy, 375/768/1440 layouts. Media is a synthetic fixture; not a live-provider test.",
  );
} finally {
  await browser?.close();
  await server.close();
}
