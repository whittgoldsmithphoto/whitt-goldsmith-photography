import { test } from "node:test";
import assert from "node:assert/strict";
import { runArchiveWorker, archiveFailureCode } from "./archive-worker.ts";
import type { ArchiveJob } from "./archive-jobs.ts";

function fixture() {
  const job: ArchiveJob = {
    id: "job",
    order_id: "order",
    customer_id: "buyer",
    manifest: [],
    status: "processing",
    attempts: 1,
    lease_token: "lease",
    output_key: "private-attempt",
  };
  let completed = 0,
    retried = 0,
    deleted = 0,
    checks = 0;
  const deps = {
    jobs: {
      claim: async () => job,
      heartbeat: async () => true,
      complete: async () => {
        completed++;
        return true;
      },
      retry: async () => {
        retried++;
        return true;
      },
    },
    authorize: async () => {
      checks++;
    },
    pack: async (_job: ArchiveJob, check: () => Promise<void>, _signal: AbortSignal) => {
      await check();
      return { bytes: 123, checksum: "a".repeat(64), photos: 1 };
    },
    discard: async () => {
      deleted++;
    },
  };
  return { deps, state: () => ({ completed, retried, deleted, checks }) };
}
test("archive diagnostics classify failures without returning private error text", () => {
  assert.equal(archiveFailureCode(new Error("Too many subrequests")), "provider_subrequest_limit");
  assert.equal(
    archiveFailureCode(new Error("Archive original checksum mismatch")),
    "original_integrity",
  );
  assert.equal(
    archiveFailureCode(new Error("private-key secret customer@example.com")),
    "unclassified",
  );
});
test("failure reporting cannot prevent retry or expose the raw error", async () => {
  const f = fixture();
  const reports: string[] = [];
  f.deps.pack = async () => {
    throw new Error("Archive original checksum mismatch");
  };
  assert.equal(
    await runArchiveWorker({
      ...f.deps,
      reportFailure: (code) => {
        reports.push(code);
        throw new Error("logging failed");
      },
    }),
    "retry",
  );
  assert.deepEqual(reports, ["original_integrity"]);
  assert.equal(f.state().retried, 1);
});
test("worker packs a leased job, rechecks access and records completion", async () => {
  const f = fixture();
  assert.equal(await runArchiveWorker(f.deps), "completed");
  assert.deepEqual(f.state(), { completed: 1, retried: 0, deleted: 0, checks: 3 });
});
test("revoked access never marks output ready and cleans only the attempt", async () => {
  const f = fixture();
  let checks = 0;
  f.deps.authorize = async () => {
    if (++checks === 3) throw new Error("revoked");
  };
  assert.equal(await runArchiveWorker(f.deps), "retry");
  assert.equal(f.state().completed, 0);
  assert.equal(f.state().deleted, 1);
});
test("lost completion lease cleans completed private output without publishing it", async () => {
  const f = fixture();
  f.deps.jobs.complete = async () => false;
  assert.equal(await runArchiveWorker(f.deps), "retry");
  assert.equal(f.state().deleted, 1);
});
test("a worker without a lease does no archive work", async () => {
  const f = fixture();
  assert.equal(
    await runArchiveWorker({ ...f.deps, jobs: { ...f.deps.jobs, claim: async () => null } }),
    "idle",
  );
  assert.equal(f.state().checks, 0);
});
