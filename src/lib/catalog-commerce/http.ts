import { z, ZodError } from "zod";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";

export const commerceHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export interface CommerceDependencies {
  sql: Sql;
  user(): Promise<string>;
  owner(): Promise<string>;
  authorizeGallery(galleryId: string): Promise<number>;
}

/** Injectable boundary tested with real Requests and a real PostgreSQL engine.
 * There is intentionally NO endpoint accepting payment state or original keys.
 */
export function createCommerceHandler(deps: CommerceDependencies) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: commerceHeaders });
    try {
      const url = new URL(request.url);
      const op = url.searchParams.get("op") || "status";
      const commerce = createCommerce(deps.sql, deps.authorizeGallery);
      if (request.method === "GET") {
        if (op === "status")
          return json({
            checkoutAvailable: false,
            reason: "Stripe, tax and fulfillment acceptance checks are incomplete.",
            quoteOnly: true,
          });
        if (op === "owner") {
          await deps.owner();
          const [products, priceLists, prices, galleryPrices, coupons, orders] = await Promise.all([
            deps.sql.query(`SELECT * FROM commerce_products ORDER BY name,id LIMIT 500`),
            deps.sql.query(`SELECT * FROM commerce_price_lists ORDER BY name,id LIMIT 500`),
            deps.sql.query(
              `SELECT * FROM commerce_prices ORDER BY price_list_id,product_id LIMIT 1000`,
            ),
            deps.sql.query(`SELECT * FROM commerce_gallery_prices ORDER BY gallery_id LIMIT 1000`),
            deps.sql.query(
              `SELECT code,percent_off,max_uses,consumed,minimum_cents,gallery_id,expires_at,active FROM commerce_coupons ORDER BY code LIMIT 500`,
            ),
            deps.sql.query(
              `SELECT o.id,o.status,o.created_at,q.total_cents,q.currency FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id ORDER BY o.created_at DESC LIMIT 100`,
            ),
          ]);
          return json({
            products,
            priceLists,
            prices,
            galleryPrices,
            coupons,
            orders,
            checkoutAvailable: false,
          });
        }
        if (op === "order")
          return json(
            await commerce.customerOrder(await deps.user(), url.searchParams.get("id") || ""),
          );
        return json({ error: "Unknown commerce operation" }, 404);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (request.headers.get("origin") !== url.origin)
        return json({ error: "Same-origin request required" }, 403);
      if (!(request.headers.get("content-type") || "").startsWith("application/json"))
        return json({ error: "JSON required" }, 415);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Request body required" }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 32768) {
          await reader.cancel();
          return json({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
      const all = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(all));
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (op === "quote")
        return json({
          quote: await commerce.quote(await deps.user(), body),
          checkoutAvailable: false,
          notice:
            "Quote preview only. Tax assessment and Stripe acceptance are not configured; this is not a purchasable offer.",
        });
      if (op === "checkout") {
        await deps.user();
        return json(
          {
            error: "Checkout is disabled until Stripe, tax and fulfillment acceptance checks pass.",
          },
          503,
        );
      }
      if (
        ![
          "product",
          "price-list",
          "price",
          "gallery-price",
          "coupon",
          "revoke-entitlement",
        ].includes(op)
      )
        return json({ error: "Unknown commerce operation" }, 404);
      await deps.owner();
      if (op === "product") return json(await commerce.configureProduct(body));
      if (op === "price-list") return json(await commerce.configurePriceList(body));
      if (op === "price") await commerce.configurePrice(body);
      if (op === "coupon") await commerce.configureCoupon(body);
      if (op === "gallery-price") {
        const input = z
          .object({ galleryId: z.string(), priceListId: z.string().nullable() })
          .strict()
          .parse(body);
        await commerce.assignGalleryPriceList(input.galleryId, input.priceListId);
      }
      if (op === "revoke-entitlement") {
        const input = z.object({ entitlementId: z.string() }).strict().parse(body);
        await commerce.revokeEntitlement(input.entitlementId);
      }
      return json({ ok: true });
    } catch (error) {
      const failure = error as { status?: number; code?: string; message?: string };
      if (failure.status && [401, 403, 404, 409, 429, 503].includes(failure.status))
        return json({ error: failure.message }, failure.status);
      if (error instanceof ZodError)
        return json(
          { error: "Invalid commerce input. Check required fields and integer cents." },
          400,
        );
      if (failure.code === "42P01" || failure.code === "42883")
        return json({ error: "Commerce database migration is not installed." }, 503);
      if (failure.code === "23505")
        return json(
          {
            error:
              "This record already exists or conflicts with an existing default or reservation.",
          },
          409,
        );
      // Never return SQL statements, storage keys or provider/database diagnostics.
      return json(
        { error: "Commerce request could not be completed. Check availability and try again." },
        400,
      );
    }
  };
}
