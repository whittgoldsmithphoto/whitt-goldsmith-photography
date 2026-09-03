import { CatalogError } from "./repository.ts";

/** Only stable, explicitly configured account IDs can administer this studio. */
export function assertCatalogOwner(userId: string | undefined, configuredIds: string) {
  const allowed = configuredIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!userId || userId === "dev-user") throw new CatalogError("Sign in to access the studio", 401);
  if (!allowed.length)
    throw new CatalogError(
      "Owner access has not been configured. Set OWNER_USER_IDS to the owner account ID.",
      503,
    );
  if (!allowed.includes(userId))
    throw new CatalogError("This account is not the studio owner", 403);
  return userId;
}
