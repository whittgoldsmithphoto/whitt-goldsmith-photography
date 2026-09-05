import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";

// Real local HTTP + Better Auth + shared ephemeral PGlite. Never target a provider.
if (process.env.DATABASE_URL || process.env.HYPERDRIVE || process.env.CLOUDFLARE_ENV)
  throw new Error("Run without remote database or Cloudflare configuration");
const origin = "http://localhost:8093";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "local-resource-browser-fixture-not-provider-secret";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "fixture-owner-before-registration";
const server = await createServer({
  server: { host: "127.0.0.1", port: 8093, strictPort: true },
  logLevel: "error",
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(
    Boolean(runtime.databaseConnectionString()),
    false,
    "Only ephemeral local PGlite is allowed",
  );
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await getSql();
  const main = randomUUID();
  const galleries = Array.from({ length: 52 }, (_, i) => ({
    id: i ? randomUUID() : main,
    title: `SYNTHETIC EVENT ${String(i).padStart(3, "0")}`,
  }));
  for (const gallery of galleries)
    await sql.query(
      "INSERT INTO catalog_galleries(id,title,visibility,published) VALUES($1,$2,'public',true)",
      [gallery.id, gallery.title],
    );
  for (let i = 0; i < 52; i++) {
    const id = randomUUID();
    await sql.query(
      `INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height,display_order)
      VALUES($1,$2,'synthetic-owner',$3,'image/jpeg',500,$4,$5,'ready',600,400,$6)`,
      [
        id,
        main,
        i === 0 ? "synthetic-zzz.jpg" : i === 1 ? "synthetic-aaa.jpg" : `synthetic-${String(i).padStart(3, "0")}.jpg`,
        `synthetic-hash-${i}`,
        `private-synthetic-${i}`,
        i,
      ],
    );
    for (const kind of ["preview", "thumb"])
      await sql.query(
        "INSERT INTO catalog_derivatives(photo_id,kind,object_key,bytes,checksum) VALUES($1,$2,$3,10,'synthetic-hash')",
        [id, kind, `private-synthetic-${i}-${kind}`],
      );
  }

  await server.listen();
  browser = await chromium.launch({ headless: true });
  const anonymous = await browser.newContext(),
    owner = await browser.newContext(),
    customer = await browser.newContext();
  async function signup(context, name) {
    const response = await context.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { Origin: origin },
      data: {
        email: `${randomUUID()}@example.invalid`,
        password: randomUUID() + randomUUID(),
        name,
      },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).user.id;
  }
  process.env.OWNER_USER_IDS = await signup(owner, "Synthetic owner");
  await signup(customer, "Synthetic customer");
  const capabilities = await anonymous.request.get(`${origin}/api/catalog?op=capabilities`);
  assert.equal(capabilities.status(), 200, "Legacy catalog root remains routed");
  assert.equal((await capabilities.json()).isOwner, false);
  for (const [context, expected] of [
    [anonymous, 401],
    [customer, 403],
    [owner, 200],
  ]) {
    const response = await context.request.get(`${origin}/api/catalog/library`);
    assert.equal(response.status(), expected, "Owner library authorization matrix");
    if (expected === 200) {
      const body = await response.json();
      assert.equal(body.data.length, 50);
      assert.equal(body.page.hasMore, true);
      assert.ok(!JSON.stringify(body).includes("private-synthetic"));
    }
  }
  for (const suffix of ["?limit=51", "?limit=0", "?cursor=not-valid-json"]) {
    const response = await anonymous.request.get(`${origin}/api/catalog/galleries${suffix}`);
    assert.equal(response.status(), 400);
    const body = await response.json();
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.error.requestId, response.headers()["x-request-id"]);
  }
  const method = await anonymous.request.post(`${origin}/api/catalog/galleries`, { data: {} });
  assert.equal(method.status(), 405);
  assert.equal((await method.json()).error.code, "METHOD_NOT_ALLOWED");
  assert.equal(method.headers().allow, "GET");
  const [cover] = await sql.query(
    "select id from catalog_photos where gallery_id=$1 order by display_order limit 1",
    [main],
  );
  for (const [context, expected] of [
    [anonymous, 401],
    [customer, 403],
  ]) {
    const denied = await context.request.post(`${origin}/api/catalog/galleries/${main}/cover`, {
      headers: { Origin: origin },
      data: { photoId: cover.id, revision: 1 },
    });
    assert.equal(denied.status(), expected, "Cover mutation requires owner");
  }
  assert.equal(
    (
      await owner.request.post(`${origin}/api/catalog/galleries/${main}/cover`, {
        headers: { Origin: "https://attacker.invalid" },
        data: { photoId: cover.id, revision: 1 },
      })
    ).status(),
    403,
  );
  const studio = await owner.newPage();
  await studio.route("**/api/catalog?op=media&**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    }),
  );
  await studio.goto(`${origin}/organize`);
  await studio.getByRole("button", { name: "Photo status: All", exact: true }).waitFor();
  await studio.getByLabel("Photo sort", { exact: true }).waitFor();
  await studio.getByRole("status").filter({ hasText: /52 of 52 photographs/ }).waitFor();
  await studio.getByRole("button", { name: "Photo status: Archived (0)", exact: true }).click();
  await studio.getByRole("status").filter({ hasText: /0 of 52 photographs/ }).waitFor();
  assert.equal(await studio.getByRole("button", { name: /^synthetic-/ }).count(), 0);
  await studio.getByRole("button", { name: "Photo status: All", exact: true }).click();
  const photoButtons = studio.getByRole("button", { name: /^synthetic-/ });
  await studio.getByLabel("Photo sort", { exact: true }).selectOption("filename");
  assert.match(await photoButtons.first().innerText(), /synthetic-aaa\.jpg/);
  await studio.getByLabel("Photo sort", { exact: true }).selectOption("display-order");
  assert.match(await photoButtons.first().innerText(), /synthetic-zzz\.jpg/);
  for (const width of [375, 768, 1440]) {
    await studio.setViewportSize({ width, height: 900 });
    assert.equal(await studio.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `No horizontal overflow at ${width}px`);
  }
  await studio.getByText("Search all photographs", { exact: true }).click();
  const library = studio.getByRole("region", { name: "Library search", exact: true });
  await library.getByLabel("Filename or caption", { exact: true }).fill("synthetic-051");
  await library.getByRole("button", { name: "Search", exact: true }).click();
  await library.getByText("synthetic-051.jpg", { exact: true }).waitFor();
  await library
    .getByRole("button", { name: "Open synthetic-051.jpg in Organizer", exact: true })
    .click();
  await studio.getByRole("heading", { name: "Editing synthetic-051.jpg", exact: true }).waitFor();
  assert.equal(
    await studio.getByRole("button", { name: /^synthetic-051\.jpg/ }).getAttribute("aria-pressed"),
    "true",
    "Selected photo remains selected while inspector is open",
  );
  await studio.getByRole("button", { name: "Use as gallery cover", exact: true }).click();
  await studio
    .getByText("Gallery cover saved. Publication settings were not changed.", { exact: true })
    .waitFor();
  const [savedCover] = await sql.query(
    "select p.filename from catalog_galleries g join catalog_photos p on p.id=g.cover_photo_id where g.id=$1",
    [main],
  );
  assert.equal(savedCover.filename, "synthetic-051.jpg");
  const page = await anonymous.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/catalog?op=media&**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#444"/></svg>',
    }),
  );
  await page.goto(`${origin}/galleries`);
  await page.getByRole("button", { name: "Load more galleries", exact: true }).waitFor();
  await page.getByRole("button", { name: "Load more galleries", exact: true }).click();
  await page.getByText("SYNTHETIC EVENT 051", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Load more galleries", exact: true }).count(),
    0,
  );
  await page.getByLabel("Search galleries", { exact: true }).fill("EVENT 051");
  await page
    .getByRole("status")
    .filter({ hasText: /^1 gallery$/ })
    .waitFor();
  assert.equal(await page.getByText("SYNTHETIC EVENT 000", { exact: true }).count(), 0);
  await page.goto(`${origin}/galleries/${main}`);
  await page.getByRole("button", { name: "Load more photographs", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Open synthetic-/ }).count(), 50);
  await page.getByRole("button", { name: "Load more photographs", exact: true }).click();
  await page.getByRole("button", { name: "Open synthetic-051.jpg", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Open synthetic-/ }).count(), 52);
  await page.reload();
  await page.getByRole("button", { name: "Load more photographs", exact: true }).waitFor();
  await sql.query(
    "UPDATE catalog_galleries SET published=false,access_version=access_version+1 WHERE id=$1",
    [main],
  );
  const denied = page.waitForResponse(
    (response) => response.url().includes(`/galleries/${main}/photos`) && response.status() === 404,
  );
  await page.getByRole("button", { name: "Load more photographs", exact: true }).click();
  await denied;
  await page
    .getByRole("button", { name: "Open synthetic-000.jpg", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.getByRole("button", { name: /^Open synthetic-/ }).count(),
    0,
    "Revocation clears previously loaded protected photos",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local resource HTTP/auth matrix, structured errors, root compatibility, owner library search/open-in-organizer/cover save, cover CSRF and ownership denial, 52-gallery search/pagination, 52-photo pagination, and revocation clearing. Synthetic derivatives only; no remote provider acceptance claimed.",
  );
} finally {
  await browser?.close();
  await server.close();
}
