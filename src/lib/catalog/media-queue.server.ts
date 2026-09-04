import { env } from "cloudflare:workers";
import { CatalogError } from "./errors";
import type { MediaQueueMessage } from "./media-queue";

type MediaQueueBinding = {
  send(body: MediaQueueMessage, options?: { contentType?: "json" }): Promise<void>;
};

function binding() {
  return (env as unknown as { MEDIA_QUEUE?: MediaQueueBinding }).MEDIA_QUEUE;
}

function environment() {
  const value = (env as unknown as Record<string, unknown>).CATALOG_ENV ?? process.env.CATALOG_ENV;
  return typeof value === "string" ? value.trim() : "";
}

export function mediaQueueConfigured() {
  return Boolean(binding());
}

/**
 * Publish only the opaque durable-job identifier. The worker reloads all
 * authoritative photo and owner state from Postgres before processing.
 */
export async function dispatchMediaJob(jobId: string) {
  const queue = binding();
  if (!queue) {
    if (["staging", "production"].includes(environment()))
      throw new CatalogError("Media processing queue is not configured", 503);
    return false;
  }
  await queue.send({ version: 1, jobId }, { contentType: "json" });
  return true;
}
