import type { CheckoutConfiguration } from "./checkout.server.ts";
import type { Sql } from "../db.ts";

/** A deliberately separate owner-only sandbox acceptance switch. Never infers live readiness. */
export function sandboxCheckoutSettings(
  setting: (name: string) => string,
  cancellationOnly = false,
): CheckoutConfiguration | undefined {
  const origin = setting("BETTER_AUTH_URL");
  if (
    setting("CATALOG_ENV") !== "staging" ||
    (!cancellationOnly && setting("CATALOG_CHECKOUT_SANDBOX_ENABLED") !== "true") ||
    (!cancellationOnly && setting("CATALOG_CHECKOUT_DELIVERY_FIXTURE_ACCEPTED") !== "true") ||
    (!cancellationOnly && setting("CATALOG_CHECKOUT_TAX_FIXTURE_ACCEPTED") !== "true") ||
    (!cancellationOnly && setting("CATALOG_STRIPE_WEBHOOK_ENABLED") !== "true") ||
    !/^sk_test_[A-Za-z0-9_]+$/.test(setting("CATALOG_STRIPE_SECRET_KEY")) ||
    (!cancellationOnly &&
      !/^whsec_[A-Za-z0-9_]+$/.test(setting("CATALOG_STRIPE_WEBHOOK_SECRET"))) ||
    !/^acct_[A-Za-z0-9]+$/.test(setting("CATALOG_STRIPE_ACCOUNT_ID"))
  )
    return;
  try {
    if (new URL(origin).origin !== origin || !origin.startsWith("https://")) return;
  } catch {
    return;
  }
  return {
    environment: "staging",
    checkoutEnabled: setting("CATALOG_CHECKOUT_SANDBOX_ENABLED") === "true",
    deliveryAccepted: setting("CATALOG_CHECKOUT_DELIVERY_FIXTURE_ACCEPTED") === "true",
    sandboxTaxFixtureAccepted: setting("CATALOG_CHECKOUT_TAX_FIXTURE_ACCEPTED") === "true",
    secretKey: setting("CATALOG_STRIPE_SECRET_KEY"),
    accountId: setting("CATALOG_STRIPE_ACCOUNT_ID"),
    origin,
  };
}

export async function consumeCheckoutAttempt(sql: Sql, customerId: string) {
  const [row] = await sql.query<{ allowed: boolean }>(
    "SELECT commerce_checkout_attempt($1) AS allowed",
    [customerId],
  );
  if (!row?.allowed)
    throw Object.assign(new Error("Too many checkout attempts. Try again in ten minutes."), {
      status: 429,
    });
}
