import { createHash } from "node:crypto";
import { Zip, ZipPassThrough } from "fflate";
import { MAX_PHOTO_BYTES } from "../catalog/upload-limits.ts";

export interface ArchiveEntry {
  photoId: string;
  filename: string;
  objectKey: string;
  bytes: number;
  checksum: string;
}
export interface ArchiveSink {
  /** Await each write; implementations must not queue an unbounded archive. */
  write(bytes: Uint8Array): Promise<void>;
  /** Commit only to private storage. Publishing/grant consumption is separate. */
  commit(): Promise<void>;
  abort(): Promise<void>;
}
export interface ArchivePackDependencies {
  /** MUST recheck paid snapshot, current access/revocation and worker lease. */
  authorize(entries: readonly ArchiveEntry[]): Promise<void>;
  read(entry: ArchiveEntry): Promise<ReadableStream<Uint8Array> | null>;
  openSink(): Promise<ArchiveSink>;
}
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const CHUNK_BYTES = 64 * 1024;

/** Server-side packer, independent of the customer's browser lifetime.
 * Not a public download endpoint: the job/delivery layers must authenticate and
 * transactionally consume grants. No byte leaves the private sink on failure.
 * Stored JPEG/PNG data uses ZIP pass-through (already compressed), not deflate.
 */
export async function packPhotoArchive(
  input: readonly ArchiveEntry[],
  deps: ArchivePackDependencies,
  signal?: AbortSignal,
) {
  if (!input.length || input.length > 500) throw new Error("Archive supports 1–500 photos");
  const ids = new Set<string>();
  let expectedTotal = 0;
  // Copy primitives before the first await: caller mutation cannot change the job.
  const entries = input.map((entry) => {
    if (
      !entry.photoId ||
      ids.has(entry.photoId) ||
      !entry.objectKey ||
      !/^[a-f0-9]{64}$/.test(entry.checksum) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > MAX_PHOTO_BYTES ||
      !entry.filename ||
      entry.filename.length > 180 ||
      /[\\/<>:"|?*]/.test(entry.filename) ||
      Array.from(entry.filename).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /[. ]$/.test(entry.filename) ||
      !/\.(jpe?g|png)$/i.test(entry.filename)
    )
      throw new Error("Unsafe archive manifest");
    ids.add(entry.photoId);
    expectedTotal += entry.bytes;
    if (expectedTotal > MAX_ARCHIVE_BYTES - 1024 * 1024)
      throw new Error("Archive exceeds size limit");
    return Object.freeze({ ...entry });
  });
  Object.freeze(entries);
  signal?.throwIfAborted();
  await deps.authorize(entries);
  const sink = await deps.openSink();
  const outputHash = createHash("sha256");
  let outputBytes = 0;
  let queued: Uint8Array[] = [];
  let zipError: Error | undefined;
  const zip = new Zip((error, data) => {
    if (error) {
      zipError = error;
      return;
    }
    outputBytes += data.length;
    if (outputBytes > MAX_ARCHIVE_BYTES) {
      zipError = new Error("Archive exceeds size limit");
      return;
    }
    queued.push(data);
  });
  async function flush() {
    signal?.throwIfAborted();
    if (zipError) throw zipError;
    const pending = queued;
    queued = [];
    for (const chunk of pending) {
      outputHash.update(chunk);
      await sink.write(chunk);
    }
  }
  try {
    for (const [index, entry] of entries.entries()) {
      signal?.throwIfAborted();
      await deps.authorize(entries);
      const stream = await deps.read(entry);
      if (!stream) throw new Error("Archive original unavailable");
      const reader = stream.getReader();
      const photoHash = createHash("sha256");
      let photoBytes = 0;
      const file = new ZipPassThrough(`${String(index + 1).padStart(4, "0")}-${entry.filename}`);
      file.mtime = new Date("2000-01-01T00:00:00Z");
      try {
        zip.add(file);
        await flush();
        for (;;) {
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          photoBytes += value.length;
          if (photoBytes > entry.bytes) throw new Error("Archive original size mismatch");
          photoHash.update(value);
          for (let offset = 0; offset < value.length; offset += CHUNK_BYTES) {
            file.push(value.subarray(offset, offset + CHUNK_BYTES));
            await flush();
          }
        }
        if (photoBytes !== entry.bytes || photoHash.digest("hex") !== entry.checksum)
          throw new Error("Archive original checksum mismatch");
        file.push(new Uint8Array(), true);
        await flush();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    zip.end();
    await flush();
    await deps.authorize(entries);
    signal?.throwIfAborted();
    await sink.commit();
    return { photos: entries.length, bytes: outputBytes, checksum: outputHash.digest("hex") };
  } catch (error) {
    zip.terminate();
    await sink.abort();
    throw error;
  }
}
