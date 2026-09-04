import { getSql } from "../db";
import { runtimeSetting } from "../catalog/media.server";
import { assertCatalogOwner } from "../catalog/owner";
import { createSportsService } from "./repository";
import { handleSportsRequest } from "./http";

export function sportsRequest(request: Request): Promise<Response> {
  return handleSportsRequest(request, {
    service: async () => createSportsService(await getSql()),
    owner: async () => {
      const { getSessionUser } = await import("../auth/verify.server");
      const user = await getSessionUser();
      return assertCatalogOwner(user?.id, runtimeSetting("OWNER_USER_IDS"));
    },
  });
}
