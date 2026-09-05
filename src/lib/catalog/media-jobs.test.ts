import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import {
  claimNextMediaJob,
  claimMediaJobForPhoto,
  cancelMediaJobForPhoto,
  completeMediaJob,
  enqueueMediaJob,
  failMediaJob,
  heartbeatMediaJob,
  loadMediaJob,
  listDispatchableMediaJobs,
  advanceMediaJobStage,
} from "./media-jobs.ts";

async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(new URL("../../../migrations/0005_catalog.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(new URL("../../../migrations/0023_media_jobs.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("../../../migrations/0026_media_job_progress.sql", import.meta.url),
      "utf8",
    ),
  );
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let query = strings[0];
    for (let index = 0; index < values.length; index++)
      query += `$${index + 1}${strings[index + 1]}`;
    return (await db.query(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, values: unknown[] = []) =>
    (await db.query<T>(query, values)).rows;
  await sql`insert into catalog_galleries(id,title) values ('00000000-0000-4000-8000-000000000001','Test')`;
  await sql`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status)
    values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner','photo.jpg','image/jpeg',4,${"a".repeat(64)},'catalog/originals/test','uploaded')`;
  return { db, sql };
}

test("dispatch reconciliation makes exhausted crashed jobs retryable by the owner, not stuck processing", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 1,
      maxAttempts: 1,
    });
    const lease = await claimNextMediaJob(f.sql, "crashed-worker", 300);
    assert.ok(lease);
    assert.deepEqual(await listDispatchableMediaJobs(f.sql, 10), []);
    assert.equal((await loadMediaJob(f.sql, job.id))?.status, "processing");
    await f.sql`update catalog_media_jobs set leased_until=now()-interval '1 second' where id=${job.id}`;
    assert.deepEqual(await listDispatchableMediaJobs(f.sql, 10), []);
    assert.equal((await loadMediaJob(f.sql, job.id))?.status, "failed");
    assert.equal(await completeMediaJob(f.sql, job.id, lease!.leaseToken!), false);
    const retry = await enqueueMediaJob(f.sql, {
      photoId: job.photoId,
      ownerId: "owner",
      transformationVersion: 1,
    });
    assert.equal(retry.status, "queued");
    assert.equal(retry.attempts, 0);
    assert.equal((await listDispatchableMediaJobs(f.sql, 10)).length, 1);
  } finally {
    await f.db.close();
  }
});

test("media jobs are idempotent, exclusively claimed, and require the active lease to complete", async () => {
  const f = await fixture();
  try {
    const first = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 1,
    });
    const replay = await enqueueMediaJob(f.sql, {
      photoId: first.photoId,
      ownerId: "owner",
      transformationVersion: 1,
    });
    assert.equal(replay.id, first.id);
    assert.deepEqual(await loadMediaJob(f.sql, first.id), first);
    assert.equal(await loadMediaJob(f.sql, "00000000-0000-4000-8000-000000000099"), null);

    const claimed = await claimNextMediaJob(f.sql, "worker-a", 300);
    assert.equal(claimed?.id, first.id);
    assert.equal(claimed?.attempts, 1);
    assert.equal(await claimNextMediaJob(f.sql, "worker-b", 300), null);
    assert.equal(await completeMediaJob(f.sql, first.id, "wrong-token"), false);
    assert.equal(await completeMediaJob(f.sql, first.id, claimed!.leaseToken!), true);
    assert.equal(await claimNextMediaJob(f.sql, "worker-b", 300), null);
  } finally {
    await f.db.close();
  }
});

test("failed jobs retry after their backoff and stale processing leases are reclaimable", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 2,
      maxAttempts: 2,
    });
    const first = await claimNextMediaJob(f.sql, "worker-a", 300);
    assert.ok(first);
    assert.equal(
      await failMediaJob(
        f.sql,
        job.id,
        first!.leaseToken!,
        "processor_unavailable",
        "Retry safely",
        0,
      ),
      true,
    );
    const retry = await claimNextMediaJob(f.sql, "worker-b", 300);
    assert.equal(retry?.id, job.id);
    assert.equal(retry?.attempts, 2);
    assert.equal(
      await failMediaJob(f.sql, job.id, retry!.leaseToken!, "processor_unavailable", "Stopped", 0),
      true,
    );
    assert.equal(await claimNextMediaJob(f.sql, "worker-c", 300), null);

    const operatorRetry = await enqueueMediaJob(f.sql, {
      photoId: job.photoId,
      ownerId: "owner",
      transformationVersion: 2,
      maxAttempts: 2,
    });
    assert.equal(operatorRetry.status, "queued");
    assert.equal(operatorRetry.attempts, 0);
    await f.sql`update catalog_media_jobs set status='processing',lease_token='dead',leased_until=now()-interval '1 second',available_at=now() where id=${job.id}`;
    const reclaimed = await claimNextMediaJob(f.sql, "worker-c", 300);
    assert.equal(reclaimed?.id, job.id);
    assert.notEqual(reclaimed?.leaseToken, "dead");
  } finally {
    await f.db.close();
  }
});

test("a photo-scoped claim cannot be stolen or completed by a stale processor", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 3,
    });
    const claimed = await claimMediaJobForPhoto(f.sql, job.photoId, "request-a", 300);
    assert.equal(claimed?.id, job.id);
    assert.equal(await claimMediaJobForPhoto(f.sql, job.photoId, "request-b", 300), null);
    assert.equal(await completeMediaJob(f.sql, job.id, "stale"), false);
  } finally {
    await f.db.close();
  }
});

test("the outbox sweep returns only bounded runnable or stale jobs", async () => {
  const f = await fixture();
  try {
    const completed = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 10,
    });
    const claimed = await claimMediaJobForPhoto(f.sql, completed.photoId, "worker", 300);
    assert.equal(claimed?.id, completed.id);
    assert.equal(await completeMediaJob(f.sql, claimed!.id, claimed!.leaseToken!), true);
    const future = await enqueueMediaJob(f.sql, {
      photoId: completed.photoId,
      ownerId: "owner",
      transformationVersion: 11,
    });
    await f.sql`update catalog_media_jobs set available_at=now()+interval '1 hour' where id=${future.id}`;

    assert.deepEqual(
      (await listDispatchableMediaJobs(f.sql, 1)).map((job) => job.id),
      [],
      "completed and future jobs are not redispatched",
    );
    await f.sql`update catalog_media_jobs set available_at=now() where id=${future.id}`;
    assert.deepEqual(
      (await listDispatchableMediaJobs(f.sql, 1)).map((job) => job.id),
      [future.id],
      "the sweep is ordered and bounded",
    );
    await assert.rejects(() => listDispatchableMediaJobs(f.sql, 0), /Invalid dispatch limit/);
  } finally {
    await f.db.close();
  }
});

test("owner cancellation fences active work, leaves review state, and can be explicitly resumed", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 20,
    });
    const claimed = await claimMediaJobForPhoto(f.sql, job.photoId, "worker", 300);
    assert.ok(claimed?.leaseToken);
    assert.equal(await cancelMediaJobForPhoto(f.sql, job.photoId, "attacker"), false);
    assert.equal(await cancelMediaJobForPhoto(f.sql, job.photoId, "owner"), true);
    assert.equal((await loadMediaJob(f.sql, job.id))?.status, "cancelled");
    assert.equal(await completeMediaJob(f.sql, job.id, claimed!.leaseToken!), false);
    assert.deepEqual(await listDispatchableMediaJobs(f.sql, 10), []);
    const photo = await f.sql<{
      status: string;
      operation_token: string | null;
    }>`select status,operation_token from catalog_photos where id=${job.photoId}`;
    assert.deepEqual(photo[0], { status: "needs_review", operation_token: null });

    const resumed = await enqueueMediaJob(f.sql, {
      photoId: job.photoId,
      ownerId: "owner",
      transformationVersion: 20,
    });
    assert.equal(resumed.id, job.id);
    assert.equal(resumed.status, "queued");
    assert.equal(resumed.attempts, 0);
  } finally {
    await f.db.close();
  }
});

test("job stages advance monotonically only for the active lease", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 30,
    });
    const claimed = await claimMediaJobForPhoto(f.sql, job.photoId, "worker", 300);
    assert.equal(claimed?.stage, "validating");
    assert.equal(claimed?.progressPercent, 10);
    assert.equal(await advanceMediaJobStage(f.sql, job.id, "wrong", "metadata", 35), false);
    assert.equal(
      await advanceMediaJobStage(f.sql, job.id, claimed!.leaseToken!, "metadata", 35),
      true,
    );
    assert.equal(
      await advanceMediaJobStage(f.sql, job.id, claimed!.leaseToken!, "validating", 20),
      false,
    );
    assert.equal(
      await advanceMediaJobStage(f.sql, job.id, claimed!.leaseToken!, "derivatives", 60),
      true,
    );
    const advanced = await loadMediaJob(f.sql, job.id);
    assert.equal(advanced?.stage, "derivatives");
    assert.equal(advanced?.progressPercent, 60);
  } finally {
    await f.db.close();
  }
});

test("heartbeats extend only a live active lease and never revive stale work", async () => {
  const f = await fixture();
  try {
    const job = await enqueueMediaJob(f.sql, {
      photoId: "00000000-0000-4000-8000-000000000002",
      ownerId: "owner",
      transformationVersion: 31,
    });
    const claimed = await claimMediaJobForPhoto(f.sql, job.photoId, "worker", 60);
    assert.ok(claimed?.leaseToken);
    assert.equal(await heartbeatMediaJob(f.sql, job.id, "wrong", 300), false);
    assert.equal(await heartbeatMediaJob(f.sql, job.id, claimed!.leaseToken!, 300), true);

    const extended = await f.sql<{
      seconds: number;
    }>`select extract(epoch from (leased_until-now()))::int as seconds
      from catalog_media_jobs where id=${job.id}`;
    assert.ok(extended[0].seconds > 240);

    await f.sql`update catalog_media_jobs set leased_until=now()-interval '1 second' where id=${job.id}`;
    assert.equal(await heartbeatMediaJob(f.sql, job.id, claimed!.leaseToken!, 300), false);
    await assert.rejects(
      () => heartbeatMediaJob(f.sql, job.id, claimed!.leaseToken!, 0),
      /Invalid lease duration/,
    );
  } finally {
    await f.db.close();
  }
});
