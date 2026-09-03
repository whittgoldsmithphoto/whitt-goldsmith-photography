import { env as cloudflareEnv } from "cloudflare:workers";

/** Read the database URL from an explicit variable or Cloudflare Hyperdrive. */
export function databaseConnectionString(): string | undefined {
  const env = process.env as unknown as Record<string, unknown>;
  const explicit = typeof env.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
  if (explicit) return explicit;
  // Accessing the Workers env proxy performs runtime I/O, so this function must
  // only be called from a request path (never during module initialization).
  const hyperdrive = env.HYPERDRIVE ?? (cloudflareEnv as unknown as Record<string, unknown>).HYPERDRIVE;
  if (hyperdrive && typeof hyperdrive === "object" && "connectionString" in hyperdrive) {
    const connectionString = (hyperdrive as { connectionString?: unknown }).connectionString;
    if (typeof connectionString === "string" && connectionString.trim()) return connectionString.trim();
  }
  return undefined;
}
