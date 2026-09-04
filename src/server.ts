import handler from "@tanstack/react-start/server-entry";
import { getSql } from "./lib/db";
import { createCatalog } from "./lib/catalog/repository";
import { catalogMedia } from "./lib/catalog/media.server";
import { listDispatchableMediaJobs, loadMediaJob } from "./lib/catalog/media-jobs";
import { processMediaQueueBatch } from "./lib/catalog/media-queue";
import { dispatchMediaJob } from "./lib/catalog/media-queue.server";
import { cleanupExpiredUploads } from "./lib/catalog/upload-cleanup";

type WorkerQueueBatch = Parameters<typeof processMediaQueueBatch>[0];

export default {
  fetch: handler.fetch,
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
    await cleanupExpiredUploads(sql, catalogMedia(), 25);
    const jobs = await listDispatchableMediaJobs(sql, 50);
    for (const job of jobs) await dispatchMediaJob(job.id);
  },
};
