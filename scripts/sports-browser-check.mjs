import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";

// Real local HTTP, BetterAuth, PGlite and mounted UI. Displayed media is synthetic.
if (process.env.DATABASE_URL || process.env.HYPERDRIVE || process.env.CLOUDFLARE_ENV)
  throw new Error("Run without remote database/environment configuration");
const origin = "http://localhost:8093";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "not-registered-yet";
const server = await createServer({
  server: { host: "127.0.0.1", port: 8093, strictPort: true },
  logLevel: "error",
});
let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(Boolean(runtime.databaseConnectionString()), false);
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await getSql();
  const galleryId = randomUUID(),
    photoId = randomUUID(),
    reusePhotoId = randomUUID();
  await sql`insert into catalog_galleries(id,title,visibility,published) values(${galleryId},'SYNTHETIC SPORTS TEST','public',true)`;
  await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
    values(${photoId},${galleryId},'fixture-owner','synthetic-sport.jpg','image/jpeg',12,'fixture-hash','private-fixture','ready',100,100)`;
  for (const kind of ["thumb", "preview"])
    await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
    values(${photoId},${kind},${kind},5,'fixture-digest')`;
  await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
    values(${reusePhotoId},${galleryId},'fixture-owner','reuse-target.jpg','image/jpeg',12,'fixture-hash-2','private-fixture-2','ready',100,100)`;
  for (const kind of ["thumb", "preview"])
    await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
    values(${reusePhotoId},${kind},${`reuse-${kind}`},5,'fixture-digest')`;
  const { createSportsService, emptyMetadata } = await server.ssrLoadModule(
    "/src/lib/sports/repository.ts",
  );
  await createSportsService(sql).save(
    {
      ...emptyMetadata(reusePhotoId),
      team: "Target team",
      jerseyNumber: "11",
      subject: "Target subject",
      notes: "Target private notes",
      approved: true,
    },
    "fixture-owner",
  );
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext(),
    second = await browser.newContext(),
    publicVisitor = await browser.newContext();
  const email = `sports-${randomUUID()}@example.invalid`,
    password = randomUUID() + randomUUID();
  const signup = await owner.request.post(`${origin}/api/auth/sign-up/email`, {
    headers: { Origin: origin },
    data: { email, password, name: "Synthetic owner" },
  });
  assert.equal(signup.status(), 200);
  process.env.OWNER_USER_IDS = (await signup.json()).user.id;
  assert.equal(
    (
      await second.request.post(`${origin}/api/auth/sign-in/email`, {
        headers: { Origin: origin },
        data: { email, password },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await publicVisitor.request.get(`${origin}/api/sports?op=read&photoId=${photoId}`)).status(),
    401,
  );
  assert.equal(
    (
      await publicVisitor.request.get(`${origin}/api/sports?op=history&photoId=${photoId}`)
    ).status(),
    401,
  );
  const pages = [],
    errors = [];
  for (const context of [owner, second, publicVisitor]) {
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
  const [page, secondPage, searchPage] = pages;
  async function openEditor(target) {
    await target.goto(`${origin}/organize`);
    await target.getByRole("button", { name: /SYNTHETIC SPORTS TEST/ }).click();
    await target.getByRole("button", { name: /synthetic-sport.jpg.*Edit/ }).click();
    await target.getByLabel("Team", { exact: true }).waitFor();
  }
  await openEditor(page);
  await page.getByLabel("Team", { exact: true }).fill("Synthetic Hawks");
  await page.getByLabel("Sport", { exact: true }).fill("Football");
  await page.getByLabel("Jersey number", { exact: true }).fill("06");
  await page.getByLabel("Private photographer notes").fill("Confidential fixture note");
  await page.getByRole("button", { name: "Save metadata", exact: true }).click();
  await page.getByText("Metadata saved.", { exact: true }).waitFor();
  await searchPage.goto(`${origin}/galleries`);
  await searchPage.waitForLoadState("networkidle");
  await searchPage.getByLabel("Find sports photos").fill("Synthetic Hawks");
  await searchPage.getByRole("button", { name: "Search", exact: true }).click();
  await searchPage.getByText("No matching public photos.", { exact: true }).waitFor();
  await page.getByLabel(/I reviewed these details/).check();
  await page.getByRole("button", { name: "Save metadata", exact: true }).click();
  await page.getByText("Metadata saved.", { exact: true }).waitFor();
  await searchPage.getByRole("button", { name: "Search", exact: true }).click();
  await searchPage.getByText("synthetic-sport.jpg", { exact: true }).waitFor();
  assert.equal(await searchPage.getByText("Confidential fixture note").count(), 0);
  await openEditor(secondPage);
  assert.equal(
    await secondPage.getByLabel("Team", { exact: true }).inputValue(),
    "Synthetic Hawks",
  );
  await page.getByLabel("Team", { exact: true }).fill("Updated Hawks");
  assert.equal(await page.getByLabel(/I reviewed these details/).isChecked(), false);
  await page.getByRole("button", { name: "Save metadata", exact: true }).click();
  await page.getByText("Metadata saved.", { exact: true }).waitFor();
  await secondPage.getByLabel("Team", { exact: true }).fill("Stale draft team");
  await secondPage.getByRole("button", { name: "Save metadata", exact: true }).click();
  await secondPage.getByText(/Photo missing or metadata changed/).waitFor();
  assert.equal(
    await secondPage.getByLabel("Team", { exact: true }).inputValue(),
    "Stale draft team",
  );
  await secondPage.getByRole("button", { name: "Reload saved details", exact: true }).click();
  await secondPage.waitForFunction(
    () =>
      document.querySelector('section[aria-label="Sports metadata"] input')?.value ===
      "Updated Hawks",
  );
  assert.equal(await secondPage.getByLabel("Team", { exact: true }).inputValue(), "Updated Hawks");
  await secondPage.getByRole("button", { name: "Load saved revisions", exact: true }).click();
  await secondPage.getByText("Revision 2: Synthetic Hawks / Football", { exact: false }).waitFor();
  await secondPage
    .getByRole("listitem")
    .filter({ hasText: "Revision 2:" })
    .getByRole("button", { name: "Restore as draft" })
    .click();
  await secondPage
    .getByText("Restored as a new draft. Review and approve before public search.", { exact: true })
    .waitFor();
  assert.equal(
    await secondPage.getByLabel("Team", { exact: true }).inputValue(),
    "Synthetic Hawks",
  );
  assert.equal(await secondPage.getByLabel(/I reviewed these details/).isChecked(), false);
  await searchPage.getByRole("button", { name: "Search", exact: true }).click();
  await searchPage.getByText("No matching public photos.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /reuse-target.jpg.*Edit/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('section[aria-label="Sports metadata"] input')?.value ===
      "Target team",
  );
  await page.getByRole("button", { name: "Reuse last saved event details", exact: true }).click();
  assert.equal(await page.getByLabel("Team", { exact: true }).inputValue(), "Updated Hawks");
  assert.equal(await page.getByLabel("Jersey number", { exact: true }).inputValue(), "11");
  assert.equal(
    await page.getByLabel("Owner-reviewed subject", { exact: true }).inputValue(),
    "Target subject",
  );
  assert.equal(
    await page.getByLabel("Private photographer notes").inputValue(),
    "Target private notes",
  );
  assert.equal(await page.getByLabel(/I reviewed these details/).isChecked(), false);
  const unchanged = await owner.request.get(`${origin}/api/sports?op=read&photoId=${reusePhotoId}`);
  assert.equal(
    (await unchanged.json()).team,
    "Target team",
    "Reusing a template must not save silently",
  );
  const cache = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("wgp:sports-event-draft:v1")),
  );
  assert.deepEqual(Object.keys(cache).sort(), ["eventDate", "opponent", "sport", "team", "venue"]);
  await page.getByRole("button", { name: "Save metadata", exact: true }).click();
  await page.getByText("Metadata saved.", { exact: true }).waitFor();
  const persisted = await owner.request.get(`${origin}/api/sports?op=read&photoId=${reusePhotoId}`);
  const savedReuse = await persisted.json();
  assert.equal(savedReuse.team, "Updated Hawks");
  assert.equal(savedReuse.approved, false);
  assert.equal(savedReuse.notes, "Target private notes");
  await page.getByRole("button", { name: "Forget saved event details", exact: true }).click();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("wgp:sports-event-draft:v1")),
    null,
  );
  for (const width of [375, 768, 1440]) {
    for (const target of [secondPage, searchPage]) {
      await target.setViewportSize({ width, height: 900 });
      assert.equal(
        await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `Sports layout overflow at ${width}`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mounted sports owner editor saves across two real BetterAuth sessions; public search excludes drafts/private notes; owner approval, edit de-approval, stale-save retention/reload, history restore as draft; event reuse copies only five event fields into an unsaved unapproved draft, preserves target private/person fields, and stores no personal fields in tab cache; signed-out owner API denial; 375/768/1440 layouts. Local SQL and synthetic media only; no live-provider validation.",
  );
} finally {
  await browser?.close();
  await server.close();
}
