import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Sql } from "../db.ts";
import { recoverPayments, recoveryConfiguration } from "./recovery.ts";

test("recovery configuration binds key mode without requiring checkout or webhook secrets", () => {
  const values: Record<string, string> = {
    CATALOG_ENV: "staging",
    CATALOG_STRIPE_ACCOUNT_ID: "acct_fixture",
    CATALOG_STRIPE_SECRET_KEY: "sk_test_fixture",
  };
  const get = (key: string) => values[key] || "";
  assert.equal(recoveryConfiguration(get)?.config.environment, "staging");
  values.CATALOG_STRIPE_SECRET_KEY = "sk_live_fixture";
  assert.equal(recoveryConfiguration(get), undefined);
  values.CATALOG_ENV = "production";
  assert.equal(recoveryConfiguration(get), undefined);
  values.CATALOG_LIVE_STRIPE_ACCOUNT_ID = "acct_livefixture";
  values.CATALOG_LIVE_STRIPE_SECRET_KEY = "sk_live_fixture";
  assert.equal(recoveryConfiguration(get)?.config.taxMode, "stripe");
});

test("durable recovery retries failed effects, fences overlaps, retains pages and flags exhausted retries", async () => {
  const db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../../../migrations/0022_payment_recovery.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = Object.assign(
    async () => {
      throw new Error("query only");
    },
    {
      query: async <T>(text: string, params: unknown[] = []) =>
        (await db.query<T>(text, params)).rows,
    },
  ) as Sql;
  const stream = "staging:acct_fixture";
  let calls = 0;
  try {
    const result = await recoverPayments(sql, stream, {
      list: async () => ({ ids: ["evt_one", "evt_two"], more: true }),
      apply: async () => {
        calls++;
        throw new Error("secret provider details");
      },
    });
    assert.equal(result.failed, 2);
    assert.equal(calls, 2);
    assert.equal(
      (await sql.query<{ cursor: string }>("SELECT cursor FROM commerce_recovery_streams"))[0]
        .cursor,
      "evt_two",
    );
    assert.equal(
      (
        await sql.query<{ last_error: string }>(
          "SELECT last_error FROM commerce_recovery_events LIMIT 1",
        )
      )[0].last_error,
      "verification_or_provider_failure",
    );
    await db.exec("UPDATE commerce_recovery_events SET next_attempt_at=now()-interval '1 minute'");
    const retry = await recoverPayments(sql, stream, {
      list: async (_start, _end, cursor) => {
        assert.equal(cursor, "evt_two");
        const overlap = await recoverPayments(sql, stream, {
          list: async () => {
            throw new Error("must not run");
          },
          apply: async () => {},
        });
        assert.equal(overlap.busy, true);
        return { ids: [], more: false };
      },
      apply: async () => {
        calls++;
      },
    });
    assert.equal(retry.completed, 2);
    assert.equal(calls, 4);
    // Re-discovered events cannot issue a second effect once marked complete.
    await recoverPayments(sql, stream, {
      list: async () => ({ ids: ["evt_one"], more: false }),
      apply: async () => {
        throw new Error("duplicate");
      },
    });
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "SELECT status FROM commerce_recovery_events WHERE event_id='evt_one'",
        )
      )[0].status,
      "complete",
    );
    await db.exec(
      "UPDATE commerce_recovery_events SET status='pending',attempts=9,next_attempt_at=now() WHERE event_id='evt_two'",
    );
    await recoverPayments(sql, stream, {
      list: async () => ({ ids: [], more: false }),
      apply: async () => {
        throw new Error("outage");
      },
    });
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "SELECT status FROM commerce_recovery_events WHERE event_id='evt_two'",
        )
      )[0].status,
      "review",
    );
    const before = await sql.query(
      "SELECT window_start,window_end,cursor FROM commerce_recovery_streams",
    );
    await assert.rejects(
      recoverPayments(sql, stream, {
        list: async () => {
          throw new Error("outage");
        },
        apply: async () => {},
      }),
    );
    assert.deepEqual(
      await sql.query("SELECT window_start,window_end,cursor FROM commerce_recovery_streams"),
      before,
    );
    await db.exec("UPDATE commerce_recovery_streams SET window_start=1");
    await assert.rejects(
      recoverPayments(sql, stream, {
        list: async () => ({ ids: [], more: false }),
        apply: async () => {},
      }),
      /retention gap/,
    );
  } finally {
    await db.close();
  }
});
