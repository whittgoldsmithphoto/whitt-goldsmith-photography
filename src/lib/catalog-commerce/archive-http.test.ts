import { test } from "node:test";
import assert from "node:assert/strict";
import { createArchiveHandler } from "./archive-http.ts";

test("disabled archive routes never access identity, database or storage", async () => {
  const handler = createArchiveHandler(false, undefined!);
  assert.equal(
    (await handler(new Request("https://photos.example/api/commerce-archive"))).status,
    503,
  );
});
test("archive requests require same-origin JSON and authenticated customers", async () => {
  let calls = 0;
  const handler = createArchiveHandler(true, {
    user: async () => {
      calls++;
      return "";
    },
  } as never);
  const url = "https://photos.example/api/commerce-archive";
  assert.equal((await handler(new Request(url))).status, 405);
  assert.equal((await handler(new Request(url, { method: "POST" }))).status, 403);
  assert.equal(
    (
      await handler(
        new Request(url, {
          method: "POST",
          headers: { origin: "https://photos.example", "content-type": "application/json" },
          body: "{}",
        }),
      )
    ).status,
    401,
  );
  assert.equal(calls, 1);
});
