import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const script = new URL("./prepare-staging-upgrade.mjs", import.meta.url).pathname;
const sentinel = "26f16aa2-4dfa-48d3-826e-78bc3cee47ec";

for (const after of [undefined, "0010", "0012"]) {
  test(`staging SQL artifact ${after || "baseline"} is guarded, private, and never overwritten`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "wgp-migration-artifact-test-"));
    try {
      const output = join(directory, "upgrade.sql");
      const args = [script, "--output", output, "--sentinel-photo", sentinel];
      if (after) args.push("--after", after);
      const result = await execute(process.execPath, args);
      const report = JSON.parse(result.stdout);
      assert.equal(report.executed, false);
      assert.equal(
        report.migrations.at(-1),
        after === "0012"
          ? "0013_customer_download_authorization.sql"
          : after
            ? "0012_gallery_customer_policy.sql"
            : "0010_folder_revisions.sql",
      );
      const sql = await readFile(output, "utf8");
      assert.match(sql, /BEGIN;[\s\S]*pg_advisory_xact_lock/);
      assert.ok(sql.includes(sentinel));
      assert.match(sql, /Upgrade already applied or partially recorded/);
      assert.match(sql, /COMMIT;\nSELECT name FROM _migrations/);
      assert.ok(sql.includes(after ? "0012_gallery_customer_policy.sql" : "0008_commerce.sql"));
      assert.equal((await stat(output)).mode & 0o777, 0o600);
      await assert.rejects(execute(process.execPath, args), /EEXIST/);
      assert.equal(await readFile(output, "utf8"), sql);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("migration artifact rejects malformed sentinel and unknown upgrade profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wgp-migration-artifact-invalid-"));
  try {
    const output = join(directory, "must-not-exist.sql");
    await assert.rejects(
      execute(process.execPath, [
        script,
        "--output",
        output,
        "--sentinel-photo",
        "------------------------------------",
      ]),
      /UUID/,
    );
    await assert.rejects(
      execute(process.execPath, [
        script,
        "--output",
        output,
        "--sentinel-photo",
        sentinel,
        "--after",
        "production",
      ]),
      /explicitly reviewed/,
    );
    await assert.rejects(stat(output), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
