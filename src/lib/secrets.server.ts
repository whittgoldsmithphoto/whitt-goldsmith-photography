import { HeadBucketCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import Stripe from "stripe";
import { getSql } from "./db";

export type R2Secrets = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

export type StripeSecrets = {
  secretKey: string;
  webhookSecret: string;
};

export type SmugmugSecrets = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  nickName: string;
  displayName: string;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readSetting(key: string) {
  const sql = await getSql();
  const rows = await sql<{ value: string }>`select value from shop_settings where key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function writeSetting(key: string, value: string) {
  const sql = await getSql();
  await sql`
    insert into shop_settings (key, value)
    values (${key}, ${value})
    on conflict (key) do update set value = excluded.value
  `;
}

export async function getR2Secrets(): Promise<R2Secrets | null> {
  const stored = parseJson<Partial<R2Secrets>>(await readSetting("r2"));
  const accountId = stored?.accountId?.trim() || env("R2_ACCOUNT_ID");
  const accessKeyId = stored?.accessKeyId?.trim() || env("R2_ACCESS_KEY_ID");
  const secretAccessKey = stored?.secretAccessKey?.trim() || env("R2_SECRET_ACCESS_KEY");
  const bucket = stored?.bucket?.trim() || env("R2_BUCKET");
  const publicBaseUrl = (stored?.publicBaseUrl?.trim() || env("R2_PUBLIC_BASE_URL")).replace(/\/$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export async function getStripeSecrets(): Promise<StripeSecrets | null> {
  const stored = parseJson<Partial<StripeSecrets>>(await readSetting("stripe"));
  const secretKey = stored?.secretKey?.trim() || env("STRIPE_SECRET_KEY");
  const webhookSecret = stored?.webhookSecret?.trim() || env("STRIPE_WEBHOOK_SECRET");
  if (!secretKey) return null;
  return { secretKey, webhookSecret };
}

export async function getSmugmugSecrets(): Promise<SmugmugSecrets | null> {
  const stored = parseJson<Partial<SmugmugSecrets>>(await readSetting("smugmug"));
  const apiKey = stored?.apiKey?.trim() || env("SMUGMUG_API_KEY");
  const apiSecret = stored?.apiSecret?.trim() || env("SMUGMUG_API_SECRET");
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    accessToken: stored?.accessToken?.trim() || env("SMUGMUG_ACCESS_TOKEN"),
    accessTokenSecret: stored?.accessTokenSecret?.trim() || env("SMUGMUG_ACCESS_TOKEN_SECRET"),
    nickName: stored?.nickName?.trim() || "",
    displayName: stored?.displayName?.trim() || "",
  };
}

export function r2ClientFrom(secrets: R2Secrets) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${secrets.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey },
  });
}

export async function saveR2Secrets(input: Partial<R2Secrets>) {
  const existing = await getR2Secrets();
  const next: R2Secrets = {
    accountId: (input.accountId ?? existing?.accountId ?? "").trim(),
    accessKeyId: (input.accessKeyId ?? existing?.accessKeyId ?? "").trim(),
    secretAccessKey: (input.secretAccessKey || existing?.secretAccessKey || "").trim(),
    bucket: (input.bucket ?? existing?.bucket ?? "").trim(),
    publicBaseUrl: (input.publicBaseUrl ?? existing?.publicBaseUrl ?? "").trim().replace(/\/$/, ""),
  };
  if (!next.accountId || !next.accessKeyId || !next.secretAccessKey || !next.bucket) {
    throw new Error("R2 needs account ID, access key, secret, and bucket.");
  }
  const s3 = r2ClientFrom(next);
  await s3.send(new HeadBucketCommand({ Bucket: next.bucket }));
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: next.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch {
    /* CORS may already be set in the dashboard */
  }
  await writeSetting("r2", JSON.stringify(next));
  return { ok: true as const, bucket: next.bucket };
}

export async function saveStripeSecrets(input: { secretKey?: string; webhookSecret?: string }) {
  const existing = await getStripeSecrets();
  const secretKey = (input.secretKey || existing?.secretKey || "").trim();
  const webhookSecret = (input.webhookSecret || existing?.webhookSecret || "").trim();
  if (!secretKey) throw new Error("Paste the Stripe secret key (sk_live_… or sk_test_…).");
  if (!secretKey.startsWith("sk_")) throw new Error("That is not a Stripe secret key. Use sk_live_ or sk_test_ from Developers → API keys.");
  const stripe = new Stripe(secretKey);
  await stripe.balance.retrieve();
  await writeSetting("stripe", JSON.stringify({ secretKey, webhookSecret }));
  return { ok: true as const, live: secretKey.startsWith("sk_live_") };
}

export async function saveSmugmugApp(input: { apiKey: string; apiSecret: string }) {
  const existing = await getSmugmugSecrets();
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim() || existing?.apiSecret || "";
  if (!apiKey || !apiSecret) throw new Error("SmugMug needs the API key and the API secret from the apply page.");
  await writeSetting(
    "smugmug",
    JSON.stringify({
      apiKey,
      apiSecret,
      accessToken: existing?.apiKey === apiKey ? existing.accessToken : "",
      accessTokenSecret: existing?.apiKey === apiKey ? existing.accessTokenSecret : "",
      nickName: existing?.apiKey === apiKey ? existing.nickName : "",
      displayName: existing?.apiKey === apiKey ? existing.displayName : "",
    }),
  );
  return { ok: true as const };
}

export async function saveSmugmugAccess(input: {
  accessToken: string;
  accessTokenSecret: string;
  nickName: string;
  displayName: string;
}) {
  const existing = await getSmugmugSecrets();
  if (!existing) throw new Error("Save the SmugMug API key first.");
  await writeSetting("smugmug", JSON.stringify({ ...existing, ...input }));
}

export async function disconnectSmugmug() {
  const existing = await getSmugmugSecrets();
  if (!existing) return;
  await writeSetting(
    "smugmug",
    JSON.stringify({ ...existing, accessToken: "", accessTokenSecret: "", nickName: "", displayName: "" }),
  );
}

export function smugmugConnected(secrets: SmugmugSecrets | null) {
  return Boolean(secrets?.apiKey && secrets.accessToken && secrets.accessTokenSecret);
}

export async function r2Ready() {
  return Boolean(await getR2Secrets());
}

export async function stripeReady() {
  return Boolean(await getStripeSecrets());
}

export function maskSecret(value: string) {
  if (value.length < 8) return value ? "••••" : "";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function probeIntegrations() {
  const r2 = await getR2Secrets();
  const stripe = await getStripeSecrets();
  let r2Ok = false;
  let stripeOk = false;
  if (r2) {
    try {
      await r2ClientFrom(r2).send(new HeadBucketCommand({ Bucket: r2.bucket }));
      r2Ok = true;
    } catch {
      r2Ok = false;
    }
  }
  if (stripe) {
    try {
      await new Stripe(stripe.secretKey).balance.retrieve();
      stripeOk = true;
    } catch {
      stripeOk = false;
    }
  }
  return { r2: r2Ok, stripe: stripeOk, webhook: Boolean(stripe?.webhookSecret) };
}
