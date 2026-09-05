import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryMetadataHandler } from "./library-metadata-http.ts";
import { CatalogError } from "./errors.ts";
test("metadata is owner-only, same-origin, bounded and disabled until migrated", async () => {
  let writes = 0,
    reads = 0;
  const deps = {
    enabled: true,
    owner: async () => "owner",
    service: async () => ({
      list: async () => {
        reads++;
        return { items: [], next: null };
      },
      bulk: async () => {
        writes++;
        return { changed: 1 };
      },
    }),
  };
  const request = (body = "{}", origin = "https://example.test") =>
    new Request("https://example.test/api/catalog/metadata", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body,
    });
  assert.equal(
    (
      await libraryMetadataHandler({
        ...deps,
        owner: async () => {
          throw new CatalogError("Not owner", 403);
        },
      })(request())
    ).status,
    403,
  );
  assert.equal(
    (await libraryMetadataHandler(deps)(request("{}", "https://evil.test"))).status,
    403,
  );
  assert.equal((await libraryMetadataHandler({ ...deps, enabled: false })(request())).status, 503);
  assert.equal((await libraryMetadataHandler(deps)(request("x".repeat(48_001)))).status, 400);
  assert.equal(writes, 0);
  assert.equal((await libraryMetadataHandler(deps)(request())).status, 200);
  assert.equal(writes, 1);
  const get = await libraryMetadataHandler(deps)(
    new Request("https://example.test/api/catalog/metadata"),
  );
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  assert.equal(reads, 1);
});
