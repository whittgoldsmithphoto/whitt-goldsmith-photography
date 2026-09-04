import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createProofService } from "./proofs.ts";
import type { Sql } from "../db.ts";

test("proof inbox cursor, literal search, status filters, validation and review races", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "0005_catalog.sql",
      "0006_photo_management.sql",
      "0007_proof_selections.sql",
    ])
      await db.exec(
        await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"),
      );
    const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
      let query = parts[0];
      values.forEach((_, i) => {
        query += `$${i + 1}${parts[i + 1]}`;
      });
      return (await db.query(query, values)).rows;
    }) as Sql;
    const gallery = crypto.randomUUID();
    await sql`insert into catalog_galleries(id,title) values(${gallery},'CCES Football')`;
    const proofIds = [];
    for (let i = 0; i < 7; i++) {
      const id = crypto.randomUUID();
      proofIds.push(id);
      await sql`insert into catalog_proofs(id,gallery_id,customer_id,note,reviewed_revision,updated_at)
        values(${id},${gallery},${`customer-${i}`},${i === 3 ? "literal 100%_ note" : "hello"},${i % 2},'2026-09-03 12:00:00.123456+00')`;
    }
    const service = createProofService(sql, async () => ({ access_version: 1 }));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.ownerProofPage({ limit: 2, cursor });
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(seen, [...proofIds].sort(), "same timestamp ties neither skip nor repeat");
    const first = await service.ownerProofPage({ limit: 2 });
    assert.match(first.nextCursor!, /123456/, "cursor preserves microsecond precision");
    assert.equal((await service.ownerProofPage({ q: "CCES" })).items.length, 7);
    assert.equal(
      (await service.ownerProofPage({ q: "%_" })).items.length,
      1,
      "search wildcards are literal",
    );
    assert.equal((await service.ownerProofPage({ q: proofIds[0] })).items.length, 1);
    assert.equal((await service.ownerProofPage({ status: "reviewed" })).items.length, 3);
    assert.equal((await service.ownerProofPage({ status: "unreviewed" })).items.length, 4);
    assert.equal((await service.ownerProofPage({ q: "nothing" })).nextCursor, null);
    await assert.rejects(
      service.ownerProofPage({ cursor: "not JSON" }),
      /Invalid proof inbox cursor/,
    );
    await assert.rejects(service.ownerProofPage({ limit: 1000 }));
    await assert.rejects(service.ownerProofPage({ q: "x".repeat(121) }));
    await assert.rejects(service.reviewProof({ id: proofIds[0], revision: 2 }, "owner"), /changed/);
    await service.reviewProof({ id: proofIds[0], revision: 1 }, "owner");
    await service.reviewProof({ id: proofIds[0], revision: 1 }, "owner");
    assert.equal((await service.ownerProofPage({ status: "reviewed" })).items.length, 4);
    assert.equal((await sql`select * from catalog_audit where action='proof.reviewed'`).length, 1);
    const anonymous = service.readProof(gallery, "dev-user");
    await assert.rejects(anonymous, /Sign in/);
  } finally {
    await db.close();
  }
});
