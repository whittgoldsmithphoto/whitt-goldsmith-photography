import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { pendingMigrations } from "./migration-plan.mjs";

// Never prints credentials or raw database errors. Explicitly pins the existing
// production endpoint, not staging and not its retained rollback branch.
let pool;
try {
  const url = new URL(process.env.DATABASE_URL || "");
  if (
    url.hostname !== "ep-silent-smoke-a5vz1fik-pooler.us-east-2.aws.neon.tech" ||
    url.pathname !== "/neondb" ||
    process.env.WGP_PRODUCTION_BACKUP_BRANCH !== "br-divine-sky-a52t2goq"
  )
    throw new Error("Production identity or rollback guard failed");
  url.searchParams.set("sslmode", "verify-full");
  pool = new pg.Pool({ connectionString: url.href, max: 1 });
  const client = await pool.connect();
  try {
    const applied = (await client.query("SELECT name FROM _migrations ORDER BY name")).rows.map(
      (r) => r.name,
    );
    const plan = await Promise.all(
      pendingMigrations(await readdir("migrations"), applied).map(async ({ name }) => ({
        name,
        sql: await readFile(`migrations/${name}`, "utf8"),
      })),
    );
    const before = (
      await client.query(
        'SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM shop_orders) AS legacy_orders,(SELECT count(*) FROM shop_settings) AS legacy_settings',
      )
    ).rows[0];
    console.log(JSON.stringify({ before, pending: plan.map((x) => x.name) }));
    if (process.argv[2] !== "apply") throw new Error("Explicit apply argument required");
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
      await client.query("SELECT pg_advisory_xact_lock(9022026)");
      for (const item of plan) {
        const already = await client.query("SELECT 1 FROM _migrations WHERE name=$1", [item.name]);
        if (already.rowCount) continue;
        await client.query(item.sql);
        await client.query("INSERT INTO _migrations(name) VALUES($1)", [item.name]);
      }
      const after = (
        await client.query(
          'SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM shop_orders) AS legacy_orders,(SELECT count(*) FROM shop_settings) AS legacy_settings',
        )
      ).rows[0];
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Retention check failed");
      await client.query("COMMIT");
      console.log(
        JSON.stringify({
          committed: true,
          retained: after,
          migrations: (await client.query("SELECT name FROM _migrations ORDER BY name")).rows,
        }),
      );
    } catch {
      await client.query("ROLLBACK");
      throw new Error("Migration failed and rolled back");
    }
  } finally {
    client.release();
  }
} catch {
  console.error(
    "Production migration did not complete. No credentials or database details logged.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
