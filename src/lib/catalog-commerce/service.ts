import { z } from "zod";
import type { Sql } from "../db.ts";
import { encodeCursor, pageInput, pageResult } from "../api/pagination.ts";

const id = z.string().trim().min(1).max(150);
const selection = z
  .object({ productId: id, photoId: id, quantity: z.number().int().min(1).max(99) })
  .strict();
const quoteInput = z
  .object({
    galleryId: id,
    items: z.array(selection).min(1).max(100),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,40}$/)
      .optional(),
  })
  .strict();

export interface QuoteItem {
  productId: string;
  photoId: string;
  name: string;
  kind: "digital_photo";
  license: string;
  filename: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
}
export interface Quote {
  id: string;
  customer_id: string;
  gallery_id: string;
  items: QuoteItem[];
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: "usd";
  expires_at: string | Date;
  status: "open" | "ordered" | "expired";
}
export interface Order {
  id: string;
  quote_id: string;
  customer_id: string;
  status: "pending" | "paid" | "failed" | "refunded" | "review";
  provider_session_id: string | null;
  provider_payment_id: string | null;
}
export interface VerifiedPayment {
  eventId: string;
  orderId: string;
  kind: "paid" | "failed" | "refunded";
  sessionId: string;
  paymentId: string;
  amountCents: number;
  currency: "usd";
}

async function sha256(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Server-only domain. Callers authenticate the actor and enforce owner roles.
 * Gallery access callback MUST validate current password grants before quoting.
 * No request is trusted to supply price, license, name, tax or payment status.
 * Taxes/shipping/provider checkout are intentionally NOT ready in this slice.
 */
export function createCommerce(sql: Sql, authorizeGallery: (galleryId: string) => Promise<number>) {
  return {
    async configurePriceList(input: unknown) {
      const data = z
        .object({ id, name: z.string().trim().min(1).max(120), isDefault: z.boolean() })
        .strict()
        .parse(input);
      const [row] = await sql.query(
        `INSERT INTO commerce_price_lists(id,name,is_default) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_default=excluded.is_default RETURNING *`,
        [data.id, data.name, data.isDefault],
      );
      return row;
    },
    async configureProduct(input: unknown) {
      // Prints can be modeled in SQL but may not be enabled through this API yet.
      const data = z
        .object({
          id,
          name: z.string().trim().min(1).max(160),
          license: z.string().trim().min(1).max(4000),
          active: z.boolean(),
        })
        .strict()
        .parse(input);
      const [row] = await sql.query(
        `INSERT INTO commerce_products(id,name,kind,license,active) VALUES($1,$2,'digital_photo',$3,$4)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,license=excluded.license,active=excluded.active
        WHERE commerce_products.kind='digital_photo' RETURNING *`,
        [data.id, data.name, data.license, data.active],
      );
      if (!row) throw new Error("Product kind cannot be changed");
      return row;
    },
    async configurePrice(input: unknown) {
      const data = z
        .object({
          priceListId: id,
          productId: id,
          unitCents: z.number().int().min(1).max(10000000),
        })
        .strict()
        .parse(input);
      await sql.query(
        `INSERT INTO commerce_prices(price_list_id,product_id,unit_cents) VALUES($1,$2,$3)
        ON CONFLICT(price_list_id,product_id) DO UPDATE SET unit_cents=excluded.unit_cents`,
        [data.priceListId, data.productId, data.unitCents],
      );
    },
    async assignGalleryPriceList(galleryId: string, priceListId: string | null) {
      id.parse(galleryId);
      if (priceListId === null)
        await sql.query(`DELETE FROM commerce_gallery_prices WHERE gallery_id=$1`, [galleryId]);
      else
        await sql.query(
          `INSERT INTO commerce_gallery_prices(gallery_id,price_list_id) VALUES($1,$2)
        ON CONFLICT(gallery_id) DO UPDATE SET price_list_id=excluded.price_list_id`,
          [galleryId, id.parse(priceListId)],
        );
    },
    async configureCoupon(input: unknown) {
      const data = z
        .object({
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9_-]{3,40}$/),
          percentOff: z.number().int().min(1).max(100),
          maxUses: z.number().int().positive(),
          minimumCents: z.number().int().min(0),
          galleryId: id.nullable(),
          expiresAt: z.string().datetime(),
          active: z.boolean(),
        })
        .strict()
        .parse(input);
      // Reconfiguring an existing code is forbidden: it would change live reservations.
      await sql.query(
        `INSERT INTO commerce_coupons(code,percent_off,max_uses,minimum_cents,gallery_id,expires_at,active)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          data.code,
          data.percentOff,
          data.maxUses,
          data.minimumCents,
          data.galleryId,
          data.expiresAt,
          data.active,
        ],
      );
    },
    async quote(customerId: string, input: unknown): Promise<Quote> {
      id.parse(customerId);
      const data = quoteInput.parse(input);
      const authorizedRevision = await authorizeGallery(data.galleryId);
      z.number().int().positive().parse(authorizedRevision);
      const [row] = await sql.query<Quote>(
        `SELECT * FROM commerce_create_quote($1,$2,$3,$4::jsonb,$5,$6)`,
        [
          crypto.randomUUID(),
          customerId,
          data.galleryId,
          JSON.stringify(data.items),
          data.couponCode ?? null,
          authorizedRevision,
        ],
      );
      return row;
    },
    async orderForQuote(customerId: string, quoteId: string): Promise<Order> {
      id.parse(customerId);
      id.parse(quoteId);
      const [q] = await sql.query<{ gallery_id: string }>(
        `SELECT gallery_id FROM commerce_quotes WHERE id=$1 AND customer_id=$2`,
        [quoteId, customerId],
      );
      if (!q) throw new Error("Quote unavailable");
      await authorizeGallery(q.gallery_id);
      const [row] = await sql.query<Order>(`SELECT * FROM commerce_create_order($1,$2,$3)`, [
        crypto.randomUUID(),
        quoteId,
        customerId,
      ]);
      return row;
    },
    async customerOrders(customerId: string, params: URLSearchParams) {
      id.parse(customerId);
      const scope = `orders:${customerId}`;
      const { limit, cursor } = pageInput(params, scope);
      if (cursor && (typeof cursor.sort !== "string" || !Number.isFinite(Date.parse(cursor.sort))))
        throw new Error("Invalid order cursor");
      const rows = await sql.query<{
        id: string;
        status: string;
        created_at: string | Date;
        total_cents: number;
        currency: string;
      }>(
        `SELECT o.id,o.status,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,q.total_cents,q.currency
         FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id
         WHERE o.customer_id=$1 AND ($2::timestamptz IS NULL OR (o.created_at,o.id)<($2::timestamptz,$3::text))
         ORDER BY o.created_at DESC,o.id DESC LIMIT $4`,
        [customerId, cursor?.sort ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageResult(rows, limit, (row) =>
        encodeCursor({ scope, id: row.id, sort: String(row.created_at) }),
      );
    },
    async customerOrder(customerId: string, orderId: string) {
      id.parse(customerId);
      id.parse(orderId);
      const [row] = await sql.query<
        Order & { items: QuoteItem[]; total_cents: number; currency: string }
      >(
        `SELECT o.id,o.quote_id,o.customer_id,o.status,o.created_at,o.updated_at,o.paid_at,
          q.items,q.subtotal_cents,q.discount_cents,q.shipping_cents,q.tax_cents,q.total_cents,q.currency
         FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE o.id=$1 AND o.customer_id=$2`,
        [orderId, customerId],
      );
      if (!row) throw new Error("Order unavailable");
      const entitlements = await sql.query(
        `SELECT id,photo_id,expires_at,downloads,max_downloads,revoked_at
         FROM commerce_entitlements WHERE order_id=$1 AND customer_id=$2 ORDER BY id LIMIT 100`,
        [orderId, customerId],
      );
      return { ...row, entitlements };
    },
    /** Internal provider adapter only, after creating a provider session with
     * the order ID as idempotency key and server quote snapshots as line items.
     */
    async bindProviderSession(orderId: string, sessionId: string) {
      id.parse(orderId);
      id.parse(sessionId);
      const [row] = await sql.query<Order>(
        `UPDATE commerce_orders SET provider_session_id=$2,updated_at=now()
        WHERE id=$1 AND status='pending' AND (provider_session_id IS NULL OR provider_session_id=$2) RETURNING *`,
        [orderId, sessionId],
      );
      if (!row) throw new Error("Order session cannot be replaced");
      return row;
    },
    /** NO public handler may call this with browser JSON. Only a cryptographically
     * verified, correct-account/correct-environment provider event may enter here.
     * Partial refunds/disputes remain unsupported and must not be acknowledged.
     */
    async applyVerifiedPayment(input: VerifiedPayment) {
      const event = z
        .object({
          eventId: id,
          orderId: id,
          kind: z.enum(["paid", "failed", "refunded"]),
          sessionId: id,
          paymentId: id,
          amountCents: z.number().int().min(0).max(100000000),
          currency: z.literal("usd"),
        })
        .strict()
        .parse(input);
      const [row] = await sql.query<Order>(
        `SELECT * FROM commerce_apply_payment($1,$2,$3,$4,$5,$6,$7)`,
        [
          event.eventId,
          event.orderId,
          event.kind,
          event.sessionId,
          event.paymentId,
          event.amountCents,
          event.currency,
        ],
      );
      return row;
    },
    async issueDownloadToken(customerId: string, entitlementId: string) {
      id.parse(customerId);
      z.string().min(1).max(350).parse(entitlementId);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const [row] = await sql.query<{ expires_at: string | Date }>(
        `UPDATE commerce_entitlements e SET token_hash=$3
        WHERE e.id=$1 AND e.customer_id=$2 AND e.revoked_at IS NULL AND e.expires_at>now() AND e.downloads<e.max_downloads
        AND EXISTS(SELECT 1 FROM commerce_orders o WHERE o.id=e.order_id AND o.status='paid') RETURNING e.expires_at`,
        [entitlementId, customerId, await sha256(token)],
      );
      if (!row) throw new Error("Download unavailable");
      return { token, expiresAt: row.expires_at };
    },
    /** Returns a PRIVATE object key for a server streaming adapter, never a public
     * URL. Token and customer ID are both required. Each successful reservation
     * consumes one attempt, even if the subsequent storage transfer fails.
     */
    async reserveDownload(customerId: string, token: string) {
      void customerId;
      void token;
      throw new Error(
        "Download unavailable: legacy reservation disabled; use verified customer delivery",
      );
    },
    async revokeEntitlement(entitlementId: string) {
      z.string().min(1).max(350).parse(entitlementId);
      await sql.query(
        `UPDATE commerce_entitlements SET revoked_at=COALESCE(revoked_at,now()),token_hash=NULL WHERE id=$1`,
        [entitlementId],
      );
    },
  };
}
