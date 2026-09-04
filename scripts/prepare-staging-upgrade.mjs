#!/usr/bin/env node
// Produces a reviewable SQL artifact. It never opens a database connection.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (
  !args.includes("--output") ||
  !args.includes("--sentinel-photo") ||
  ![4, 6].includes(args.length)
)
  throw new Error(
    "Usage: node scripts/prepare-staging-upgrade.mjs --output /absolute/new-file.sql --sentinel-photo STAGING_PHOTO_UUID [--after 0010|0012]",
  );
const sentinel = value("--sentinel-photo");
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sentinel))
  throw new Error("A staging-only photo UUID is required");
const later = args.includes("--after");
if ((later && !["0010", "0012"].includes(value("--after"))) || (args.length === 6 && !later))
  throw new Error("Only the explicitly reviewed --after 0010 or 0012 upgrades are supported");
const delivery = later && value("--after") === "0012";
const names = delivery
  ? ["0013_customer_download_authorization.sql"]
  : later
    ? ["0011_commerce_session_outcomes.sql", "0012_gallery_customer_policy.sql"]
    : ["0008_commerce.sql", "0009_sports_metadata.sql", "0010_folder_revisions.sql"];
const baseline = delivery
  ? "0012_gallery_customer_policy.sql"
  : later
    ? "0010_folder_revisions.sql"
    : "0007_proof_selections.sql";
const migrations = await Promise.all(
  names.map(async (name) => ({
    name,
    sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
  })),
);
const sql = `-- STAGING ONLY. Verify the Neon project before running this transaction.
-- Abort if the specific staging photograph or expected migration history is absent.
BEGIN;
SELECT pg_advisory_xact_lock(742198031);
DO $staging_guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog_photos WHERE id='${sentinel}') THEN
    RAISE EXCEPTION 'Staging sentinel photograph missing; refusing migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name='${baseline}') THEN
    RAISE EXCEPTION 'Expected baseline migration missing';
  END IF;
  IF EXISTS (SELECT 1 FROM _migrations WHERE name IN (${names.map((name) => `'${name}'`).join(",")})) THEN
    RAISE EXCEPTION 'Upgrade already applied or partially recorded; inspect before proceeding';
  END IF;
END $staging_guard$;
${migrations.map(({ name, sql }) => `\n-- ${name}\n${sql}\nINSERT INTO _migrations(name) VALUES('${name}');`).join("\n")}
COMMIT;
SELECT name FROM _migrations ORDER BY name;
`;
const output = resolve(value("--output"));
if (output.startsWith(fileURLToPath(new URL("../public/", import.meta.url))))
  throw new Error("Never export migration artifacts into public/");
await writeFile(output, sql, { flag: "wx", mode: 0o600 });
console.log(
  JSON.stringify({ output, migrations: names, bytes: Buffer.byteLength(sql), executed: false }),
);
