import { z } from "zod";
import type { Sql } from "../db.ts";
import { paidArchiveAccess, ArchiveAccessError } from "./archive-access.ts";
import { createArchiveJobs } from "./archive-jobs.ts";
import { openVerifiedArchive, type StoredArchive } from "./archive-delivery.ts";

interface Dependencies {
  user(): Promise<string>;
  sql: Sql;
  get(key: string): Promise<StoredArchive | null>;
}
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const uuid = z.string().uuid();
const inputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("request"), orderId: uuid }).strict(),
  z.object({ op: z.literal("status"), jobId: uuid }).strict(),
  z.object({ op: z.literal("deliver"), jobId: uuid }).strict(),
]);

/** Internal handler; remains unavailable until runtime and migration acceptance. */
export function createArchiveHandler(enabled: boolean, deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (!enabled) return json({ error: "Album ZIP delivery is not enabled" }, 503);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (request.headers.get("origin") !== url.origin)
      return json({ error: "Same-origin request required" }, 403);
    if (url.search) return json({ error: "Query parameters are not supported" }, 400);
    if (!(request.headers.get("content-type") || "").startsWith("application/json"))
      return json({ error: "JSON required" }, 415);
    let delivery: StoredArchive | undefined;
    try {
      const customer = await deps.user();
      if (!customer || customer === "dev-user") return json({ error: "Sign in to download" }, 401);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Request body required" }, 400);
      let body = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 4096) return json({ error: "Request too large" }, 413);
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) return json({ error: "Invalid archive request" }, 400);
      const input = parsed.data;
      const access = paidArchiveAccess(deps.sql);
      const jobs = createArchiveJobs(deps.sql);
      if (input.op === "request") {
        const manifest = await access.snapshot(input.orderId, customer);
        const job = await jobs.enqueue({ orderId: input.orderId, customerId: customer, manifest });
        return json({ jobId: job.id, status: job.status });
      }
      const job = await jobs.get(input.jobId, customer);
      if (!job) throw new ArchiveAccessError();
      await access.authorize(job);
      if (input.op === "status") return json({ jobId: job.id, status: job.status });
      if (job.status !== "completed" || !job.output_key || !job.output_checksum)
        throw new ArchiveAccessError();
      const expected = {
        key: job.output_key,
        checksum: job.output_checksum,
        bytes: Number(job.output_bytes),
      };
      delivery = await openVerifiedArchive(deps.get, expected);
      await access.authorize(job);
      const [reserved] = await deps.sql.query<{ allowed: boolean }>(
        "select commerce_reserve_archive_download($1,$2,$3,$4,$5) as allowed",
        [customer, job.id, expected.key, expected.checksum, expected.bytes],
      );
      if (reserved?.allowed !== true) throw new ArchiveAccessError();
      const response = new Response(delivery.body, {
        headers: {
          ...headers,
          "Content-Type": "application/zip",
          "Content-Length": String(expected.bytes),
          "Content-Disposition": `attachment; filename="album-${input.jobId}.zip"`,
        },
      });
      delivery = undefined;
      return response;
    } catch (error) {
      await delivery?.body.cancel().catch(() => {});
      return json(
        { error: "Purchased album archive unavailable" },
        error instanceof ArchiveAccessError ? 404 : 503,
      );
    }
  };
}
