// Explicit operator recovery for a durable original rejected by hosted processing.
// Generates only metadata-free watermarked previews. Never edits source originals.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE_PATH || "sharp");
const photo = "6d169876-d149-489a-93c1-2f97acd3f5fa";
const owner = "STqzn0NbIrPCYwN0cbStSvCsA3alS5KF";
const gallery = "97c36bdd-7b15-46d6-83ae-950bc4d1b7b1";
const expected = "eae9996d7d57fa4cc62ca1c372cc59560d69266762bf6ed54abcb61b2c424c32";
const originalPath = process.argv[2],
  watermarkPath = process.argv[3];
if (!originalPath || !watermarkPath)
  throw new Error("Supply the approved source JPEG and watermark PNG");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const original = await readFile(originalPath);
if (hash(original) !== expected || original.length !== 20638004)
  throw new Error("Original identity mismatch");
const metadata = await sharp(original).metadata();
if (
  metadata.width !== 4672 ||
  metadata.height !== 7008 ||
  (metadata.orientation && metadata.orientation !== 1)
)
  throw new Error("Unexpected original orientation/dimensions");
const output = await mkdtemp(join(tmpdir(), "wgp-large-photo-recovery-"));
const variants = [];
for (const [name, edge] of Object.entries({
  placeholder: 48,
  thumbnail: 320,
  "thumbnail-2x": 640,
  small: 960,
  "small-2x": 1920,
  display: 2560,
})) {
  const overlay = await sharp(watermarkPath)
    .resize({ width: Math.round(edge * 0.5), withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < overlay.data.length; i += 4)
    overlay.data[i] = Math.round(overlay.data[i] * 0.5);
  const { data, info } = await sharp(original)
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .composite([{ input: overlay.data, raw: overlay.info, gravity: "centre" }])
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const check = await sharp(data).metadata();
  if (check.exif || check.xmp || check.iptc || data.length > 8 * 1024 * 1024)
    throw new Error("Unsafe preview metadata or size");
  const checksum = hash(data),
    file = join(output, `${name}.jpg`),
    key = `catalog/derivatives/v1/${photo}/${name}-${checksum}.jpg`;
  await writeFile(file, data, { flag: "wx" });
  variants.push({
    name,
    key,
    checksum,
    bytes: data.length,
    width: info.width,
    height: info.height,
    file,
  });
}
const originalKey = `catalog/originals/${photo}/${expected}`;
const objects = [
  ...variants,
  {
    name: "original",
    key: originalKey,
    checksum: expected,
    bytes: original.length,
    width: 4672,
    height: 7008,
    file: originalPath,
  },
];
if (process.argv.includes("--upload-staging")) {
  for (const item of objects) {
    for (const args of [
      [
        "put",
        `wgp-catalog-staging/${item.key}`,
        "--file",
        item.file,
        "--content-type",
        "image/jpeg",
        "--remote",
      ],
      [
        "get",
        `wgp-catalog-staging/${item.key}`,
        "--file",
        join(output, `${item.name}-readback.jpg`),
        "--remote",
      ],
    ]) {
      const result = spawnSync(
        "npx",
        [
          "--no-install",
          "wrangler",
          "r2",
          "object",
          ...args,
          "--config",
          "dist/server/wrangler.json",
          "--env",
          "",
        ],
        { stdio: "inherit" },
      );
      if (result.status !== 0) throw new Error("Staging R2 operation failed");
    }
    const actual = await readFile(join(output, `${item.name}-readback.jpg`));
    if (hash(actual) !== item.checksum || actual.length !== item.bytes)
      throw new Error("R2 readback mismatch");
  }
  const rows = objects
    .map(
      (v) =>
        `('${photo}','${v.name}',1,'${v.key}','image/jpeg',${v.bytes},'${v.checksum}',${v.width},${v.height})`,
    )
    .join(",\n");
  const sql = `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'; SELECT pg_advisory_xact_lock(742198034);
DO $$ BEGIN PERFORM id FROM catalog_photos WHERE id='${photo}' FOR UPDATE;
IF NOT EXISTS(SELECT 1 FROM catalog_photos WHERE id='${photo}' AND gallery_id='${gallery}' AND checksum='${expected}' AND bytes=20638004 AND status='needs_review') OR NOT EXISTS(SELECT 1 FROM catalog_media_jobs WHERE photo_id='${photo}' AND status='failed') OR EXISTS(SELECT 1 FROM commerce_entitlements WHERE photo_id='${photo}') THEN RAISE EXCEPTION 'Recovery identity/state guard failed'; END IF; END $$;
INSERT INTO catalog_media_variants(photo_id,name,transformation_version,object_key,mime,bytes,checksum,width,height) VALUES ${rows}
ON CONFLICT(photo_id,name,transformation_version) DO UPDATE SET object_key=excluded.object_key,bytes=excluded.bytes,checksum=excluded.checksum,width=excluded.width,height=excluded.height,updated_at=now();
INSERT INTO catalog_derivatives(photo_id,kind,object_key,bytes,checksum) SELECT photo_id,CASE name WHEN 'display' THEN 'preview' ELSE 'thumb' END,object_key,bytes,checksum FROM catalog_media_variants WHERE photo_id='${photo}' AND name IN ('display','thumbnail') AND transformation_version=1 ON CONFLICT(photo_id,kind) DO UPDATE SET object_key=excluded.object_key,bytes=excluded.bytes,checksum=excluded.checksum;
UPDATE catalog_photos SET status='ready',original_key='${originalKey}',width=4672,height=7008,error=null,updated_at=now() WHERE id='${photo}';
UPDATE catalog_media_jobs SET status='completed',stage='ready',progress_percent=100,lease_token=null,worker_id=null,leased_until=null,error_code=null,error_message=null,completed_at=now(),updated_at=now() WHERE photo_id='${photo}' AND status='failed';
INSERT INTO catalog_audit(id,actor_id,action,target_id) VALUES(gen_random_uuid()::text,'${owner}','photo.operator_preview_recovery','${photo}'); COMMIT;
SELECT count(*) AS total,count(*) FILTER(WHERE status='ready') AS ready FROM catalog_photos WHERE gallery_id='${gallery}';`;
  await writeFile(join(output, "verified-recovery.sql"), sql, { flag: "wx" });
}
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(
    {
      photo,
      originalChecksum: expected,
      originalUnchanged: hash(await readFile(originalPath)) === expected,
      objects,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    { output, variants: variants.length, uploaded: process.argv.includes("--upload-staging") },
    null,
    2,
  ),
);
