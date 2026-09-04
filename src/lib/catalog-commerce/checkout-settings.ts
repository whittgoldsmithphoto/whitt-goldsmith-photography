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
    (setting("CATALOG_STRIPE_TAX_MODE") === "stripe" &&
      !/^txcd_[0-9]{8}$/.test(setting("CATALOG_STRIPE_DIGITAL_TAX_CODE"))) ||
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
    ...(setting("CATALOG_STRIPE_TAX_MODE") === "stripe"
      ? {
          taxMode: "stripe" as const,
          digitalTaxCode: setting("CATALOG_STRIPE_DIGITAL_TAX_CODE"),
        }
      : {}),
  };
}

/** Separate live credentials and explicit release approval; never reuse test flags. */
export function liveCheckoutSettings(
  setting: (name: string) => string,
  cancellationOnly = false,
): CheckoutConfiguration | undefined {
  if (
    setting("CATALOG_ENV") !== "production" ||
    setting("CATALOG_LIVE_RELEASE_ACCEPTED") !== "true" ||
    setting("CATALOG_LIVE_TAX_ACCEPTED") !== "true" ||
    setting("CATALOG_LIVE_DELIVERY_ACCEPTED") !== "true" ||
    (!cancellationOnly && setting("CATALOG_LIVE_CHECKOUT_ENABLED") !== "true") ||
    (!cancellationOnly && setting("CATALOG_LIVE_WEBHOOK_ENABLED") !== "true") ||
    (!cancellationOnly && setting("CATALOG_LIVE_DOWNLOADS_ENABLED") !== "true") ||
    !/^sk_live_[A-Za-z0-9_]+$/.test(setting("CATALOG_LIVE_STRIPE_SECRET_KEY")) ||
    !/^whsec_[A-Za-z0-9_]+$/.test(setting("CATALOG_LIVE_STRIPE_WEBHOOK_SECRET")) ||
    !/^acct_[A-Za-z0-9]+$/.test(setting("CATALOG_LIVE_STRIPE_ACCOUNT_ID")) ||
    !/^txcd_[0-9]{8}$/.test(setting("CATALOG_STRIPE_DIGITAL_TAX_CODE"))
  )
    return;
  const origin = setting("BETTER_AUTH_URL");
  try {
    if (
      new URL(origin).origin !== origin ||
      !origin.startsWith("https://") ||
      /staging/i.test(origin)
    )
      return;
  } catch {
    return;
  }
  return {
    environment: "production",
    checkoutEnabled: setting("CATALOG_LIVE_CHECKOUT_ENABLED") === "true",
    deliveryAccepted: true,
    sandboxTaxFixtureAccepted: true,
    taxMode: "stripe",
    liveAccepted: true,
    digitalTaxCode: setting("CATALOG_STRIPE_DIGITAL_TAX_CODE"),
    secretKey: setting("CATALOG_LIVE_STRIPE_SECRET_KEY"),
    accountId: setting("CATALOG_LIVE_STRIPE_ACCOUNT_ID"),
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
