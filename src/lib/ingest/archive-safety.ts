import { validateFolderManifest, type ManifestLimits, type ManifestFile } from "./folder-manifest.ts";

/** Metadata read from an archive central directory. No archive bytes are extracted here. */
export interface ArchiveEntry {
  readonly path: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly type?: "image/jpeg" | "image/png";
  /** ZIP general-purpose bit flag; bit 0 means encrypted. */
  readonly flags?: number;
  /** ZIP external attributes, used to identify Unix symlinks and directories. */
  readonly externalAttributes?: number;
  readonly kind?: "file" | "directory" | "symlink" | "other";
}

export interface ArchiveSafetyLimits extends ManifestLimits {
  maxArchiveBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_ARCHIVE_SAFETY_LIMITS: Readonly<ArchiveSafetyLimits> = Object.freeze({
  maxFiles: 1000,
  maxDepth: 8,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 100,
});

export interface SafeArchiveManifest {
  readonly files: readonly ManifestFile[];
  readonly folders: readonly string[];
  readonly totalBytes: number;
  readonly compressedBytes: number;
}

function isUnixSymlink(attributes: number | undefined) {
  if (attributes === undefined) return false;
  const mode = (attributes >>> 16) & 0xffff;
  return (mode & 0xf000) === 0xa000;
}

/**
 * Validates archive metadata before any extraction. Callers must still stream
 * extraction, verify file signatures/checksums, and enforce these limits again.
 */
export function validateArchiveEntries(input: unknown, overrides: Partial<ArchiveSafetyLimits> = {}): SafeArchiveManifest {
  const limits = { ...DEFAULT_ARCHIVE_SAFETY_LIMITS, ...overrides };
  for (const key of Object.keys(DEFAULT_ARCHIVE_SAFETY_LIMITS) as (keyof ArchiveSafetyLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_ARCHIVE_SAFETY_LIMITS[key]) {
      throw new Error("Invalid archive safety limit");
    }
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > limits.maxFiles) {
    throw new Error("Invalid archive entry count");
  }
  const files: Array<{ path: string; size: number; kind: "file"; type: "image/jpeg" | "image/png" }> = [];
  let compressedBytes = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid archive entry");
    const entry = raw as ArchiveEntry;
    if (entry.kind !== "file" || isUnixSymlink(entry.externalAttributes)) {
      throw new Error("Archive contains unsupported entry type");
    }
    if (typeof entry.flags !== "undefined" && (!Number.isSafeInteger(entry.flags) || entry.flags < 0 || (entry.flags & 1) !== 0)) {
      throw new Error("Encrypted archive entries are not accepted");
    }
    if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 || entry.compressedSize > limits.maxArchiveBytes) {
      throw new Error("Invalid compressed entry size");
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > limits.maxFileBytes) {
      throw new Error("Invalid uncompressed entry size");
    }
    if (entry.compressedSize === 0 || entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio) {
      throw new Error("Archive compression ratio limit exceeded");
    }
    compressedBytes += entry.compressedSize;
    if (compressedBytes > limits.maxArchiveBytes) throw new Error("Archive compressed byte limit exceeded");
    if (entry.type !== "image/jpeg" && entry.type !== "image/png") throw new Error("Unsupported archive file type");
    files.push({ path: entry.path, size: entry.uncompressedSize, kind: "file", type: entry.type });
  }
  const manifest = validateFolderManifest(files, limits);
  return Object.freeze({ ...manifest, compressedBytes });
}
