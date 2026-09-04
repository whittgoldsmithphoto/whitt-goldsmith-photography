import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, extname, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10000;
const suffixes = new Set([".jpg", ".jpeg", ".png"]);

function signature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  return null;
}

/** Read-only preparation. A valid header is not a full image decode; server processing remains authoritative. */
export async function createImportManifest(directory) {
  const root = resolve(directory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Source must be a real directory, not a symbolic link");
  const realRoot = await realpath(root);
  const files = [];
  async function visit(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (files.length >= MAX_FILES)
        throw new Error(`Import exceeds the ${MAX_FILES} file safety limit`);
      const path = resolve(folder, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) {
        files.push({
          path: relativePath,
          status: "unsupported",
          reason: "Symbolic links and nonregular files are never followed",
        });
        continue;
      }
      const before = await lstat(path);
      // Recheck the real path immediately before reading to catch directory symlink changes.
      const realFile = await realpath(path);
      if (!realFile.startsWith(realRoot + sep) || before.isSymbolicLink() || !before.isFile())
        throw new Error("Source changed during scanning; retry after exports finish");
      const record = {
        path: relativePath,
        bytes: before.size,
        modifiedAt: before.mtime.toISOString(),
      };
      if (!suffixes.has(extname(entry.name).toLowerCase())) {
        files.push({
          ...record,
          status: "unsupported",
          reason: "Export JPEG or PNG; RAW/TIFF ingestion is not available",
        });
        continue;
      }
      if (!before.size || before.size > MAX_IMPORT_BYTES) {
        files.push({
          ...record,
          status: "rejected",
          reason: before.size ? "Exceeds current 20 MiB upload limit" : "Empty file",
        });
        continue;
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let mime,
        checksum,
        unstable = false;
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          !(await realpath(path)).startsWith(realRoot + sep)
        )
          throw new Error("Source changed during scanning; retry after exports finish");
        const header = Buffer.alloc(8);
        const { bytesRead } = await handle.read(header, 0, 8, 0);
        mime = signature(header.subarray(0, bytesRead));
        if (mime) {
          const hash = createHash("sha256");
          let total = 0;
          for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
            hash.update(chunk);
            total += chunk.length;
            if (total > MAX_IMPORT_BYTES) {
              unstable = true;
              break;
            }
          }
          const after = await handle.stat();
          unstable ||=
            after.size !== before.size || after.mtimeMs !== before.mtimeMs || total !== before.size;
          checksum = hash.digest("hex");
        }
      } finally {
        await handle.close();
      }
      const extension = extname(entry.name).toLowerCase();
      if (!mime || (extension === ".png") !== (mime === "image/png")) {
        files.push({
          ...record,
          status: "rejected",
          reason: "File signature does not match JPEG/PNG filename",
        });
        continue;
      }
      if (unstable) {
        files.push({
          ...record,
          status: "unstable",
          reason: "File changed while reading; finish export and rescan",
        });
        continue;
      }
      files.push({ ...record, status: "eligible", mime, sha256: checksum });
    }
  }
  await visit(root);
  const originals = new Map();
  for (const file of files) {
    if (file.status !== "eligible") continue;
    if (originals.has(file.sha256)) {
      file.status = "duplicate";
      file.duplicateOf = originals.get(file.sha256);
    } else originals.set(file.sha256, file.path);
  }
  const counts = { eligible: 0, duplicate: 0, unsupported: 0, rejected: 0, unstable: 0 };
  for (const file of files) counts[file.status]++;
  return {
    version: 1,
    mode: "preparation-only",
    sourceFolder: basename(root),
    createdAt: new Date().toISOString(),
    uploaded: false,
    maxUploadBytes: MAX_IMPORT_BYTES,
    counts,
    files,
  };
}

export async function runImportManifest(args) {
  const usage =
    "Usage: node scripts/photo-import-manifest.mjs --source <export-folder> [--output <new-manifest.json>]";
  let source, output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1] && !source) source = args[++i];
    else if (args[i] === "--output" && args[i + 1] && !output) output = args[++i];
    else throw new Error(usage);
  }
  if (!source) throw new Error(usage);
  if (output && extname(output).toLowerCase() !== ".json")
    throw new Error("Output must be a new .json file");
  const manifest = await createImportManifest(source);
  const json = JSON.stringify(manifest, null, 2) + "\n";
  if (output) await writeFile(resolve(output), json, { flag: "wx", mode: 0o600 });
  return json;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runImportManifest(process.argv.slice(2))
    .then((json) => process.stdout.write(json))
    .catch((error) => {
      process.stderr.write(`Import preparation failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
