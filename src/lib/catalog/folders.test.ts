import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createFolderService } from "./folders.ts";
import type { Sql } from "../db.ts";

async function fixture() {
  const db = new PGlite();
  for (const name of ["0005_catalog.sql", "0010_folder_revisions.sql"])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const sql = Object.assign(
    async () => {
      throw new Error("Use query");
    },
    {
      query: async <T>(query: string, values: unknown[] = []) =>
        (await db.query<T>(query, values)).rows,
    },
  ) as Sql;
  return { db, service: createFolderService(sql) };
}
test("folder create, nested tree, rename, move and stale revision remain durable", async () => {
  const { db, service } = await fixture();
  try {
    assert.deepEqual(await service.folderTree(), { folders: [] });
    const parent = await service.saveFolder({ title: "Football", parentId: null }, "owner");
    const child = await service.saveFolder({ title: "CCES", parentId: parent.id }, "owner");
    await db.query("insert into catalog_galleries(id,folder_id,title) values($1,$2,$3)", [
      crypto.randomUUID(),
      child.id,
      "Football photographs",
    ]);
    assert.equal(parent.revision, 1);
    assert.deepEqual(
      (await service.folderTree()).folders.map((row) => row.path),
      [["Football"], ["Football", "CCES"]],
    );
    const renamed = await service.saveFolder(
      { id: child.id, revision: child.revision, title: "CCES 2026", parentId: parent.id },
      "owner",
    );
    assert.equal(renamed.revision, 2);
    await assert.rejects(
      service.saveFolder({ id: child.id, revision: 1, title: "stale", parentId: null }, "owner"),
      /changed/,
    );
    await service.saveFolder(
      { id: child.id, revision: 2, title: renamed.title, parentId: null },
      "owner",
    );
    assert.deepEqual(
      (await service.folderTree()).folders.map((row) => row.depth),
      [1, 1],
    );
    assert.equal((await db.query("select * from catalog_audit")).rows.length, 4);
    assert.equal(
      (await db.query<{ folder_id: string }>("select folder_id from catalog_galleries")).rows[0]
        .folder_id,
      child.id,
      "Folder moves preserve gallery attachment",
    );
  } finally {
    await db.close();
  }
});
test("folder cycles, missing parents, invalid input and subtree depth are rejected", async () => {
  const { db, service } = await fixture();
  try {
    const root = await service.saveFolder({ title: "Root", parentId: null }, "owner");
    const child = await service.saveFolder({ title: "Child", parentId: root.id }, "owner");
    for (const parentId of [root.id, child.id])
      await assert.rejects(
        service.saveFolder({ id: root.id, revision: 1, title: "Root", parentId }, "owner"),
        /itself or a descendant/,
      );
    await assert.rejects(
      service.saveFolder({ title: "Missing", parentId: crypto.randomUUID() }, "owner"),
      /Parent folder unavailable/,
    );
    await assert.rejects(service.saveFolder({ title: "", parentId: null }, "owner"));
    await assert.rejects(
      service.saveFolder({ title: "Anonymous", parentId: null }, "dev-user"),
      /sign-in/,
    );
    await assert.rejects(
      service.saveFolder({ id: root.id, title: "Missing revision", parentId: null }, "owner"),
    );
    let parent = child;
    for (let level = 3; level <= 8; level++)
      parent = await service.saveFolder({ title: `Level ${level}`, parentId: parent.id }, "owner");
    await assert.rejects(
      service.saveFolder({ title: "Too deep", parentId: parent.id }, "owner"),
      /at most 8/,
    );
    const separate = await service.saveFolder({ title: "Separate", parentId: null }, "owner");
    await assert.rejects(
      service.saveFolder(
        { id: root.id, revision: 1, title: "Root", parentId: separate.id },
        "owner",
      ),
      /at most 8/,
    );
    assert.equal((await service.folderTree()).folders.length, 9);
    await db.query("update catalog_folders set parent_id=$1 where id=$2", [child.id, root.id]);
    await assert.rejects(
      service.folderTree(),
      /hierarchy needs repair/,
      "Do not silently omit legacy corrupt folder trees",
    );
  } finally {
    await db.close();
  }
});
test("concurrent opposing moves serialize and stale competing rename has one winner", async () => {
  const { db, service } = await fixture();
  try {
    const a = await service.saveFolder({ title: "A", parentId: null }, "owner");
    const b = await service.saveFolder({ title: "B", parentId: null }, "owner");
    const moves = await Promise.allSettled([
      service.saveFolder({ id: a.id, revision: 1, title: "A", parentId: b.id }, "owner"),
      service.saveFolder({ id: b.id, revision: 1, title: "B", parentId: a.id }, "owner"),
    ]);
    assert.equal(moves.filter((result) => result.status === "fulfilled").length, 1);
    const tree = await service.folderTree();
    assert.equal(tree.folders.length, 2);
    assert.equal(tree.folders.filter((row) => row.parentId === null).length, 1);
    const current = tree.folders[0];
    const results = await Promise.allSettled(
      ["One", "Two"].map((title) =>
        service.saveFolder(
          { id: current.id, revision: current.revision, parentId: current.parentId, title },
          "owner",
        ),
      ),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    // PGlite serializes its engine; the production function additionally takes an
    // explicit table-wide conflicting lock for independent Postgres connections.
    const source = (
      await db.query<{ source: string }>(
        "select prosrc as source from pg_proc where proname='catalog_save_folder'",
      )
    ).rows[0].source;
    assert.match(source, /LOCK TABLE catalog_folders IN SHARE ROW EXCLUSIVE MODE/);
  } finally {
    await db.close();
  }
});
