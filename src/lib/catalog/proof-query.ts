import { z } from "zod";
import type { OwnerProof } from "./types.ts";

export type OwnerProofPage = { items: OwnerProof[]; nextCursor: string | null };
export const proofQuerySchema = z
  .object({
    q: z.string().trim().max(120).default(""),
    status: z.enum(["all", "unreviewed", "reviewed"]).default("all"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type OwnerProofQuery = z.input<typeof proofQuerySchema>;
const cursorSchema = z
  .object({
    time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/),
    id: z.string().uuid(),
  })
  .strict();
export function decodeProofCursor(cursor?: string) {
  return cursor ? cursorSchema.parse(JSON.parse(cursor)) : null;
}
