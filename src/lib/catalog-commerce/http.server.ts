import { getSql } from "../db";
import { getSessionUser } from "../auth/verify.server";
import { assertCatalogOwner } from "../catalog/owner";
import { createCatalog, CatalogError } from "../catalog/repository";
import { catalogMedia, runtimeSetting } from "../catalog/media.server";
import { commerceHeaders, createCommerceHandler } from "./http";
import { createSandboxCheckout, stripeCheckoutProvider } from "./checkout.server";
import {
  consumeCheckoutAttempt,
  sandboxCheckoutSettings,
  liveCheckoutSettings,
} from "./checkout-settings";
import { z } from "zod";

export async function commerceRequest(request: Request) {
  try {
    const sql = await getSql();
    const catalog = createCatalog(sql, catalogMedia());
    async function user() {
      const account = await getSessionUser();
      if (!account || account.id === "dev-user") throw new CatalogError("Sign in to continue", 401);
      return account.id;
    }
    const authorizeGallery = async (galleryId: string) => {
      const name = `wgp-gallery-${galleryId}=`;
      const token = request.headers
        .get("cookie")
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(name))
        ?.slice(name.length);
      return (await catalog.detail(galleryId, token)).gallery.revision;
    };
    const config = sandboxCheckoutSettings(runtimeSetting);
    const liveConfig = liveCheckoutSettings(runtimeSetting);
    const cancelConfig =
      sandboxCheckoutSettings(runtimeSetting, true) ?? liveCheckoutSettings(runtimeSetting, true);
    const cancellation = cancelConfig
      ? createSandboxCheckout(
          sql,
          authorizeGallery,
          cancelConfig,
          stripeCheckoutProvider(cancelConfig),
        )
      : undefined;
    const cancel = cancellation
      ? async (customerId: string, input: unknown) => {
          const { orderId } = z.object({ orderId: z.string().uuid() }).strict().parse(input);
          const [order] = await sql.query<{ quote_id: string }>(
            "SELECT quote_id FROM commerce_orders WHERE id=$1 AND customer_id=$2",
            [orderId, customerId],
          );
          if (!order) throw new CatalogError("Order unavailable", 404);
          return cancellation.cancel(customerId, { quoteId: order.quote_id });
        }
      : undefined;
    return await createCommerceHandler({
      sql,
      user,
      owner: async () => assertCatalogOwner(await user(), runtimeSetting("OWNER_USER_IDS")),
      authorizeGallery,
      sandboxCheckout: config
        ? createSandboxCheckout(sql, authorizeGallery, config, stripeCheckoutProvider(config))
        : undefined,
      liveCheckout: liveConfig
        ? createSandboxCheckout(
            sql,
            authorizeGallery,
            liveConfig,
            stripeCheckoutProvider(liveConfig),
          )
        : undefined,
      sandboxCancel: cancelConfig?.environment === "staging" ? cancel : undefined,
      liveCancel: cancelConfig?.environment === "production" ? cancel : undefined,
      checkoutAttempt: (customerId) => consumeCheckoutAttempt(sql, customerId),
    })(request);
  } catch {
    return Response.json(
      { error: "Commerce service is unavailable" },
      { status: 503, headers: commerceHeaders },
    );
  }
}
