import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { createSportsService, emptyMetadata, metadataSchema } from "./repository.ts";
import { handleSportsRequest } from "./http.ts";
import { assertCatalogOwner } from "../catalog/owner.ts";
import {
  EVENT_REUSE_KEY,
  applyRememberedEvent,
  eventDetails,
  forgetRememberedEvent,
  readRememberedEvent,
  rememberSavedEvent,
} from "./event-reuse.ts";

async function fixture() {
  const db = new PGlite();
  for (const migration of [
    "0005_catalog.sql",
    "0006_photo_management.sql",
    "0009_sports_metadata.sql",
  ])
    await db.exec(
      await readFile(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"),
    );
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let query = strings[0];
    for (let i = 0; i < values.length; i++) query += `$${i + 1}${strings[i + 1]}`;
    return (await db.query(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, values: unknown[] = []) =>
    (await db.query<T>(query, values)).rows;
  const galleryId = crypto.randomUUID(),
    photoId = crypto.randomUUID();
  await sql`insert into catalog_galleries(id,title,visibility,published) values(${galleryId},'Fixture game','public',true)`;
  await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
    values(${photoId},${galleryId},'owner','fixture.jpg','image/jpeg',12,'digest','private/original','ready',100,100)`;
  for (const kind of ["thumb", "preview"])
    await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
    values(${photoId},${kind},${kind},5,'digest')`;
  const input = {
    ...emptyMetadata(photoId),
    team: "CCES",
    sport: "Football",
    opponent: "St Joes",
    eventDate: "2026-09-03",
    jerseyNumber: "06",
    subject: "Running play",
    venue: "Greenville",
    notes: "Private photographer scouting note",
    approved: true,
  };
  return { db, sql, photoId, galleryId, input, service: createSportsService(sql) };
}

test("sports metadata saves shared data, searchable approved fields and private notes stay private", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.service.read(f.photoId)).revision, 0);
    const saved = await f.service.save(f.input, "owner");
    assert.equal(saved.revision, 1);
    assert.deepEqual(await f.service.read(f.photoId), saved);
    const result = await f.service.search({ query: "CCES Football" });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].jerseyNumber, "06");
    assert.equal(result.results[0].eventDate, "2026-09-03");
    assert.ok(!("notes" in result.results[0]));
    assert.ok(!JSON.stringify(result).includes("private/original"));
    assert.equal((await f.service.search({ query: "scouting" })).results.length, 0);
    assert.equal((await f.service.search({ query: "06" })).results.length, 1);
  } finally {
    await f.db.close();
  }
});

test("search fails closed for each gallery/photo access restriction and missing derivatives", async () => {
  const f = await fixture();
  try {
    const saved = await f.service.save({ ...f.input, approved: false }, "owner");
    assert.equal((await f.service.search({ query: "CCES" })).results.length, 0);
    await f.service.save({ ...saved, approved: true }, "owner");
    for (const change of [
      "visibility='private'",
      "visibility='unlisted'",
      "published=false",
      "password_hash='secret-hash'",
    ]) {
      await f.sql.query(`update catalog_galleries set ${change} where id=$1`, [f.galleryId]);
      assert.equal((await f.service.search({ query: "CCES" })).results.length, 0, change);
      await f.sql`update catalog_galleries set visibility='public', published=true, password_hash=null where id=${f.galleryId}`;
    }
    for (const change of ["status='processing'", "hidden=true", "archived=true"]) {
      await f.sql.query(`update catalog_photos set ${change} where id=$1`, [f.photoId]);
      assert.equal((await f.service.search({ query: "CCES" })).results.length, 0, change);
      await f.sql`update catalog_photos set status='ready',hidden=false,archived=false where id=${f.photoId}`;
    }
    await f.sql`delete from catalog_derivatives where photo_id=${f.photoId} and kind='preview'`;
    assert.equal((await f.service.search({ query: "CCES" })).results.length, 0);
  } finally {
    await f.db.close();
  }
});

test("optimistic edits reject stale revisions and history restores as an unapproved new revision", async () => {
  const f = await fixture();
  try {
    const first = await f.service.save(f.input, "owner");
    const second = await f.service.save({ ...first, team: "Corrected team" }, "owner");
    await assert.rejects(f.service.save({ ...first, team: "Stale overwrite" }, "owner"), /Reload/);
    const restored = await f.service.restore(
      { photoId: f.photoId, revision: second.revision, restoreRevision: 1 },
      "owner",
    );
    assert.equal(restored.team, "CCES");
    assert.equal(restored.revision, 3);
    assert.equal(restored.approved, false);
    assert.equal((await f.service.history(f.photoId)).length, 3);
    await assert.rejects(
      f.service.restore(
        { photoId: f.photoId, revision: second.revision, restoreRevision: 1 },
        "owner",
      ),
      /Reload/,
    );
    assert.equal((await f.service.history(f.photoId)).length, 3);
  } finally {
    await f.db.close();
  }
});

test("validation rejects malformed dates, excessive input, empty search and unsafe fields", async () => {
  const f = await fixture();
  try {
    for (const change of [
      { eventDate: "2026-02-30" },
      { team: "x".repeat(161) },
      { notes: "x".repeat(4001) },
      { jerseyNumber: "<script>" },
      { approved: "yes" },
      { revision: -1 },
      { originalKey: "invented" },
    ])
      assert.equal(metadataSchema.safeParse({ ...f.input, ...change }).success, false);
    assert.equal(metadataSchema.safeParse({ ...f.input, eventDate: "2024-02-29" }).success, true);
    for (const input of [
      { query: "" },
      { query: "x".repeat(101) },
      { query: "CCES", offset: -1 },
      { query: "CCES", offset: 1001 },
    ])
      await assert.rejects(f.service.search(input));
    await assert.rejects(f.service.save(f.input, "dev-user"), /Owner required/);
    await assert.rejects(
      f.service.save({ ...f.input, photoId: crypto.randomUUID() }, "owner"),
      /Photo missing/,
    );
    await assert.rejects(f.service.save({ ...f.input, revision: 7 }, "owner"), /Photo missing/);
  } finally {
    await f.db.close();
  }
});

test("search parameters are literal tokens rather than SQL or wildcard clauses", async () => {
  const f = await fixture();
  try {
    await f.service.save(f.input, "owner");
    assert.equal((await f.service.search({ query: "' OR 1=1 --" })).results.length, 0);
    assert.equal((await f.service.search({ query: "%" })).results.length, 0);
    assert.equal((await f.service.read(f.photoId)).team, "CCES");
  } finally {
    await f.db.close();
  }
});

test("HTTP boundary denies signed-out/non-owner metadata reads and writes before touching database", async () => {
  let databaseCalls = 0;
  for (const userId of [undefined, "customer", "dev-user"]) {
    for (const operation of ["read", "history", "save", "restore"]) {
      const method = operation === "save" || operation === "restore" ? "POST" : "GET";
      const response = await handleSportsRequest(
        new Request(`https://test.invalid/api/sports?op=${operation}`, {
          method,
          headers: { Origin: "https://test.invalid" },
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
        {
          owner: async () => assertCatalogOwner(userId, "owner"),
          service: async () => {
            databaseCalls++;
            throw new Error("Database must not be read");
          },
        },
      );
      assert.ok(response.status === 401 || response.status === 403);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  }
  assert.equal(databaseCalls, 0);
});

test("HTTP boundary enforces origin, body size, validation and sanitized errors", async () => {
  const f = await fixture();
  try {
    const deps = { owner: async () => "owner", service: async () => f.service };
    function post(body: string, origin = "https://test.invalid") {
      return handleSportsRequest(
        new Request("https://test.invalid/api/sports?op=save", {
          method: "POST",
          headers: { origin },
          body,
        }),
        deps,
      );
    }
    assert.equal((await post(JSON.stringify(f.input), "https://evil.invalid")).status, 403);
    assert.equal((await post("x".repeat(16385))).status, 413);
    assert.equal((await post("{")).status, 400);
    assert.equal((await post(JSON.stringify({ ...f.input, team: null }))).status, 400);
    assert.equal((await post(JSON.stringify(f.input))).status, 200);
    const searched = await handleSportsRequest(
      new Request("https://test.invalid/api/sports?q=CCES"),
      {
        ...deps,
        owner: async () => {
          throw new Error("Public search must not require login");
        },
      },
    );
    assert.equal(searched.status, 200);
    assert.equal((await searched.json()).results.length, 1);
    const unavailable = await handleSportsRequest(
      new Request("https://test.invalid/api/sports?q=CCES"),
      {
        ...deps,
        service: async () => {
          throw new Error("postgres://secret@database");
        },
      },
    );
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes("postgres"));
  } finally {
    await f.db.close();
  }
});

test("concurrent edits yield one winner and never a split history record", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.save(f.input, "owner");
    const updates = await Promise.allSettled([
      f.service.save({ ...initial, team: "First editor" }, "owner"),
      f.service.save({ ...initial, team: "Second editor" }, "owner"),
    ]);
    assert.equal(updates.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(updates.filter((row) => row.status === "rejected").length, 1);
    assert.equal((await f.service.read(f.photoId)).revision, 2);
    const history = await f.service.history(f.photoId);
    assert.equal(history.length, 2);
    assert.equal(history[0].team, (await f.service.read(f.photoId)).team);
    // A failed audit/history insert must roll back the metadata write too.
    await f.db.exec(`create function reject_sports_history() returns trigger language plpgsql as $$
      begin raise exception 'Audit write failure'; end; $$;
      create trigger reject_sports_history before insert on sports_metadata_history
      for each row execute function reject_sports_history();`);
    await assert.rejects(
      f.service.save({ ...initial, revision: 2, team: "Must roll back" }, "owner"),
      /Audit write failure/,
    );
    assert.equal((await f.service.read(f.photoId)).revision, 2);
    assert.equal((await f.service.history(f.photoId)).length, 2);
  } finally {
    await f.db.close();
  }
});

test("search pagination is bounded, deterministic, disjoint and access changes apply immediately", async () => {
  const f = await fixture();
  try {
    await f.service.save(f.input, "owner");
    for (let i = 0; i < 26; i++) {
      const id = crypto.randomUUID();
      await f.sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
        values(${id},${f.galleryId},'owner',${`fixture-${i}.jpg`},'image/jpeg',12,${`digest-${i}`},${`original-${i}`},'ready',100,100)`;
      for (const kind of ["thumb", "preview"])
        await f.sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
        values(${id},${kind},${`${id}-${kind}`},5,'digest')`;
      await f.service.save({ ...f.input, photoId: id }, "owner");
    }
    const first = await f.service.search({ query: "CCES" });
    assert.equal(first.results.length, 25);
    assert.equal(first.nextOffset, 25);
    const second = await f.service.search({ query: "CCES", offset: first.nextOffset });
    assert.equal(second.results.length, 2);
    assert.equal(second.nextOffset, null);
    assert.equal(new Set([...first.results, ...second.results].map((row) => row.photoId)).size, 27);
    assert.deepEqual(await f.service.search({ query: "CCES" }), first);
    await f.sql`update catalog_galleries set published=false where id=${f.galleryId}`;
    assert.equal((await f.service.search({ query: "CCES" })).results.length, 0);
  } finally {
    await f.db.close();
  }
});

test("event reuse persists only event fields and never copies personal metadata, identity, revision or approval", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const source = {
    ...emptyMetadata(crypto.randomUUID()),
    team: "Synthetic Hawks",
    sport: "Football",
    opponent: "Synthetic Owls",
    venue: "Fixture stadium",
    eventDate: "2026-09-03",
    jerseyNumber: "06",
    subject: "Do not copy this subject",
    notes: "Never remember private notes",
    approved: true,
    revision: 9,
  };
  assert.equal(rememberSavedEvent(storage, source), true);
  const raw = values.get(EVENT_REUSE_KEY)!;
  for (const field of ["photoId", "revision", "jerseyNumber", "subject", "notes", "approved"])
    assert.ok(!raw.includes(field));
  const current = {
    ...emptyMetadata(crypto.randomUUID()),
    jerseyNumber: "11",
    subject: "Preserve target subject",
    notes: "Preserve target notes",
    approved: true,
    revision: 3,
  };
  const remembered = readRememberedEvent(storage)!;
  assert.deepEqual(remembered, eventDetails(source));
  const result = applyRememberedEvent(current, remembered);
  assert.equal(result.team, "Synthetic Hawks");
  assert.equal(result.jerseyNumber, "11");
  assert.equal(result.subject, current.subject);
  assert.equal(result.notes, current.notes);
  assert.equal(result.photoId, current.photoId);
  assert.equal(result.revision, 3);
  assert.equal(result.approved, false);
  assert.equal(current.approved, true, "Applying a template must not mutate existing object");
  assert.equal(forgetRememberedEvent(storage), true);
  assert.equal(readRememberedEvent(storage), null);
  storage.setItem(EVENT_REUSE_KEY, JSON.stringify({ ...remembered, notes: "injected" }));
  assert.equal(readRememberedEvent(storage), null);
  storage.setItem(EVENT_REUSE_KEY, "malformed");
  assert.equal(readRememberedEvent(storage), null);
  const blocked = {
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
    removeItem: () => {
      throw new Error("Blocked");
    },
  };
  assert.equal(readRememberedEvent(blocked), null);
  assert.equal(rememberSavedEvent(blocked, source), false);
  assert.equal(forgetRememberedEvent(blocked), false);
});
