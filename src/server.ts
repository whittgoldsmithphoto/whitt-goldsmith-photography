import handler from "@tanstack/react-start/server-entry";
import { getSql } from "./lib/db";
import { createCatalog } from "./lib/catalog/repository";
import { catalogMedia } from "./lib/catalog/media.server";
import { listDispatchableMediaJobs, loadMediaJob } from "./lib/catalog/media-jobs";
import { processMediaQueueBatch } from "./lib/catalog/media-queue";
import { dispatchMediaJob } from "./lib/catalog/media-queue.server";
import { cleanupExpiredUploads } from "./lib/catalog/upload-cleanup";
import { runScheduledMaintenance } from "./lib/ops/scheduled-maintenance";

type WorkerQueueBatch = Parameters<typeof processMediaQueueBatch>[0];

async function fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
  const start = handler.fetch as (
    request: Request,
    env?: unknown,
    ctx?: ExecutionContext,
  ) => Promise<Response>;
  const response = await start(request, env, ctx);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const headers = new Headers(response.headers);
    headers.set("x-wgp-revision", import.meta.env.VITE_BUILD_REVISION || "development");
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

export default {
  fetch,
  async queue(batch: WorkerQueueBatch) {
    const sql = await getSql();
    const catalog = createCatalog(sql, catalogMedia());
    await processMediaQueueBatch(batch, {
      loadJob: (id) => loadMediaJob(sql, id),
      processJob: async (job) => {
        const result = await catalog.process(job.photoId, job.ownerId);
        if (result.status !== "ready") throw new Error("Media job did not reach ready state");
      },
    });
  },
  async scheduled() {
    const sql = await getSql();
    const result = await runScheduledMaintenance({
      cleanupExpiredUploads: () => cleanupExpiredUploads(sql, catalogMedia(), 25),
      listDispatchableJobs: () => listDispatchableMediaJobs(sql, 50),
      dispatchMediaJob,
    });
    if (result.cleanupFailed || result.dispatchListFailed || result.dispatchFailed)
      console.error("Scheduled catalog maintenance had recoverable failures.", {
        cleanupFailed: result.cleanupFailed,
        dispatchListFailed: result.dispatchListFailed,
        dispatchFailed: result.dispatchFailed,
      });
  },
};
