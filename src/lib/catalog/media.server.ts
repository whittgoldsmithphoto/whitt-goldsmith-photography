import { env } from "cloudflare:workers";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Secrets, r2ClientFrom } from "../secrets.server";
import type { CatalogMedia } from "./repository";
import { digest } from "./repository";
import { bindingStorage, type CatalogR2Binding } from "./r2-binding";
import { privateMetadataFreeJpeg } from "./jpeg-privacy";
import { mediaQueueConfigured } from "./media-queue.server";

type ImageChain = {
  transform(options: Record<string, unknown>): ImageChain;
  draw(image: ImageChain, options: Record<string, unknown>): ImageChain;
  output(options: Record<string, unknown>): Promise<{ response(): Response }>;
};
type Images = {
  input(bytes: ReadableStream): ImageChain;
  info(bytes: ReadableStream): Promise<{ width?: number; height?: number }>;
};
export function runtimeSetting(name: string) {
  const value = (env as unknown as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}
export async function catalogConfiguration() {
  const { databaseConnectionString } = await import("../runtime-env.server");
  const environment = runtimeSetting("CATALOG_ENV");
  const bound = Boolean((env as unknown as { CATALOG_BUCKET?: CatalogR2Binding }).CATALOG_BUCKET);
  return {
    environment: ["staging", "production"].includes(environment) ? environment : "unspecified",
    database: databaseConnectionString() ? "shared-postgres" : "ephemeral-local-pglite",
    r2Configured: bound || (environment !== "staging" && Boolean(await getR2Secrets())),
    storageMode: bound
      ? "worker-binding"
      : environment === "staging"
        ? "missing-staging-binding"
        : "s3-credentials",
    imagesConfigured: Boolean((env as unknown as { IMAGES?: unknown }).IMAGES),
    mediaQueueConfigured: mediaQueueConfigured(),
    watermarkConfigured: Boolean(runtimeSetting("CATALOG_WATERMARK_KEY")),
    verification: "configuration-only",
    checkedAt: new Date().toISOString(),
  };
}
export function catalogMedia(): CatalogMedia {
  const bucket = (env as unknown as { CATALOG_BUCKET?: CatalogR2Binding }).CATALOG_BUCKET;
  const bound = bucket ? bindingStorage(bucket) : undefined;
  async function connection() {
    if (runtimeSetting("CATALOG_ENV") === "staging")
      throw new Error("Staging requires its own CATALOG_BUCKET binding");
    const secrets = await getR2Secrets();
    if (!secrets) throw new Error("R2 is not configured");
    return { s3: r2ClientFrom(secrets), bucket: secrets.bucket };
  }
  async function get(key: string) {
    if (bound) return bound.get(key);
    const { s3, bucket } = await connection();
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error("Object missing");
    return result.Body.transformToByteArray();
  }
  return {
    // Defense in depth for derivatives created before metadata filtering was fixed.
    // Original reads stay byte-for-byte unchanged.
    async get(key) {
      const bytes = await get(key);
      return key.startsWith("catalog/derivatives/") ? privateMetadataFreeJpeg(bytes) : bytes;
    },
    async putOriginal(key, bytes, mime) {
      if (bound) return bound.putOriginal(key, bytes, mime);
      const { s3, bucket } = await connection();
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: mime,
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        // A disconnected response may have committed the object. A retry may
        // accept that exact original, but can never replace it with other bytes.
        if ((await digest(await get(key))) !== (await digest(bytes))) throw error;
      }
    },
    async putDerivative(key, bytes) {
      if (bound) return bound.putDerivative(key, bytes);
      const { s3, bucket } = await connection();
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "image/jpeg" }),
      );
    },
    async process(bytes) {
      const images = (env as unknown as { IMAGES?: Images }).IMAGES;
      const watermarkKey = runtimeSetting("CATALOG_WATERMARK_KEY");
      if (!images || !watermarkKey) throw new Error("Images binding and watermark required");
      const watermark = await get(watermarkKey);
      const stream = (input: Uint8Array) => new Response(new Uint8Array(input)).body!;
      const info = await images.info(stream(bytes));
      if (!info.width || !info.height || info.width * info.height > 60_000_000)
        throw new Error("Unsupported image dimensions");
      async function render(edge: number) {
        const response = (
          await images!
            .input(stream(bytes))
            .transform({ width: edge, height: edge, fit: "scale-down", metadata: "none" })
            .draw(
              images!
                .input(stream(watermark))
                .transform({ width: Math.round(edge * 0.5), fit: "scale-down" }),
              { opacity: 0.5 },
            )
            .output({ format: "image/jpeg", quality: 85 })
        ).response();
        if (!response.ok) throw new Error("Image rendering failed");
        return privateMetadataFreeJpeg(new Uint8Array(await response.arrayBuffer()));
      }
      return {
        width: info.width,
        height: info.height,
        preview: await render(2000),
        thumb: await render(480),
      };
    },
  };
}
