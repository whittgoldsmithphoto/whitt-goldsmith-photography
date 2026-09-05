import type { ArchiveJob, createArchiveJobs } from "./archive-jobs.ts";
import { packPhotoArchive } from "./archive-pack.ts";
import { openR2ArchiveSink, type ArchiveBucket } from "./archive-r2.ts";

type Jobs = Pick<
  ReturnType<typeof createArchiveJobs>,
  "claim" | "heartbeat" | "complete" | "retry"
>;
interface Dependencies {
  jobs: Jobs;
  /** Must verify current paid order, immutable purchased photo set, gallery
   * access, expiry and remaining allowances. A successful lease is not access. */
  authorize(job: ArchiveJob): Promise<void>;
  pack(
    job: ArchiveJob,
    check: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<{ bytes: number; checksum: string }>;
  /** Delete only this attempt's generated ZIP, never source photographs. */
  discard(key: string): Promise<void>;
  reportFailure?(code: string): void;
}

/** Return fixed categories only: provider messages may contain private keys. */
export function archiveFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/too many subrequests/i.test(message)) return "provider_subrequest_limit";
  if (/cpu time|memory limit/i.test(message)) return "provider_resource_limit";
  if (/connection.*terminated|connection.*closed|timeout|timed out/i.test(message))
    return "connection_or_timeout";
  if (/Archive original (checksum|size) mismatch/.test(message)) return "original_integrity";
  if (/Archive original unavailable/.test(message)) return "original_missing";
  if (/Archive readback|Completed archive is missing/.test(message)) return "archive_readback";
  if (/Archive lease/.test(message)) return "lease_lost";
  if (/Purchased album archive unavailable/.test(message)) return "access_changed";
  if (/multipart|uploadPart|part.*size/i.test(message)) return "multipart_upload";
  return "unclassified";
}

/** Processes one durable job; caller must supply real authorization, not a no-op.
 * No request route or public delivery is enabled by this coordinator. */
export async function runArchiveWorker(deps: Dependencies) {
  const job = await deps.jobs.claim();
  if (!job) return "idle";
  if (!job.lease_token || !job.output_key) throw new Error("Archive lease incomplete");
  const token = job.lease_token;
  const controller = new AbortController();
  let heartbeat: Promise<void> = Promise.resolve();
  const renew = async () => {
    if (!(await deps.jobs.heartbeat(job.id, token))) throw new Error("Archive lease lost");
  };
  // Serialize timer renewals so a slow database cannot create an unbounded queue.
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    heartbeat = renew()
      .catch((error) => {
        controller.abort(error);
      })
      .finally(() => {
        renewing = false;
      });
  }, 30_000);
  const check = async () => {
    controller.signal.throwIfAborted();
    await renew();
    await deps.authorize(job);
    controller.signal.throwIfAborted();
  };
  try {
    await check();
    const result = await deps.pack(job, check, controller.signal);
    await check();
    if (!(await deps.jobs.complete(job.id, token, result.checksum, result.bytes)))
      throw new Error("Archive lease lost before completion");
    return "completed";
  } catch (error) {
    try {
      deps.reportFailure?.(archiveFailureCode(error));
    } catch {
      /* Diagnostics must not prevent cleanup/retry. */
    }
    // Even successfully packed bytes stay private when final authorization fails.
    // Cleanup failure propagates for operator reconciliation; never mark ready.
    await deps.discard(job.output_key);
    await deps.jobs.retry(job.id, token);
    return "retry";
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
}

/** Real packer/R2 adapter. The coordinator still requires paid-access checks. */
export function privateArchiveStorage(bucket: ArchiveBucket) {
  return {
    pack: (job: ArchiveJob, check: () => Promise<void>, signal: AbortSignal) =>
      packPhotoArchive(
        job.manifest,
        {
          authorize: check,
          openSink: () => openR2ArchiveSink(bucket, job.output_key!),
          read: async (entry) => {
            if (
              ![
                `catalog/originals/${entry.photoId}`,
                `catalog/originals/${entry.photoId}/${entry.checksum}`,
              ].includes(entry.objectKey)
            )
              throw new Error("Untrusted archive original");
            const original = await bucket.get(entry.objectKey);
            if (!original) return null;
            if (original.size !== entry.bytes) {
              await original.body.cancel();
              throw new Error("Archive original size mismatch");
            }
            return original.body;
          },
        },
        signal,
      ),
    discard: async (key: string) => {
      if (!/^catalog\/archives\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/.test(key))
        throw new Error("Invalid private archive destination");
      await bucket.delete(key);
    },
  };
}
