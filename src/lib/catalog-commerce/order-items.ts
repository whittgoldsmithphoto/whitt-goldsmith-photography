import type { QuoteItem } from "./service.ts";

/** Present the immutable purchased snapshot, never every grant on the order.
 * This is display filtering only; the download endpoint reauthorizes each file.
 */
export function entitlementsForItem<T extends { photo_id: string }>(
  item: QuoteItem,
  grants: T[] = [],
): T[] {
  const photoIds = new Set(
    item.kind === "gallery_download" ? (item.photoIds ?? []) : [item.photoId],
  );
  return grants.filter((grant) => photoIds.has(grant.photo_id));
}
