import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createSmartCollections } from "./smart-collections.ts";
test("private smart collections save allowlisted rules and reject stale edits", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL("../../../migrations/0031_smart_collections.sql", import.meta.url),
        "utf8",
      ),
    );
    const sql = {
      query: async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows,
    } as Sql;
    const service = createSmartCollections(sql);
    const saved = await service.save(
      { title: "Football selects", rules: { keyword: " Football ", rating: 5 } },
      "owner",
    );
    assert.deepEqual(saved.rules, { keyword: "football", rating: 5 });
    assert.equal((await service.list("other")).length, 0);
    assert.equal((await service.list("owner"))[0].title, "Football selects");
    const changed = await service.save(
      { id: saved.id, revision: 1, title: "Best football", rules: { rating: 5 } },
      "owner",
    );
    assert.equal(changed.revision, 2);
    await assert.rejects(
      service.save({ id: saved.id, revision: 1, title: "Stale", rules: {} }, "owner"),
    );
    await assert.rejects(
      service.save({ id: saved.id, revision: 2, title: "Foreign", rules: {} }, "other"),
    );
    await assert.rejects(service.save({ title: "Unsafe", rules: { sql: "select *" } }, "owner"));
    await assert.rejects(
      service.save({ title: "Unsafe", rules: { after: "skip-results" } }, "owner"),
    );
  } finally {
    await db.close();
  }
});
