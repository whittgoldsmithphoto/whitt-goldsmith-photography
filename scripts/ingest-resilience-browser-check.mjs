import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import http from "node:http";
import { createServer } from "vite";
import { chromium } from "playwright";

// Local acceptance only: reject every remote database/provider environment.
for (const name of [
  "DATABASE_URL",
  "HYPERDRIVE",
  "CLOUDFLARE_ENV",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
])
  if (process.env[name]) throw new Error(`Remove remote configuration ${name} before local test`);

const origin = "http://localhost:8095";
process.env.VITE_AUTH_ENABLED = "true";
process.env.BETTER_AUTH_SECRET = "local-ingest-resilience-fixture-not-provider-secret";
process.env.BETTER_AUTH_URL = origin;
process.env.OWNER_USER_IDS = "synthetic-owner-before-registration";
process.env.CATALOG_ENV = "test";
process.env.CATALOG_WATERMARK_KEY = "synthetic-watermark";

const objects = new Map();
const queueBodies = [];
let renders = 0;
const jpeg = new Uint8Array([255, 216, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 255, 217]);
objects.set("synthetic-watermark", jpeg);
globalThis.__ingestResilienceEnv = {
  CATALOG_ENV: "test",
  CATALOG_WATERMARK_KEY: "synthetic-watermark",
  CATALOG_BUCKET: {
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async put(key, value, options) {
      const bytes = new Uint8Array(value);
      if (options?.onlyIf?.get("If-None-Match") === "*" && objects.has(key)) return null;
      objects.set(key, bytes.slice());
      return {};
    },
  },
  MEDIA_QUEUE: {
    async send(body) {
      queueBodies.push(structuredClone(body));
    },
  },
  IMAGES: {
    input() {
      return {
        transform() {
          return this;
        },
        draw() {
          return this;
        },
        async output() {
          renders++;
          return {
            response: () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
          };
        },
      };
    },
    async info() {
      return { width: 600, height: 400 };
    },
  },
};

const server = await createServer({
  server: { host: "127.0.0.1", port: 8095, strictPort: true },
  logLevel: "error",
  plugins: [
    {
      name: "local-ingest-resilience-bindings",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/src/lib/node-worker-env.ts"))
          return "export const env = new Proxy(process.env,{get(target,key){return globalThis.__ingestResilienceEnv?.[key] ?? target[key]}});";
      },
    },
  ],
});

function queueMessage(body, attempts = 1) {
  const actions = [];
  return {
    body,
    attempts,
    actions,
    ack: () => actions.push(["ack"]),
    retry: (options) => actions.push(["retry", options?.delaySeconds]),
  };
}

let browser;
try {
  const runtime = await server.ssrLoadModule("/src/lib/runtime-env.server.ts");
  assert.equal(
    Boolean(runtime.databaseConnectionString()),
    false,
    "Harness must use ephemeral PGlite",
  );
  const { getSql } = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await getSql();
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext(),
    stranger = await browser.newContext();
  async function signup(context, name) {
    const response = await context.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { Origin: origin },
      data: {
        email: `${randomUUID()}@example.invalid`,
        password: randomUUID() + randomUUID(),
        name,
      },
    });
    assert.equal(response.status(), 200);
    return (await response.json()).user.id;
  }
  const ownerId = await signup(owner, "Synthetic ingest owner");
  process.env.OWNER_USER_IDS = ownerId;
  await signup(stranger, "Synthetic stranger");
  const galleryId = randomUUID();
  await sql.query("insert into catalog_galleries(id,title) values($1,'SYNTHETIC PRIVATE INGEST')", [
    galleryId,
  ]);

  const checksum = createHash("sha256").update(jpeg).digest("hex");
  const idempotencyKey = randomUUID();
  const declaration = {
    galleryId,
    filename: "synthetic-interrupted.jpg",
    mime: "image/jpeg",
    bytes: jpeg.length,
    checksum,
    idempotencyKey,
  };
  const first = await owner.request.post(`${origin}/api/catalog?op=reserve`, {
    headers: { Origin: origin },
    data: declaration,
  });
  assert.equal(first.status(), 200);
  const reservation = await first.json();
  const replay = await owner.request.post(`${origin}/api/catalog?op=reserve`, {
    headers: { Origin: origin },
    data: declaration,
  });
  assert.equal(replay.status(), 200);
  assert.equal(
    (await replay.json()).id,
    reservation.id,
    "Lost reservation response replays one photo",
  );
  assert.equal(
    (
      await sql.query("select count(*)::int as count from catalog_photos where gallery_id=$1", [
        galleryId,
      ])
    )[0].count,
    1,
  );

  const cookies = (await owner.cookies(origin))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  await new Promise((resolve) => {
    const request = http.request(`${origin}/api/catalog?op=upload&id=${reservation.id}`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookies,
        "Content-Type": "application/octet-stream",
        "Content-Length": jpeg.length,
      },
    });
    request.on("error", () => resolve());
    request.write(jpeg.slice(0, 3));
    request.destroy();
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  let [photo] = await sql.query("select status from catalog_photos where id=$1", [reservation.id]);
  assert.equal(photo.status, "reserved", "Interrupted body cannot mutate or store the reservation");
  assert.equal([...objects.keys()].filter((key) => key.includes(reservation.id)).length, 0);

  const unauthorized = await stranger.request.post(
    `${origin}/api/catalog?op=upload&id=${reservation.id}`,
    {
      headers: { Origin: origin, "Content-Type": "application/octet-stream" },
      data: Buffer.from(jpeg),
    },
  );
  assert.equal(unauthorized.status(), 403, "Another signed-in account cannot resume the upload");
  const upload = await owner.request.post(`${origin}/api/catalog?op=upload&id=${reservation.id}`, {
    headers: { Origin: origin, "Content-Type": "application/octet-stream" },
    data: Buffer.from(jpeg),
  });
  assert.equal(upload.status(), 202, "Retry commits original and queues durable processing");
  const uploaded = await upload.json();
  assert.equal(uploaded.status, "uploaded");
  assert.equal(queueBodies.length, 1);
  assert.deepEqual(queueBodies[0], { version: 1, jobId: uploaded.jobId });

  const { createCatalog } = await server.ssrLoadModule("/src/lib/catalog/repository.ts");
  const { catalogMedia } = await server.ssrLoadModule("/src/lib/catalog/media.server.ts");
  const { loadMediaJob } = await server.ssrLoadModule("/src/lib/catalog/media-jobs.ts");
  const { processMediaQueueBatch } = await server.ssrLoadModule("/src/lib/catalog/media-queue.ts");
  const catalog = createCatalog(sql, catalogMedia());
  const dependencies = {
    loadJob: (id) => loadMediaJob(sql, id),
    processJob: async (job) => {
      const result = await catalog.process(job.photoId, job.ownerId);
      if (result.status !== "ready") throw new Error("Synthetic job did not finish");
    },
  };
  const delivery = queueMessage(queueBodies[0]);
  await processMediaQueueBatch({ messages: [delivery] }, dependencies);
  assert.deepEqual(delivery.actions, [["ack"]]);
  assert.equal(renders, 6, "One accepted job renders each required derivative exactly once");
  const duplicate = queueMessage(queueBodies[0], 2);
  await processMediaQueueBatch({ messages: [duplicate] }, dependencies);
  assert.deepEqual(duplicate.actions, [["ack"]], "Terminal duplicate delivery is acknowledged");
  assert.equal(renders, 6, "Duplicate delivery never reprocesses a completed job");
  const poison = queueMessage({
    version: 1,
    jobId: uploaded.jobId,
    originalKey: "must-not-be-accepted",
  });
  await processMediaQueueBatch({ messages: [poison] }, dependencies);
  assert.deepEqual(
    poison.actions,
    [["ack"]],
    "Malformed envelopes fail closed without queue poisoning",
  );

  [photo] = await sql.query("select status,original_key from catalog_photos where id=$1", [
    reservation.id,
  ]);
  assert.equal(photo.status, "ready");
  assert.match(photo.original_key, /^catalog\/originals\//);
  assert.equal(
    (
      await sql.query("select count(*)::int as count from catalog_media_jobs where photo_id=$1", [
        reservation.id,
      ])
    )[0].count,
    1,
  );
  assert.equal(
    (
      await sql.query(
        "select count(*)::int as count from catalog_media_variants where photo_id=$1",
        [reservation.id],
      )
    )[0].count,
    7,
  );
  console.log(
    "PASS: local-only real HTTP/auth upload reservation replay, interrupted-body fail-closed state, authorized retry, durable queue envelope, exact processing manifest, duplicate delivery idempotency, and malformed-envelope acknowledgement. Storage, image processing, and queue are synthetic local bindings; no live provider or deployment data was used.",
  );
} finally {
  await browser?.close();
  await server.close();
  delete globalThis.__ingestResilienceEnv;
}
