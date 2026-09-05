type ProcessingState = {
  status: string;
  processingStatus?: string | null;
  processingStage?: string | null;
  progressPercent?: number;
  error?: string | null;
};

/** Render server-reported state, never an estimated timer or optimistic completion. */
export function processingSummary(job: ProcessingState): string {
  if (job.status === "ready") return "Ready";
  if (job.status === "needs_review" || job.processingStatus === "failed") {
    return job.error?.trim()
      ? `Needs review: ${job.error.trim()}`
      : "Needs review. Processing did not finish; retry or inspect diagnostics.";
  }
  if (job.processingStatus === "queued" || job.processingStatus === "retry")
    return "Queued for processing";
  if (job.status === "processing" || job.processingStatus === "processing") {
    const percent = job.progressPercent;
    const progress =
      typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent < 100
        ? ` (${Math.floor(percent)}%)`
        : "";
    return `Processing${job.processingStage ? `: ${job.processingStage.replaceAll("_", " ")}` : ""}${progress}`;
  }
  return job.status.replaceAll("_", " ");
}
