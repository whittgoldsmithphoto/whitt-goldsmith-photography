import { getSql } from "../db";
import { getSessionUser } from "../auth/verify.server";
import { assertCatalogOwner } from "../catalog/owner";
import { createCatalog, CatalogError } from "../catalog/repository";
import { catalogMedia, runtimeSetting } from "../catalog/media.server";
import { commerceHeaders, createCommerceHandler } from "./http";

export async function commerceRequest(request: Request) {
  try {
    const sql = await getSql();
    const catalog = createCatalog(sql, catalogMedia());
    async function user() {
      const account = await getSessionUser();
      if (!account || account.id === "dev-user") throw new CatalogError("Sign in to continue", 401);
      return account.id;
    }
    return await createCommerceHandler({
      sql,
      user,
      owner: async () => assertCatalogOwner(await user(), runtimeSetting("OWNER_USER_IDS")),
      authorizeGallery: async (galleryId) => {
        const name = `wgp-gallery-${galleryId}=`;
        const token = request.headers
          .get("cookie")
          ?.split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith(name))
          ?.slice(name.length);
        return (await catalog.detail(galleryId, token)).gallery.revision;
      },
    })(request);
  } catch {
    return Response.json(
      { error: "Commerce service is unavailable" },
      { status: 503, headers: commerceHeaders },
    );
  }
}
