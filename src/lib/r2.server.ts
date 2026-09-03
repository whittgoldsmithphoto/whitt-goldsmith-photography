import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Secrets, r2ClientFrom } from "./secrets.server";
import { legacyR2Key, r2Ext, r2ObjectKey, r2Stem, type R2Kind } from "./r2-path";

export { r2GalleryPrefix, r2ObjectKey, r2Slug } from "./r2-path";

export function r2Key(photoId: string, kind: R2Kind) {
  return legacyR2Key(photoId, kind);
}

export function r2UploadKey(input: {
  photoId: string;
  kind: R2Kind;
  folderSlug?: string;
  gallerySlug?: string;
  filename?: string;
  contentType?: string;
}) {
  if (input.folderSlug && input.gallerySlug && input.filename) {
    return r2ObjectKey({
      folderSlug: input.folderSlug,
      gallerySlug: input.gallerySlug,
      stem: r2Stem(input.filename, input.photoId),
      kind: input.kind,
      ext: r2Ext(input.filename, input.contentType || "", input.kind),
    });
  }
  return legacyR2Key(input.photoId, input.kind);
}

async function connected() {
  const secrets = await getR2Secrets();
  if (!secrets) return null;
  return { secrets, s3: r2ClientFrom(secrets) };
}

export async function presignPut(key: string, contentType: string) {
  const conn = await connected();
  if (!conn) throw new Error("R2 is not connected.");
  return getSignedUrl(
    conn.s3,
    new PutObjectCommand({
      Bucket: conn.secrets.bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 60 * 15 },
  );
}

export async function presignGet(key: string, filename?: string, seconds = 60 * 15) {
  const conn = await connected();
  if (!conn) throw new Error("R2 is not connected.");
  return getSignedUrl(
    conn.s3,
    new GetObjectCommand({
      Bucket: conn.secrets.bucket,
      Key: key,
      ResponseContentDisposition: filename ? `attachment; filename="${filename}"` : undefined,
    }),
    { expiresIn: seconds },
  );
}

export async function getObjectStream(key: string) {
  const conn = await connected();
  if (!conn) return null;
  const res = await conn.s3.send(new GetObjectCommand({ Bucket: conn.secrets.bucket, Key: key }));
  return res;
}
