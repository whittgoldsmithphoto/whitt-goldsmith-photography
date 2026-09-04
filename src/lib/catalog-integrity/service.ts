import { z } from "zod";
import type { Sql } from "../db.ts";
import { CatalogError } from "../catalog/errors.ts";

export const integrityInput = z.object({ photoId: z.string().uuid() }).strict();
export type IntegrityObject = { size: number; body: ReadableStream<Uint8Array> };
export type IntegrityStorage = { get(key: string): Promise<IntegrityObject | null> };
export type IntegrityResult = {
  photoId: string;
  status: "verified" | "mismatch" | "missing";
  checkedAt: string;
  expectedBytes: number;
  message: string;
};
const MAX_BYTES = 20 * 1024 * 1024;
export async function readVerifiedOriginal(
  object: IntegrityObject,
  expectedBytes: number,
  expectedChecksum: string,
): Promise<{ status: "verified"; bytes: Uint8Array } | { status: "mismatch"; message: string }> {
  if (
    !Number.isInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(expectedChecksum)
  ) {
    await object.body.cancel();
    throw new CatalogError("The catalog record cannot be verified safely", 409);
  }
  if (!Number.isSafeInteger(object.size) || object.size < 0) {
    await object.body.cancel();
    throw new CatalogError("Storage returned an invalid object size", 503);
  }
  if (object.size !== expectedBytes) {
    await object.body.cancel();
    return {
      status: "mismatch",
      message: "The stored original's byte count differs from the catalog. Nothing was changed.",
    };
  }
  const reader = object.body.getReader();
  // Metadata and expected limit are checked before allocation. One bounded
  // buffer avoids retaining all stream chunks and then allocating a second copy.
  const bytes = new Uint8Array(expectedBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expectedBytes - length) {
        await reader.cancel();
        return {
          status: "mismatch",
          message: "The original stream exceeds its recorded byte count. Nothing was changed.",
        };
      }
      bytes.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expectedBytes)
    return {
      status: "mismatch",
      message: "The stored original's byte count differs from the catalog. Nothing was changed.",
    };
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return actual === expectedChecksum
    ? { status: "verified", bytes }
    : {
        status: "mismatch",
        message: "The original's SHA-256 differs from the catalog. Nothing was changed.",
      };
}
export function createIntegrityService(sql: Sql, storage: IntegrityStorage) {
  return async (input: unknown): Promise<IntegrityResult> => {
    const { photoId } = integrityInput.parse(input);
    const [photo] = await sql<{ original_key: string; bytes: number; checksum: string }>`
      select original_key,bytes,checksum from catalog_photos where id=${photoId}`;
    if (!photo) throw new CatalogError("Photo not found", 404);
    if (
      photo.original_key !== `catalog/originals/${photoId}` ||
      !Number.isInteger(photo.bytes) ||
      photo.bytes <= 0 ||
      photo.bytes > MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(photo.checksum)
    )
      throw new CatalogError("The catalog record cannot be verified safely", 409);
    const result = (status: IntegrityResult["status"], message: string): IntegrityResult => ({
      photoId,
      status,
      message,
      checkedAt: new Date().toISOString(),
      expectedBytes: photo.bytes,
    });
    const object = await storage.get(photo.original_key);
    if (!object)
      return result(
        "missing",
        "No original was found in the configured private storage. Nothing was changed.",
      );
    const checked = await readVerifiedOriginal(object, photo.bytes, photo.checksum);
    return checked.status === "verified"
      ? result(
          "verified",
          "Original byte count and SHA-256 match the catalog at this check. Nothing was changed.",
        )
      : result("mismatch", checked.message);
  };
}
