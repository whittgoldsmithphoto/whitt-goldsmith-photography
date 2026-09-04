import type { Sql } from "../db.ts";
import type { SandboxWebhookConfig, LiveWebhookConfig } from "./stripe-adapter.ts";

/** API recovery needs an account key, not a webhook signing secret. */
export function recoveryConfiguration(setting: (key: string) => string) {
  const environment = setting("CATALOG_ENV");
  if (!["staging", "production"].includes(environment)) return;
  const live = environment === "production";
  const secretKey = setting(live ? "CATALOG_LIVE_STRIPE_SECRET_KEY" : "CATALOG_STRIPE_SECRET_KEY");
  const account = setting(live ? "CATALOG_LIVE_STRIPE_ACCOUNT_ID" : "CATALOG_STRIPE_ACCOUNT_ID");
  if (
    !(live ? /^sk_live_[A-Za-z0-9_]+$/ : /^sk_test_[A-Za-z0-9_]+$/).test(secretKey) ||
    !/^acct_[A-Za-z0-9]+$/.test(account)
  )
    return;
  const config: SandboxWebhookConfig | LiveWebhookConfig = live
    ? {
        environment: "production",
        expectedLivemode: true,
        expectedAccountId: account,
        webhookSecret: "",
        taxMode: "stripe",
      }
    : {
        environment: "staging",
        expectedLivemode: false,
        expectedAccountId: account,
        webhookSecret: "",
        ...(setting("CATALOG_STRIPE_TAX_MODE") === "stripe" ? { taxMode: "stripe" as const } : {}),
      };
  return { config, secretKey };
}

export const recoveryEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
];
type Stream = { window_start: number; window_end: number; cursor: string | null };
export interface RecoveryProvider {
  list(start: number, end: number, cursor?: string): Promise<{ ids: string[]; more: boolean }>;
  apply(id: string): Promise<unknown>;
}

/** One bounded page and ten deliveries per invocation. A fenced lease serializes
 * discovery. IDs enter the durable inbox BEFORE the page cursor advances.
 * Failed effects can replay safely through the existing payment ledger.
 */
export async function recoverPayments(
  sql: Sql,
  streamId: string,
  provider: RecoveryProvider,
  now = Math.floor(Date.now() / 1000),
) {
  if (!/^(staging|production):acct_[A-Za-z0-9]+$/.test(streamId))
    throw new Error("Invalid recovery stream");
  const end = now - 120;
  await sql.query(
    `INSERT INTO commerce_recovery_streams(id,window_start,window_end)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [streamId, end - 86400, end],
  );
  const token = crypto.randomUUID();
  const [stream] = await sql.query<Stream>(
    `UPDATE commerce_recovery_streams
    SET lease_token=$2,lease_until=now()+interval '5 minutes'
    WHERE id=$1 AND (lease_until IS NULL OR lease_until<now())
    RETURNING window_start,window_end,cursor`,
    [streamId, token],
  );
  if (!stream) return { busy: true, completed: 0, failed: 0 };
  let completed = 0,
    failed = 0;
  try {
    // Stripe retains events for 30 days. Never silently jump over a retention gap.
    if (stream.window_start < now - 29 * 86400)
      throw new Error("Recovery retention gap requires review");
    const page = await provider.list(
      stream.window_start,
      stream.window_end,
      stream.cursor || undefined,
    );
    if (
      page.ids.length > 100 ||
      page.ids.some((id) => !/^evt_[A-Za-z0-9]+$/.test(id)) ||
      (page.more && (!page.ids.length || page.ids.at(-1) === stream.cursor))
    )
      throw new Error("Invalid recovery page");
    if (page.ids.length)
      await sql.query(
        `INSERT INTO commerce_recovery_events(stream_id,event_id)
      SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [streamId, page.ids],
      );
    // An expired holder cannot move the cursor of a replacement worker.
    const moved = await sql.query(
      `UPDATE commerce_recovery_streams SET
      cursor=$3,window_start=$4,window_end=$5,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND lease_until>now() RETURNING id`,
      [
        streamId,
        token,
        page.more ? page.ids.at(-1) : null,
        page.more ? stream.window_start : stream.window_end,
        page.more ? stream.window_end : Math.max(stream.window_end, end),
      ],
    );
    if (!moved.length) throw new Error("Recovery lease expired");
    const events = await sql.query<{ event_id: string; attempts: number }>(
      `SELECT event_id,attempts FROM commerce_recovery_events
       WHERE stream_id=$1 AND status='pending' AND next_attempt_at<=now()
       ORDER BY next_attempt_at,event_id LIMIT 10`,
      [streamId],
    );
    for (const event of events) {
      try {
        await provider.apply(event.event_id);
        await sql.query(
          `UPDATE commerce_recovery_events SET status='complete',last_error=NULL,
          attempts=attempts+1,updated_at=now() WHERE stream_id=$1 AND event_id=$2`,
          [streamId, event.event_id],
        );
        completed++;
      } catch {
        // Never log/store provider payloads, credentials or SQL exception text.
        await sql.query(
          `UPDATE commerce_recovery_events SET attempts=attempts+1,
          status=CASE WHEN attempts>=9 THEN 'review' ELSE 'pending' END,
          next_attempt_at=now()+interval '5 minutes',last_error='verification_or_provider_failure',updated_at=now()
          WHERE stream_id=$1 AND event_id=$2 AND status='pending'`,
          [streamId, event.event_id],
        );
        failed++;
      }
    }
    return { busy: false, completed, failed };
  } finally {
    await sql.query(
      `UPDATE commerce_recovery_streams SET lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2`,
      [streamId, token],
    );
  }
}
