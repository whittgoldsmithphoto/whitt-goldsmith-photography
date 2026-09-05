import { z } from "zod";
import type { Sql } from "../db.ts";
import { snapshotArchiveEntries, type ArchiveEntry } from "./archive-pack.ts";

const albumItems = z
  .array(
    z.object({
      kind: z.literal("gallery_download"),
      quantity: z.literal(1),
      photoIds: z.array(z.string().min(1).max(350)).min(1).max(500),
    }),
  )
  .length(1);

export class ArchiveAccessError extends Error {
  readonly status = 404;
  constructor() {
    super("Purchased album archive unavailable");
  }
}

/** Internal authorization boundary, never a public manifest response.
 * Initial ZIP support is deliberately public-gallery-only. Password/private
 * galleries require persisted, revocable worker access before being supported.
 * This checks rights; it does NOT consume an allowance or authorize delivery.
 */
export function paidArchiveAccess(sql: Sql) {
  async function snapshot(orderId: string, customerId: string): Promise<readonly ArchiveEntry[]> {
    if (
      !orderId ||
      !customerId ||
      customerId === "dev-user" ||
      orderId.length > 350 ||
      customerId.length > 350
    )
      throw new ArchiveAccessError();
    const [order] = await sql.query<{ gallery_id: string; items: unknown }>(
      `SELECT q.gallery_id,q.items FROM commerce_orders o
       JOIN commerce_quotes q ON q.id=o.quote_id AND q.customer_id=o.customer_id
       JOIN catalog_galleries g ON g.id=q.gallery_id
       WHERE o.id=$1 AND o.customer_id=$2 AND o.status='paid'
         AND g.published AND g.visibility='public' AND g.download_policy='purchased_only'`,
      [orderId, customerId],
    );
    const parsed = albumItems.safeParse(order?.items);
    if (!order || !parsed.success) throw new ArchiveAccessError();
    const ids = [...parsed.data[0].photoIds].sort();
    if (new Set(ids).size !== ids.length) throw new ArchiveAccessError();
    const rows = await sql.query<ArchiveEntry>(
      `SELECT p.id AS "photoId",p.filename,p.original_key AS "objectKey",p.bytes,p.checksum
       FROM commerce_entitlements e JOIN commerce_orders o ON o.id=e.order_id
       JOIN catalog_photos p ON p.id=e.photo_id JOIN catalog_galleries g ON g.id=p.gallery_id
       WHERE e.order_id=$1 AND e.customer_id=$2 AND o.customer_id=$2 AND o.status='paid'
         AND p.id=ANY($3::text[]) AND p.gallery_id=$4
         AND e.revoked_at IS NULL AND e.expires_at>now() AND e.downloads<e.max_downloads
         AND p.status='ready' AND NOT p.hidden AND NOT p.archived
         AND g.published AND g.visibility='public' AND g.download_policy='purchased_only'
       ORDER BY p.id LIMIT 501`,
      [orderId, customerId, ids, order.gallery_id],
    );
    if (
      rows.length !== ids.length ||
      rows.some(
        (row, i) =>
          row.photoId !== ids[i] ||
          ![
            `catalog/originals/${row.photoId}`,
            `catalog/originals/${row.photoId}/${row.checksum}`,
          ].includes(row.objectKey),
      )
    )
      throw new ArchiveAccessError();
    try {
      return snapshotArchiveEntries(rows);
    } catch {
      throw new ArchiveAccessError();
    }
  }
  return {
    snapshot,
    async authorize(job: {
      order_id: string;
      customer_id: string;
      manifest: readonly ArchiveEntry[];
    }) {
      const current = await snapshot(job.order_id, job.customer_id);
      // Exact equality includes filename, byte length, checksum and private key;
      // a job cannot substitute or omit originals from the purchased snapshot.
      if (
        current.length !== job.manifest.length ||
        current.some((entry, i) => {
          const previous = job.manifest[i];
          return (
            !previous ||
            entry.photoId !== previous.photoId ||
            entry.filename !== previous.filename ||
            entry.objectKey !== previous.objectKey ||
            entry.bytes !== previous.bytes ||
            entry.checksum !== previous.checksum
          );
        })
      )
        throw new ArchiveAccessError();
    },
  };
}
