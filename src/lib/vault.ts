import { putBlob, getBlob, deleteBlob, isBlobSrc, blobIdFromSrc } from "./idb";
import type { Photo } from "./types";

const DISPLAY_EDGE = 2400;
const THUMB_EDGE = 480;

export type IngestedFile = {
  original: Blob;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  filename: string;
  mime: string;
  bytes: number;
  hash: string;
  title: string;
  takenAt?: number;
};

async function hashBuffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function encodeBitmap(bitmap: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photograph.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the photograph."))),
      "image/jpeg",
      quality,
    );
  });
  return { blob, width: w, height: h };
}

export async function ingestFile(file: File): Promise<IngestedFile> {
  const buffer = await file.arrayBuffer();
  const hash = await hashBuffer(buffer);
  const original = new Blob([buffer], { type: file.type || "image/jpeg" });
  const bitmap = await createImageBitmap(original);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const display = await encodeBitmap(bitmap, DISPLAY_EDGE, 0.86);
  const thumb = await encodeBitmap(bitmap, THUMB_EDGE, 0.78);
  bitmap.close();
  const filename = file.name || "untitled.jpg";
  const title = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return {
    original,
    display: display.blob,
    thumb: thumb.blob,
    width: display.width,
    height: display.height,
    originalWidth,
    originalHeight,
    filename,
    mime: file.type || "image/jpeg",
    bytes: original.size,
    hash,
    title,
    takenAt: file.lastModified || undefined,
  };
}

export async function storeVault(id: string, ingested: IngestedFile) {
  await putBlob(id, ingested.display);
  await putBlob(`${id}:orig`, ingested.original);
  await putBlob(`${id}:thumb`, ingested.thumb);
}

export async function removeVault(id: string) {
  await Promise.all([deleteBlob(id), deleteBlob(`${id}:orig`), deleteBlob(`${id}:thumb`)]);
}

export function vaultKeys(photo: Photo) {
  const keys = new Set<string>();
  for (const src of [photo.src, photo.originalSrc, photo.thumbSrc]) {
    if (src && isBlobSrc(src)) keys.add(blobIdFromSrc(src));
  }
  return keys;
}

export async function downloadOriginal(photo: Photo) {
  const src = photo.originalSrc || photo.src;
  let blob: Blob | undefined;
  if (isBlobSrc(src)) {
    blob = await getBlob(blobIdFromSrc(src));
  } else {
    const res = await fetch(src);
    blob = await res.blob();
  }
  if (!blob) throw new Error("Original is not in the vault.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = photo.filename || `${photo.title}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function displaySrc(photo: Pick<Photo, "src">) {
  return photo.src;
}

export function thumbSrc(photo: Pick<Photo, "src" | "thumbSrc">) {
  return photo.thumbSrc || photo.src;
}

export function originalSrc(photo: Pick<Photo, "src" | "originalSrc">) {
  return photo.originalSrc || photo.src;
}
