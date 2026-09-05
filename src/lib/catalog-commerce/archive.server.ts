import { env } from "cloudflare:workers";
import { getSql } from "../db";
import { getSessionUser } from "../auth/verify.server";
import { runtimeSetting } from "../catalog/media.server";
import { archiveDeliveryEnabled } from "./archive-runtime";
import { createArchiveHandler } from "./archive-http";
import { createArchiveJobs } from "./archive-jobs";
import { paidArchiveAccess } from "./archive-access";
import { privateArchiveStorage, runArchiveWorker } from "./archive-worker";
import type { ArchiveBucket } from "./archive-r2";
import type { StoredArchive } from "./archive-delivery";

type Bucket = Omit<ArchiveBucket, "get"> & { get(key: string): Promise<StoredArchive | null> };
function bucket() {
  const value = (env as unknown as { CATALOG_BUCKET?: Bucket }).CATALOG_BUCKET;
  if (!value) throw new Error("Archive storage unavailable");
  return value;
}

export async function archiveRequest(request: Request) {
  if (!archiveDeliveryEnabled(runtimeSetting))
    return createArchiveHandler(false, undefined!)(request);
  try {
    return await createArchiveHandler(true, {
      sql: await getSql(),
      user: async () => (await getSessionUser())?.id || "",
      get: (key) => bucket().get(key),
    })(request);
  } catch {
    return Response.json(
      { error: "Album service unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}

/** Queue invocation has a larger CPU budget than a frequent cron trigger. */
export async function processQueuedArchive() {
  if (!archiveDeliveryEnabled(runtimeSetting)) return "disabled";
  const sql = await getSql();
  return runArchiveWorker({
    jobs: createArchiveJobs(sql),
    authorize: paidArchiveAccess(sql).authorize,
    reportFailure: (code) => console.error("Album archive failure category:", code),
    ...privateArchiveStorage(bucket()),
  });
}

/** Cron only dispatches; it must not package large albums under its 30s CPU cap. */
export async function dispatchScheduledArchive() {
  if (!archiveDeliveryEnabled(runtimeSetting)) return;
  const sql = await getSql();
  const [job] = await sql.query<{ id: string }>(`SELECT id FROM commerce_archive_jobs
    WHERE (status IN ('queued','retry') AND attempts<5 AND available_at<=now())
      OR (status='processing' AND leased_until<=now())
    ORDER BY available_at,id LIMIT 1`);
  if (!job) return;
  const queue = (env as unknown as { MEDIA_QUEUE?: { send(body: unknown): Promise<void> } })
    .MEDIA_QUEUE;
  if (!queue) throw new Error("Archive processing queue unavailable");
  await queue.send({ version: 1, kind: "album_archive" });
}
