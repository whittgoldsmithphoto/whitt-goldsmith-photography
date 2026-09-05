import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run explicitly against an empty local dev database, not as part of unit tests.
// UI fixtures below are intercepted only inside this fresh browser context.
// They never write galleries, accounts, or photos to a deployed database.
const origin = process.env.CATALOG_TEST_ORIGIN || "http://localhost:8080";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const index = await context.request.get(`${origin}/api/catalog?op=index`);
  assert.equal(index.status(), 200);
  assert.deepEqual(await index.json(), { galleries: [], photos: [], folders: [] });
  const denied = await context.request.get(`${origin}/api/catalog?op=owner`);
  assert.equal(denied.status(), 401);
  const csrf = await context.request.post(`${origin}/api/catalog?op=gallery`, {
    headers: { Origin: "https://elsewhere.invalid" },
    data: {},
  });
  assert.equal(csrf.status(), 403);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.getByRole("heading", { name: "No public galleries yet" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `Overflow at ${width}px`,
    );
  }
  await page.route("**/api/catalog/galleries*", async (route) =>
    route.fulfill({ status: 503, json: { error: { message: "temporarily unavailable" } } }),
  );
  await page.goto(`${origin}/about`);
  await page.getByRole("heading", { name: "Whitt Goldsmith Photography" }).waitFor();
  assert.match(await page.locator("body").innerText(), /A studio in Greenville, South Carolina/);
  await page.unroute("**/api/catalog/galleries*");

  let galleryRequests = 0;
  let failDistinctiveSearch = true;
  const galleryFixture = (title) => ({
    data: [
      {
        id: title === "Synthetic browser test" ? "synthetic" : "recovered",
        title,
        description: "Not a real gallery",
        category: "Test",
        cover: null,
        coverPhotoId: null,
        photoCount: 0,
        publishedAt: null,
      },
    ],
    page: { hasMore: false, nextCursor: null },
  });
  await page.route("**/api/catalog/galleries**", async (route) => {
    galleryRequests += 1;
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "distinctive failure query" && failDistinctiveSearch) {
      failDistinctiveSearch = false;
      return route.fulfill({
        status: 503,
        json: { error: { message: "database connection refused" } },
      });
    }
    return route.fulfill({
      json: galleryFixture(
        query === "distinctive failure query"
          ? "Recovered query gallery"
          : "Synthetic browser test",
      ),
    });
  });
  await page.goto(`${origin}/galleries`);
  await page.getByRole("heading", { name: "Synthetic browser test" }).waitFor();
  const requestsAfterLoad = galleryRequests;
  const gallerySearch = page.getByLabel("Gallery title search", { exact: true });
  await gallerySearch.fill("distinctive failure query");
  await page.waitForTimeout(100);
  assert.equal(galleryRequests, requestsAfterLoad, "gallery search must wait for explicit submit");
  await page.getByRole("button", { name: "Search galleries", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText("Galleries are temporarily unavailable.", { exact: true })
    .waitFor();
  assert.equal(await gallerySearch.inputValue(), "distinctive failure query");
  await page.getByRole("heading", { name: "Synthetic browser test" }).waitFor();
  await page.getByRole("button", { name: "Retry search", exact: true }).click();
  await page.getByRole("heading", { name: "Recovered query gallery" }).waitFor();
  assert.equal(await gallerySearch.inputValue(), "distinctive failure query");
  assert.equal(galleryRequests, requestsAfterLoad + 2);
  const discovery = page.getByRole("region", { name: "Public gallery discovery" });
  await discovery.getByRole("heading", { name: "Search galleries", exact: true }).waitFor();
  await discovery
    .getByRole("heading", { name: "Search approved sports photos", exact: true })
    .waitFor();
  await page.getByText("Cover pending", { exact: true }).waitFor();
  await page.unroute("**/api/catalog/galleries**");

  await page.route("**/api/catalog/galleries**", async (route) =>
    route.fulfill({ status: 503, json: { error: { message: "database connection refused" } } }),
  );
  await page.goto(`${origin}/galleries`);
  await page
    .getByRole("alert")
    .getByText("Galleries are temporarily unavailable.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.unroute("**/api/catalog/galleries**");

  const id = "11111111-1111-4111-8111-111111111111";
  const g = {
    id,
    folderId: null,
    title: "Synthetic browser test",
    description: "Not a real gallery",
    category: "Test",
    visibility: "public",
    published: true,
    requiresPassword: false,
    revision: 1,
    updatedAt: new Date().toISOString(),
  };
  const src =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#444"/><text x="100" y="200" fill="white">TEST FIXTURE</text></svg>',
    );
  const photos = [1, 2].map((n) => ({
    id: String(n),
    galleryId: id,
    filename: `synthetic-${n}.jpg`,
    width: 600,
    height: 400,
    src,
    thumbSrc: src,
  }));
  let unlocked = false;
  await page.route("**/api/catalog**", async (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get("op");
    if (url.pathname === "/api/catalog/galleries" && route.request().method() === "GET")
      return route.fulfill({
        json: {
          data: [
            {
              ...g,
              cover: photos[0],
              coverPhotoId: photos[0].id,
              photoCount: photos.length,
              publishedAt: g.updatedAt,
            },
          ],
          page: { hasMore: false, nextCursor: null },
        },
      });
    if (url.pathname.endsWith(`/galleries/${id}/photos`))
      return route.fulfill(
        unlocked
          ? { json: { gallery: g, data: photos, page: { hasMore: false, nextCursor: null } } }
          : { status: 401, json: { error: { message: "Gallery password required" } } },
      );
    if (op === "index") return route.fulfill({ json: { galleries: [g], photos, folders: [] } });
    if (op === "detail")
      return route.fulfill(
        unlocked
          ? { json: { gallery: g, photos } }
          : { status: 401, json: { error: "Gallery password required" } },
      );
    if (op === "unlock") {
      unlocked = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.continue();
  });
  await page.goto(`${origin}/galleries`);
  await page.getByRole("heading", { name: g.title }).waitFor();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: g.title }) })
    .click();
  await page.getByLabel("Gallery password", { exact: true }).fill("test password");
  await page.getByRole("button", { name: "Open gallery", exact: true }).click();
  await page.getByRole("button", { name: "Open synthetic-1.jpg", exact: true }).click();
  await page.getByRole("dialog", { name: "Photograph viewer" }).waitFor();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("dialog").getByText("synthetic-2.jpg · 2/2", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: live empty catalog, owner denial, cross-origin denial; 375/768/1440 layouts; fixture-only password UI, lightbox arrows, Escape.",
  );
} finally {
  await browser.close();
}
