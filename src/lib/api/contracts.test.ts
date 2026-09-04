import { test } from "node:test";
import assert from "node:assert/strict";
import { pageInput, encodeCursor, pageResult } from "./pagination.ts";
import { errorResponse } from "./errors.ts";
test("pages enforce bounded input and filter-bound opaque cursors", () => {
  assert.equal(pageInput(new URLSearchParams(), "galleries").limit, 50);
  for (const limit of ["0", "51", "1.5", "-1", "NaN", "1e2"])
    assert.throws(() => pageInput(new URLSearchParams({ limit }), "galleries"));
  const id = crypto.randomUUID();
  const cursor = encodeCursor({ scope: "galleries", id, sort: "CCES" });
  assert.equal(pageInput(new URLSearchParams({ cursor }), "galleries").cursor?.id, id);
  assert.throws(() => pageInput(new URLSearchParams({ cursor }), "private-library"));
  for (const cursor of ["!", "x".repeat(2049), Buffer.from('{"v":2}').toString("base64url")])
    assert.throws(() => pageInput(new URLSearchParams({ cursor }), "galleries"));
});
test("only the lookahead determines next cursor, never exposes the extra row", () => {
  const result = pageResult([1, 2, 3], 2, (item) => String(item));
  assert.deepEqual(result, { data: [1, 2], page: { hasMore: true, nextCursor: "2" } });
  assert.equal(pageResult([1], 2, String).page.nextCursor, null);
});
test("unknown errors never expose secrets and request IDs are server-generated", async () => {
  const response = errorResponse(new Error("postgres://secret-password"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.ok(body.error.requestId);
  assert.ok(!JSON.stringify(body).includes("secret-password"));
});
