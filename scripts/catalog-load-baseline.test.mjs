import { test } from "node:test";
import assert from "node:assert/strict";
import { createBaselineFixture, measureBaseline, assertBoundedResponse } from "./catalog-load-baseline.mjs";

test("10,000-photo fixture measures real bounded resource service calls", async () => {
  const fixture = await createBaselineFixture();
  try {
    const result = await measureBaseline(fixture);
    assert.deepEqual(result.fixture, { galleries: 100, photos: 10000, derivatives: 20000 });
    for (const sample of Object.values(result.resources)) {
      assert.equal(sample.itemCount, 50);
      assert.ok(sample.responseBytes < 128 * 1024);
      assert.ok(sample.durationMs >= 0);
      assert.ok(sample.queryCount >= 1 && sample.queryCount <= 2);
      assert.ok(sample.maxRowsReturned <= 51);
    }
    assert.equal(result.resources.publicIndex.coverCount, 50);
    for (const [operation, expected] of [[params => fixture.service.galleries(params), 100], [params => fixture.service.library(params), 10000]]) {
      const seen = new Set();
      let cursor = null;
      do {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const page = await operation(params);
        assertBoundedResponse(page);
        for (const item of page.data) {
          assert.ok(!seen.has(item.id), "Duplicate entry across keyset pages");
          seen.add(item.id);
        }
        cursor = page.page.nextCursor;
        assert.equal(page.page.hasMore, cursor !== null);
      } while (cursor);
      assert.equal(seen.size, expected);
    }
    await assert.rejects(() => fixture.service.library(new URLSearchParams({ limit: "10000" })));
  } finally { await fixture.close(); }
});

test("baseline gate rejects unbounded or private responses", () => {
  assert.throws(() => assertBoundedResponse({ data: Array(51).fill({}), page: {} }), /bounded/);
  assert.throws(() => assertBoundedResponse({ data: [{ original_key: "private" }], page: {} }), /private/);
  assert.throws(() => assertBoundedResponse({ data: [{ cover: { object_key: "private" } }], page: {} }), /private/);
  assert.throws(() => assertBoundedResponse({ data: [], extra: "x".repeat(128 * 1024) }), /bytes/);
});
