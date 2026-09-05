import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMediaQueueMessage,
  processMediaQueueBatch,
  type MediaQueueMessage,
} from "./media-queue.ts";

function message<T>(body: T, attempts = 1) {
  const actions: Array<[string, number?]> = [];
  return {
    body,
    attempts,
    ack: () => actions.push(["ack"]),
    retry: (options?: { delaySeconds?: number }) => actions.push(["retry", options?.delaySeconds]),
    actions,
  };
}

test("paused media processing defers jobs without reading database or losing messages", async () => {
  const pending = message({ version: 1, jobId: "00000000-0000-4000-8000-000000000004" });
  await processMediaQueueBatch({ messages: [pending] }, {
    paused: true,
    loadJob: async () => { throw new Error("Database must not be used while paused"); },
    processJob: async () => { throw new Error("Processing must not run while paused"); },
  });
  assert.deepEqual(pending.actions, [["retry", 900]]);
});

test("queue batches isolate poison, replay, success, and retry decisions per message", async () => {
  const malformed = message({ photoId: "private-data-is-not-an-envelope" });
  const replay = message({ version: 1, jobId: "00000000-0000-4000-8000-000000000001" });
  const success = message({ version: 1, jobId: "00000000-0000-4000-8000-000000000002" });
  const transient = message({ version: 1, jobId: "00000000-0000-4000-8000-000000000003" }, 2);
  const jobs = new Map<string, { id: string; status: string }>([
    [replay.body.jobId, { id: replay.body.jobId, status: "completed" }],
    [success.body.jobId, { id: success.body.jobId, status: "queued" }],
    [transient.body.jobId, { id: transient.body.jobId, status: "queued" }],
  ]);
  const processed: string[] = [];

  await processMediaQueueBatch(
    { messages: [malformed, replay, success, transient] },
    {
      loadJob: async (id) => jobs.get(id) ?? null,
      processJob: async (job) => {
        processed.push(job.id);
        if (job.id === transient.body.jobId) throw new Error("temporary provider outage");
        jobs.set(job.id, { ...job, status: "completed" });
      },
    },
  );

  assert.deepEqual(malformed.actions, [["ack"]], "invalid envelopes cannot poison the queue");
  assert.deepEqual(replay.actions, [["ack"]], "terminal replay is harmless");
  assert.deepEqual(success.actions, [["ack"]]);
  assert.deepEqual(transient.actions, [["retry", 60]]);
  assert.deepEqual(processed, [success.body.jobId, transient.body.jobId]);
});

test("the queue envelope accepts only its versioned opaque job ID", () => {
  const valid: MediaQueueMessage = {
    version: 1,
    jobId: "00000000-0000-4000-8000-000000000004",
  };
  assert.deepEqual(parseMediaQueueMessage(valid), valid);
  assert.equal(parseMediaQueueMessage({ ...valid, photoId: "must-not-leak" }), null);
  assert.equal(parseMediaQueueMessage({ ...valid, version: 2 }), null);
  assert.equal(parseMediaQueueMessage({ ...valid, jobId: "not-a-job-id" }), null);
  assert.equal(parseMediaQueueMessage(null), null);
});
