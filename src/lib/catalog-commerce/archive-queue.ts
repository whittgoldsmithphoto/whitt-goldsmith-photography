type Message = {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

/** Shares the existing private queue, never the media envelope or a public API.
 * The durable ledger selects work and revalidates the paid snapshot itself.
 */
export async function processArchiveQueueBatch<M extends Message>(
  batch: { messages: readonly M[] },
  process: () => Promise<string>,
): Promise<M[]> {
  const remaining: M[] = [];
  for (const message of batch.messages) {
    const body = message.body as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      body.version !== 1 ||
      body.kind !== "album_archive"
    ) {
      remaining.push(message);
      continue;
    }
    try {
      const outcome = await process();
      if (outcome === "retry") message.retry({ delaySeconds: 300 });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 300 });
    }
  }
  return remaining;
}
