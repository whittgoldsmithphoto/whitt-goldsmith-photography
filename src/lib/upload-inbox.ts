import { unzipSync } from "fflate";
import type { Folder, Gallery } from "./types";
import { r2Slug } from "./r2-path";

export type IncomingFile = {
  path: string;
  file: File;
};

const IMAGE_RE = /\.(jpe?g|png|webp|tiff?|heic|gif)$/i;

export function isImageName(name: string) {
  const base = name.split("/").pop() || name;
  if (base.startsWith(".")) return false;
  if (name.includes("__MACOSX")) return false;
  return IMAGE_RE.test(base);
}

export function isZipFile(file: File) {
  const n = file.name.toLowerCase();
  return n.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function mimeFromName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}

function norm(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function expandZip(file: File): Promise<IncomingFile[]> {
  const stem = file.name.replace(/\.zip$/i, "");
  const raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const out: IncomingFile[] = [];
  for (const [name, data] of Object.entries(raw)) {
    if (!isImageName(name) || !data?.length) continue;
    const filename = name.split("/").pop() || name;
    const path = name.includes("/") ? name : `${stem}/${filename}`;
    out.push({
      path,
      file: new File([data], filename, { type: mimeFromName(filename) }),
    });
  }
  return out;
}

async function filesFromEntry(entry: FileSystemEntry, prefix: string): Promise<IncomingFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    if (isZipFile(file)) return expandZip(file);
    if (!isImageName(file.name)) return [];
    return [{ path: `${prefix}${file.name}`, file }];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested: IncomingFile[] = [];
  const next = `${prefix}${entry.name}/`;
  for (const child of children) nested.push(...(await filesFromEntry(child, next)));
  return nested;
}

export async function collectFromDataTransfer(dt: DataTransfer): Promise<IncomingFile[]> {
  const items = [...dt.items];
  if (items.some((item) => typeof item.webkitGetAsEntry === "function")) {
    const collected: IncomingFile[] = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      collected.push(...(await filesFromEntry(entry, "")));
    }
    if (collected.length) return collected;
  }
  return collectFromFileList(dt.files);
}

export async function collectFromFileList(list: FileList | File[]): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const file of Array.from(list)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (isZipFile(file)) {
      out.push(...(await expandZip(file)));
      continue;
    }
    if (!isImageName(file.name)) continue;
    out.push({ path: relative, file });
  }
  return out;
}

export function matchGalleryId(
  path: string,
  folders: Folder[],
  galleries: Gallery[],
  fallbackId: string | null,
) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  const dir = parts[parts.length - 1] || "";
  const parentDir = parts[parts.length - 2] || "";
  const candidates = [dir, parentDir, parts[0] || ""].filter(Boolean);
  let best: { id: string; score: number } | null = null;
  for (const gallery of galleries) {
    const folder = folders.find((f) => f.id === gallery.parentId);
    const names = [gallery.title, gallery.id, r2Slug(gallery.title), folder?.title ?? ""];
    for (const cand of candidates) {
      for (const name of names) {
        const score = scoreMatch(cand, name);
        if (score && (!best || score > best.score)) best = { id: gallery.id, score };
      }
    }
  }
  if (best && best.score >= 3) return best.id;
  return fallbackId;
}

function scoreMatch(a: string, b: string) {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 6;
  if (r2Slug(left) === r2Slug(right)) return 5;
  if (left.includes(right) || right.includes(left)) return 3;
  const leftParts = new Set(left.split(" "));
  const overlap = right.split(" ").filter((w) => w.length > 2 && leftParts.has(w)).length;
  if (overlap >= 2) return 2;
  return 0;
}

export function groupIncoming(
  incoming: IncomingFile[],
  folders: Folder[],
  galleries: Gallery[],
  fallbackId: string | null,
) {
  return incoming.map((item) => ({
    ...item,
    galleryId: matchGalleryId(item.path, folders, galleries, fallbackId),
  }));
}
