import { z } from "zod";
import type { Page } from "./contracts.ts";
import { CatalogError } from "../catalog/errors.ts";
const schema = z
  .object({
    v: z.literal(1),
    scope: z.string().max(800),
    id: z.string().uuid(),
    sort: z.union([z.string().max(180), z.number().int().min(-2147483648).max(2147483647)]),
  })
  .strict();
type Cursor = z.infer<typeof schema>;
export function encodeCursor(input: Omit<Cursor, "v">) {
  return Buffer.from(JSON.stringify(schema.parse({ v: 1, ...input }))).toString("base64url");
}
export function pageInput(params: URLSearchParams, scope: string) {
  const raw = params.get("limit") ?? "50";
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 50)
    throw new CatalogError("Page limit must be between 1 and 50");
  let cursor: Cursor | null = null;
  const encoded = params.get("cursor");
  if (encoded) {
    try {
      if (encoded.length > 2048 || !/^[\w-]+$/.test(encoded)) throw new Error();
      cursor = schema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
      if (cursor.scope !== scope) throw new Error();
    } catch {
      throw new CatalogError("Invalid or mismatched page cursor");
    }
  }
  return { limit: Number(raw), cursor };
}
export function pageResult<T>(rows: T[], limit: number, encode: (row: T) => string): Page<T> {
  const data = rows.slice(0, limit),
    hasMore = rows.length > limit;
  return { data, page: { hasMore, nextCursor: hasMore ? encode(data[data.length - 1]) : null } };
}
