import { test } from "node:test";
import assert from "node:assert/strict";
import { processingSummary } from "./processing-summary.ts";

test("processing summary distinguishes completion, queued work, and recoverable failures", () => {
  assert.equal(
    processingSummary({ status: "ready", processingStatus: "failed", error: "old failure" }),
    "Ready",
  );
  assert.equal(
    processingSummary({ status: "uploaded", processingStatus: "queued" }),
    "Queued for processing",
  );
  assert.equal(
    processingSummary({
      status: "needs_review",
      processingStatus: "failed",
      error: "Image exceeds processor size limit",
    }),
    "Needs review: Image exceeds processor size limit",
  );
  assert.equal(
    processingSummary({ status: "needs_review" }),
    "Needs review. Processing did not finish; retry or inspect diagnostics.",
  );
  assert.equal(
    processingSummary({
      status: "processing",
      processingStatus: "processing",
      processingStage: "derivatives",
      progressPercent: 32,
    }),
    "Processing: derivatives (32%)",
  );
});
