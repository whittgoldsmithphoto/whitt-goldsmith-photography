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

/** Scheduled invocation, never a browser-lifetime background operation. */
export async function processScheduledArchive() {
  if (!archiveDeliveryEnabled(runtimeSetting)) return "disabled";
  const sql = await getSql();
  return runArchiveWorker({
    jobs: createArchiveJobs(sql),
    authorize: paidArchiveAccess(sql).authorize,
    ...privateArchiveStorage(bucket()),
  });
}
