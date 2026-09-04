/**
 * Runs independent scheduled maintenance tasks without allowing one provider
 * outage to starve the other queues. The returned value is safe for metrics
 * and logs: task errors are reduced to a count and never contain provider
 * responses, object keys, or database details.
 */
export async function runScheduledMaintenance(input: {
  cleanupExpiredUploads: () => Promise<{ claimed: number; deleted: number; failed: number }>;
  listDispatchableJobs: () => Promise<Array<{ id: string }>>;
  dispatchMediaJob: (id: string) => Promise<unknown>;
}) {
  let cleanupFailed = 0;
  let dispatchListFailed = 0;
  let dispatchFailed = 0;
  let dispatched = 0;
  let cleanup: { claimed: number; deleted: number; failed: number } | null = null;

  try {
    cleanup = await input.cleanupExpiredUploads();
  } catch {
    cleanupFailed = 1;
  }

  let jobs: Array<{ id: string }> = [];
  try {
    jobs = await input.listDispatchableJobs();
  } catch {
    dispatchListFailed = 1;
  }

  for (const job of jobs) {
    try {
      await input.dispatchMediaJob(job.id);
      dispatched++;
    } catch {
      // Continue the bounded batch so a transient failure for one job does
      // not prevent later jobs from being attempted on this tick.
      dispatchFailed++;
    }
  }

  return {
    cleanup,
    cleanupFailed,
    dispatchListFailed,
    dispatchFailed,
    dispatched,
  };
}
