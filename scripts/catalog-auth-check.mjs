import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

// Requires an isolated LOCAL server with VITE_AUTH_ENABLED=true and
// OWNER_USER_IDS=fixture-owner. Creates one ephemeral local test account.
const origin = "http://localhost:8090";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("Browser error:", error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/auth/"))
      console.log("Auth HTTP", new URL(response.url()).pathname, response.status());
  });
  const sessionLoaded = page.waitForResponse((response) =>
    response.url().includes("/api/auth/get-session"),
  );
  await page.goto(`${origin}/login?setup=1`);
  await sessionLoaded;
  await page.getByLabel("Email", { exact: true }).fill(`catalog-${randomUUID()}@example.invalid`);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID() + randomUUID());
  await page.getByRole("button", { name: "Create owner account", exact: true }).click();
  try {
    await page
      .getByText("This account is not the studio owner", { exact: true })
      .waitFor({ timeout: 10000 });
  } catch (error) {
    console.error(await page.locator("body").innerText());
    throw error;
  }
  const session = await context.request.get(`${origin}/api/auth/get-session`);
  assert.equal(session.status(), 200);
  assert.ok((await session.json())?.user?.id, "A real local auth session should exist");
  const denial = await context.request.get(`${origin}/api/catalog?op=owner`);
  assert.equal(denial.status(), 403);
  const mutation = await context.request.post(`${origin}/api/catalog?op=folder`, {
    headers: { Origin: origin },
    data: { title: "Denied", parentId: null },
  });
  assert.equal(mutation.status(), 403);
  console.log(
    "PASS: real local email registration/session, signed-in non-owner read and write denial. No production accounts created.",
  );
} finally {
  await browser.close();
}
