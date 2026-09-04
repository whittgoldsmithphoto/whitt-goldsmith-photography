/** Declaration validation only. The upload worker must independently inspect bytes,
 * verify sizes/checksums, and reject links before creating private assets.
 * This is not a ZIP parser or permission to extract an archive. */
export interface ManifestLimits {
  maxFiles: number;
  maxDepth: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_MANIFEST_LIMITS: Readonly<ManifestLimits> = Object.freeze({
  maxFiles: 1000,
  maxDepth: 8,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
});

export interface ManifestFile {
  readonly path: string;
  readonly size: number;
  readonly type: "image/jpeg" | "image/png";
}

const encoder = new TextEncoder();
function normalizedPath(value: unknown, maxDepth: number): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error("Invalid manifest path");
  const path = value.replaceAll("\\", "/").normalize("NFC");
  // Reject escapes instead of decoding them: mappings must never depend on a later URL decoder.
  if (!path || path.startsWith("/") || /[:%\p{Cc}\p{Cf}]/u.test(path) || encoder.encode(path).length > 1024) {
    throw new Error("Unsafe manifest path");
  }
  const parts = path.split("/");
  if (parts.length - 1 > maxDepth) throw new Error("Manifest depth limit exceeded");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.trim() !== part || part.endsWith(".") || encoder.encode(part).length > 255 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error("Unsafe manifest path component");
    }
  }
  return path;
}

/** Limits are trusted server configuration and may only tighten the safe defaults.
 * Input is an array of {path, size, type, kind: 'file'} declarations.
 * Returned paths are display/mapping identifiers, never R2 object keys. */
export function validateFolderManifest(input: unknown, overrides: Partial<ManifestLimits> = {}) {
  const limits = { ...DEFAULT_MANIFEST_LIMITS, ...overrides };
  for (const key of Object.keys(DEFAULT_MANIFEST_LIMITS) as (keyof ManifestLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_MANIFEST_LIMITS[key]) {
      throw new Error("Invalid manifest limit");
    }
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > limits.maxFiles) throw new Error("Invalid manifest file count");
  const files: ManifestFile[] = [];
  const fileNames = new Set<string>();
  const folders = new Map<string, string>();
  let totalBytes = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || raw.kind !== "file" || "symlink" in raw || "linkTarget" in raw) throw new Error("Only regular files are accepted");
    const path = normalizedPath(raw.path, limits.maxDepth);
    const extension = path.split(".").pop()?.toLowerCase();
    const type = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : null;
    if (!type || raw.type !== type) throw new Error("Unsupported manifest file type");
    if (!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > limits.maxFileBytes) throw new Error("Invalid manifest file size");
    if (raw.size > limits.maxTotalBytes - totalBytes) throw new Error("Manifest total byte limit exceeded");
    const canonical = path.toLowerCase();
    if (fileNames.has(canonical) || folders.has(canonical)) throw new Error("Manifest path collision");
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      const key = folder.toLowerCase();
      if (fileNames.has(key)) throw new Error("Manifest file used as directory");
      if (folders.has(key) && folders.get(key) !== folder) throw new Error("Manifest directory collision");
      folders.set(key, folder);
    }
    fileNames.add(canonical);
    totalBytes += raw.size;
    files.push(Object.freeze({ path, size: raw.size, type }));
  }
  return Object.freeze({ files: Object.freeze(files), folders: Object.freeze([...folders.values()].sort()), totalBytes });
}
