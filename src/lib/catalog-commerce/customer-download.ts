import { z } from "zod";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";

const maxOriginalBytes = 20 * 1024 * 1024;
export class CustomerDownloadError extends Error {
  status: number;
  constructor(message = "Download unavailable", status = 404) {
    super(message);
    this.status = status;
  }
}
interface DownloadRow {
  id: string;
  photo_id: string;
  gallery_id: string;
  filename: string;
  mime: string;
  bytes: number;
  checksum: string;
  original_key: string;
  revision: number;
  download_policy: string;
  expires_at: string | Date;
}
export interface CustomerDownloadDependencies {
  sql: Sql;
  user(): Promise<string>;
  authorizeGallery(id: string): Promise<number>;
  galleryGrantHash(id: string): Promise<string | null>;
  /** Runtime implementation MUST bound storage reads to maxOriginalBytes. */
  readOriginal(key: string, expectedBytes: number, expectedChecksum: string): Promise<Uint8Array>;
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const fields = `e.id,e.photo_id,e.expires_at,p.gallery_id,p.filename,p.mime,p.bytes,p.checksum,p.original_key,g.revision,g.download_policy`;
const eligible = `FROM commerce_entitlements e JOIN commerce_orders o ON o.id=e.order_id
  JOIN catalog_photos p ON p.id=e.photo_id JOIN catalog_galleries g ON g.id=p.gallery_id
  WHERE e.customer_id=$1 AND o.customer_id=$1 AND o.status='paid' AND e.revoked_at IS NULL AND e.expires_at>now() AND e.downloads<e.max_downloads
  AND p.status='ready' AND NOT p.hidden AND NOT p.archived AND g.published AND g.visibility<>'private' AND g.download_policy='purchased_only'`;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function customerDownloadsEnabled(setting: (name: string) => string) {
  if (setting("CATALOG_ENV") === "production")
    return (
      setting("CATALOG_LIVE_DOWNLOADS_ENABLED") === "true" &&
      setting("CATALOG_LIVE_RELEASE_ACCEPTED") === "true" &&
      setting("CATALOG_LIVE_DELIVERY_ACCEPTED") === "true"
    );
  return (
    setting("CATALOG_ENV") === "staging" &&
    setting("CATALOG_CUSTOMER_DOWNLOADS_ENABLED") === "true" &&
    setting("CATALOG_STRIPE_SANDBOX_ACCEPTED") === "true"
  );
}
/** No token, original object key or secret ever belongs in a query string. */
export function createCustomerDownloadHandler(
  enabled: boolean,
  deps: CustomerDownloadDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (!enabled)
      return json(
        { error: "Purchased download delivery is disabled pending sandbox acceptance" },
        503,
      );
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.search) return json({ error: "Use the request body, not query parameters" }, 400);
    if (request.headers.get("origin") !== url.origin)
      return json({ error: "Same-origin request required" }, 403);
    if (!(request.headers.get("content-type") || "").startsWith("application/json"))
      return json({ error: "JSON required" }, 415);
    try {
      const customer = await deps.user();
      if (!customer || customer === "dev-user")
        throw new CustomerDownloadError("Sign in to download", 401);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Request body required" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
          await reader.cancel();
          return json({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const id = z.string().min(1).max(350);
      const input = z
        .discriminatedUnion("op", [
          z.object({ op: z.literal("list"), galleryId: id }).strict(),
          z.object({ op: z.literal("issue"), entitlementId: id }).strict(),
          z
            .object({ op: z.literal("deliver"), token: z.string().regex(/^[0-9a-f]{64}$/) })
            .strict(),
        ])
        .parse(raw);
      if (input.op === "list") {
        const revision = await deps.authorizeGallery(input.galleryId);
        const rows = await deps.sql.query<
          Pick<DownloadRow, "id" | "photo_id" | "filename" | "expires_at">
        >(
          `SELECT e.id,e.photo_id,p.filename,e.expires_at ${eligible} AND p.gallery_id=$2 AND g.revision=$3 ORDER BY p.filename,e.id LIMIT 100`,
          [customer, input.galleryId, revision],
        );
        return json({ entitlements: rows });
      }
      const tokenHash =
        input.op === "deliver" ? await digest(new TextEncoder().encode(input.token)) : undefined;
      const selector = input.op === "issue" ? "e.id=$2" : "e.token_hash=$2";
      const [row] = await deps.sql.query<DownloadRow>(
        `SELECT ${fields} ${eligible} AND ${selector}`,
        [customer, input.op === "issue" ? input.entitlementId : tokenHash],
      );
      if (!row) throw new CustomerDownloadError();
      const revision = await deps.authorizeGallery(row.gallery_id);
      if (revision !== row.revision) throw new CustomerDownloadError("Gallery changed; retry", 409);
      if (input.op === "issue") {
        const token = await createCommerce(deps.sql, deps.authorizeGallery).issueDownloadToken(
          customer,
          row.id,
        );
        return json(token);
      }
      if (
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 1 ||
        row.bytes > maxOriginalBytes ||
        !["image/jpeg", "image/png"].includes(row.mime)
      )
        throw new CustomerDownloadError("Original requires owner review", 409);
      // Fetch/verify first: a missing or corrupt object consumes no download.
      const original = await deps.readOriginal(row.original_key, row.bytes, row.checksum);
      if (original.length !== row.bytes || (await digest(original)) !== row.checksum)
        throw new CustomerDownloadError("Original integrity verification failed", 503);
      // Build headers before counting an attempt. Truncate by code point so a
      // filename ending in an emoji cannot create a lone surrogate/URIError.
      const name =
        Array.from(row.filename, (c) => {
          const code = c.charCodeAt(0);
          return code < 32 ||
            code === 127 ||
            c === "/" ||
            c === "\\" ||
            (c.length === 1 && code >= 0xd800 && code <= 0xdfff)
            ? "_"
            : c;
        })
          .slice(0, 180)
          .join("") || "photo";
      const fallback = name.replace(/[^\x20-\x7e]|[";]/g, "_");
      const encoded = encodeURIComponent(name).replace(
        /['()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      const [result] = await deps.sql.query<{ allowed: boolean }>(
        `SELECT commerce_reserve_customer_download($1,$2,$3,$4,$5,$6,$7,$8) AS allowed`,
        [
          customer,
          tokenHash,
          revision,
          row.original_key,
          row.checksum,
          row.bytes,
          await deps.galleryGrantHash(row.gallery_id),
          row.gallery_id,
        ],
      );
      if (!result?.allowed) throw new CustomerDownloadError();
      // Successful reservation counts an attempt even if the client disconnects.
      return new Response(new Uint8Array(original), {
        headers: {
          ...headers,
          "Content-Type": row.mime,
          "Content-Length": String(original.length),
          "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) return json({ error: "Invalid download request" }, 400);
      const e = error as { status?: number; message?: string };
      if (e.status && [401, 403, 404, 409, 429, 503].includes(e.status))
        return json({ error: e.message || "Download unavailable" }, e.status);
      return json({ error: "Download unavailable; retry later" }, 503);
    }
  };
}
