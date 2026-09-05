import { unzipSync } from "fflate";
import { MAX_PHOTO_BYTES } from "./upload-limits.ts";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 1000;

function isImageName(name: string) {
  return /\.(jpe?g|png)$/i.test(name);
}

function isImageFile(file: File) {
  return (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    (file.type === "" && isImageName(file.name))
  );
}

function isZip(file: File) {
  return file.type === "application/zip" || file.type === "application/x-zip-compressed" || /\.zip$/i.test(file.name);
}

function asJpegPng(file: File): File {
  if (file.type === "image/jpeg" || file.type === "image/png") return file;
  const type = /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

async function filesFromZip(file: File): Promise<File[]> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("That zip is larger than 512 MB.");
  const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const out: File[] = [];
  for (const [path, bytes] of Object.entries(unzipped)) {
    const name = path.split("/").pop() || path;
    if (!isImageName(name) || name.startsWith(".")) continue;
    if (bytes.byteLength > MAX_PHOTO_BYTES) continue;
    const type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
    out.push(new File([bytes.slice()], name, { type }));
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, err?: (error: Error) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FileSystemEntryLike[]) => void, err?: (error: Error) => void) => void };
};

function readFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file?.(resolve, reject);
  });
}

async function walkEntry(entry: FileSystemEntryLike, bucket: File[]): Promise<void> {
  if (bucket.length >= MAX_FILES) return;
  if (entry.isFile) {
    bucket.push(await readFile(entry));
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  const batch = (): Promise<FileSystemEntryLike[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  let more = await batch();
  while (more.length) {
    for (const child of more) await walkEntry(child, bucket);
    more = await batch();
  }
}

async function fromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const walks: Promise<void>[] = [];
  for (const item of Array.from(transfer.items)) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.();
    if (entry) walks.push(walkEntry(entry, collected));
    else {
      const file = item.getAsFile();
      if (file) collected.push(file);
    }
  }
  await Promise.all(walks);
  if (!collected.length) collected.push(...Array.from(transfer.files));
  return collected;
}

export async function collectUploadFiles(
  input: FileList | File[] | DataTransfer | null | undefined,
): Promise<File[]> {
  if (!input) return [];
  const isTransfer = typeof DataTransfer !== "undefined" && input instanceof DataTransfer;
  const raw = isTransfer
    ? await fromDataTransfer(input)
    : Array.from(Array.isArray(input) ? input : Array.from(input as FileList));
  const images: File[] = [];
  for (const file of raw) {
    if (isZip(file)) images.push(...(await filesFromZip(file)));
    else if (isImageFile(file)) images.push(asJpegPng(file));
  }
  return images.slice(0, MAX_FILES);
}
