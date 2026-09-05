import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHostedRelease } from "./verify-hosted-release.mjs";
test("release verification rejects stale code and missing application assets", async () => {
  const revision = "a".repeat(40);
  await assert.rejects(
    verifyHostedRelease(
      "https://example.com",
      revision,
      async () => new Response("", { headers: { "x-wgp-revision": "old" } }),
    ),
    /revision/,
  );
  await assert.rejects(
    verifyHostedRelease(
      "https://example.com",
      revision,
      async () => new Response("", { headers: { "x-wgp-revision": revision } }),
    ),
    /assets/,
  );
  const requests = [];
  assert.equal(
    await verifyHostedRelease("https://example.com", revision, async (url, options) => {
      requests.push(String(url));
      return options.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "text/javascript" } })
        : new Response('<script src="/assets/app.js"></script>', {
            headers: { "x-wgp-revision": revision },
          });
    }),
    1,
  );
  assert.equal(requests.length, 2);
});
