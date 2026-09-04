import {
  acceptSandboxWebhook,
  CommerceWebhookError,
  type SandboxWebhookConfig,
  type SandboxCommerce,
  type SandboxProvider,
} from "./stripe-adapter.ts";

export function createSandboxWebhookHandler(
  config: SandboxWebhookConfig | undefined,
  provider: SandboxProvider,
  commerce: SandboxCommerce,
) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    if (!config) return respond({ error: "Catalog sandbox webhook is disabled" }, 503);
    if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    const signature = request.headers.get("stripe-signature");
    if (!signature || signature.length > 4096)
      return respond({ error: "Invalid webhook signature" }, 400);
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: "Webhook body required" }, 400);
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 262144) {
          await reader.cancel();
          return respond({ error: "Webhook body too large" }, 413);
        }
        chunks.push(value);
      }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      return respond(
        await acceptSandboxWebhook(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
          signature,
          config,
          provider,
          commerce,
        ),
      );
    } catch (error) {
      if (error instanceof CommerceWebhookError)
        return respond({ error: error.message }, error.status);
      // Retry provider/storage failures. Never leak raw events, keys, SQL or tokens.
      return respond(
        { error: "Sandbox webhook processing failed; no successful acknowledgment was recorded" },
        503,
      );
    }
  };
}

/** Missing/production/live settings always keep this isolated endpoint closed. */
export function sandboxWebhookConfiguration(
  setting: (name: string) => string,
): SandboxWebhookConfig | undefined {
  if (
    setting("CATALOG_ENV") !== "staging" ||
    setting("CATALOG_STRIPE_WEBHOOK_ENABLED") !== "true" ||
    !setting("CATALOG_STRIPE_SECRET_KEY").startsWith("sk_test_") ||
    !setting("CATALOG_STRIPE_WEBHOOK_SECRET").startsWith("whsec_") ||
    !/^acct_[A-Za-z0-9]+$/.test(setting("CATALOG_STRIPE_ACCOUNT_ID"))
  )
    return undefined;
  return {
    webhookSecret: setting("CATALOG_STRIPE_WEBHOOK_SECRET"),
    expectedAccountId: setting("CATALOG_STRIPE_ACCOUNT_ID"),
    expectedLivemode: false,
    environment: "staging",
  };
}
