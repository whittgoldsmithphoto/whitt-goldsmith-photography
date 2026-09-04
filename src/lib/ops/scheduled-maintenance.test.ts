import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheduledMaintenance } from "./scheduled-maintenance.ts";

test("maintenance isolates cleanup and per-job provider failures", async () => {
  const attempted: string[] = [];
  const result = await runScheduledMaintenance({
    cleanupExpiredUploads: async () => {
      throw new Error("database unavailable");
    },
    listDispatchableJobs: async () => [{ id: "a" }, { id: "b" }, { id: "c" }],
    dispatchMediaJob: async (id) => {
      attempted.push(id);
      if (id === "b") throw new Error("queue unavailable");
    },
  });

  assert.deepEqual(attempted, ["a", "b", "c"]);
  assert.deepEqual(result, {
    cleanup: null,
    cleanupFailed: 1,
    dispatchListFailed: 0,
    dispatchFailed: 1,
    dispatched: 2,
  });
});

test("maintenance reports a listing failure without attempting dispatch", async () => {
  let attempts = 0;
  const result = await runScheduledMaintenance({
    cleanupExpiredUploads: async () => ({ claimed: 2, deleted: 2, failed: 0 }),
    listDispatchableJobs: async () => {
      throw new Error("database unavailable");
    },
    dispatchMediaJob: async () => {
      attempts++;
    },
  });

  assert.equal(attempts, 0);
  assert.deepEqual(result, {
    cleanup: { claimed: 2, deleted: 2, failed: 0 },
    cleanupFailed: 0,
    dispatchListFailed: 1,
    dispatchFailed: 0,
    dispatched: 0,
  });
});
