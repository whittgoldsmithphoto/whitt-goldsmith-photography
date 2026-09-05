export type MediaQueueMessage = { version: 1; jobId: string };

type QueueJob = { id: string; status: string };
type QueueMessage = {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = new Set(["completed", "failed", "cancelled"]);

export function parseMediaQueueMessage(body: unknown): MediaQueueMessage | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || value.version !== 1) return null;
  if (typeof value.jobId !== "string" || !uuid.test(value.jobId)) return null;
  return { version: 1, jobId: value.jobId };
}

export async function processMediaQueueBatch<Job extends QueueJob>(
  batch: { messages: readonly QueueMessage[] },
  dependencies: {
    paused?: boolean;
    loadJob(id: string): Promise<Job | null>;
    processJob(job: Job): Promise<void>;
  },
) {
  for (const message of batch.messages) {
    if (dependencies.paused) {
      message.retry({ delaySeconds: 900 });
      continue;
    }
    const envelope = parseMediaQueueMessage(message.body);
    if (!envelope) {
      message.ack();
      continue;
    }
    const job = await dependencies.loadJob(envelope.jobId);
    if (!job || terminal.has(job.status)) {
      message.ack();
      continue;
    }
    try {
      await dependencies.processJob(job);
      message.ack();
    } catch {
      const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, message.attempts - 1));
      message.retry({ delaySeconds });
    }
  }
}
