/** Read the database URL from an explicit variable or Cloudflare Hyperdrive. */
export function databaseConnectionString(): string | undefined {
  const env = process.env as unknown as Record<string, unknown>;
  const explicit = typeof env.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
  if (explicit) return explicit;
  const hyperdrive = env.HYPERDRIVE;
  if (hyperdrive && typeof hyperdrive === "object" && "connectionString" in hyperdrive) {
    const connectionString = (hyperdrive as { connectionString?: unknown }).connectionString;
    if (typeof connectionString === "string" && connectionString.trim()) return connectionString.trim();
  }
  return undefined;
}
