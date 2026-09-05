import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { snapshotArchiveEntries, type ArchiveEntry } from "./archive-pack.ts";

export interface ArchiveJob {
  id: string;
  order_id: string;
  customer_id: string;
  manifest: ArchiveEntry[];
  status: "queued" | "processing" | "retry" | "completed" | "failed" | "cancelled";
  attempts: number;
  lease_token: string | null;
  output_key: string | null;
  output_checksum?: string | null;
  output_bytes?: number | string | null;
}

/** Internal persistence, not a customer API or authorization boundary.
 * Enqueue only a server-derived, verified paid snapshot. Recheck entitlement
 * and current gallery access during execution and before delivery. Never send
 * this raw row (private manifest/keys/lease) to a browser.
 */
export function createArchiveJobs(sql: Sql) {
  return {
    async enqueue(input: {
      orderId: string;
      customerId: string;
      manifest: readonly ArchiveEntry[];
    }) {
      if (!input.orderId || !input.customerId) throw new Error("Archive identity required");
      const manifest = JSON.stringify(snapshotArchiveEntries(input.manifest));
      const hash = createHash("sha256").update(manifest).digest("hex");
      const [row] = await sql.query<ArchiveJob>(
        `insert into commerce_archive_jobs(id,order_id,customer_id,manifest_hash,manifest)
        values ($1,$2,$3,$4,$5::jsonb) on conflict(order_id,customer_id,manifest_hash)
        do update set manifest_hash=excluded.manifest_hash returning *`,
        [randomUUID(), input.orderId, input.customerId, hash, manifest],
      );
      return row;
    },
    async get(id: string, customer: string): Promise<ArchiveJob | null> {
      return (
        (
          await sql.query<ArchiveJob>(
            "select * from commerce_archive_jobs where id=$1 and customer_id=$2",
            [id, customer],
          )
        )[0] ?? null
      );
    },
    async claim(): Promise<ArchiveJob | null> {
      // Exhausted crashed attempts must not remain 'processing' forever.
      await sql.query(`update commerce_archive_jobs set status='failed',lease_token=null,leased_until=null,updated_at=now()
        where id in (select id from commerce_archive_jobs where status='processing' and leased_until<=now() and attempts>=5
          order by leased_until,id limit 50 for update skip locked)`);
      const token = randomUUID();
      return (
        (
          await sql.query<ArchiveJob>(
            `update commerce_archive_jobs set status='processing', attempts=attempts+1,
        lease_token=$1,leased_until=now()+interval '5 minutes',updated_at=now(),
        output_key='catalog/archives/' || id || '/' || $1 || '.zip', output_checksum=null,output_bytes=null
        where id=(select id from commerce_archive_jobs where attempts<5 and
          ((status in ('queued','retry') and available_at<=now()) or (status='processing' and leased_until<=now()))
          order by available_at,id limit 1 for update skip locked) returning *`,
            [token],
          )
        )[0] ?? null
      );
    },
    async heartbeat(id: string, token: string) {
      return (
        (
          await sql.query(
            `update commerce_archive_jobs set leased_until=now()+interval '5 minutes',updated_at=now()
        where id=$1 and lease_token=$2 and status='processing' and leased_until>now() returning id`,
            [id, token],
          )
        ).length === 1
      );
    },
    async complete(id: string, token: string, checksum: string, bytes: number) {
      if (
        !/^[a-f0-9]{64}$/.test(checksum) ||
        !Number.isSafeInteger(bytes) ||
        bytes < 1 ||
        bytes > 2 * 1024 ** 3
      )
        throw new Error("Invalid archive result");
      return (
        (
          await sql.query(
            `update commerce_archive_jobs set status='completed',lease_token=null,leased_until=null,
        output_checksum=$3,output_bytes=$4,updated_at=now()
        where id=$1 and lease_token=$2 and status='processing' and leased_until>now() returning id`,
            [id, token, checksum, bytes],
          )
        ).length === 1
      );
    },
    async retry(id: string, token: string) {
      return (
        (
          await sql.query(
            `update commerce_archive_jobs set status=case when attempts>=5 then 'failed' else 'retry' end,
        available_at=now()+interval '1 minute'*attempts,lease_token=null,leased_until=null,updated_at=now()
        where id=$1 and lease_token=$2 and status='processing' and leased_until>now() returning id`,
            [id, token],
          )
        ).length === 1
      );
    },
    async cancel(id: string, customer: string) {
      return (
        (
          await sql.query(
            `update commerce_archive_jobs set status='cancelled',lease_token=null,leased_until=null,updated_at=now()
        where id=$1 and customer_id=$2 and status in ('queued','retry','processing') returning id`,
            [id, customer],
          )
        ).length === 1
      );
    },
  };
}
