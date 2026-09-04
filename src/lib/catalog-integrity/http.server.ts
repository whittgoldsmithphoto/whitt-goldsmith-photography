import { env } from "cloudflare:workers";
import { getSql } from "../db";
import { assertCatalogOwner } from "../catalog/owner";
import { runtimeSetting } from "../catalog/media.server";
import { CatalogError } from "../catalog/errors";
import { createIntegrityService, type IntegrityStorage, integrityInput } from "./service";
import { handleIntegrityRequest } from "./http";
export function integrityRequest(request: Request) {
  return handleIntegrityRequest(request, {
    owner: async () => {
      const { getSessionUser } = await import("../auth/verify.server");
      return assertCatalogOwner((await getSessionUser())?.id, runtimeSetting("OWNER_USER_IDS"));
    },
    verify: async (input) => {
      const parsed = integrityInput.parse(input);
      // The native binding exposes a size and stream, so a corrupt oversized object
      // is rejected before loading its body. Never fall back to another bucket.
      const bucket = (env as unknown as { CATALOG_BUCKET?: IntegrityStorage }).CATALOG_BUCKET;
      if (!bucket)
        throw new CatalogError("Integrity checks require the private catalog storage binding", 503);
      return createIntegrityService(await getSql(), bucket)(parsed);
    },
  });
}
