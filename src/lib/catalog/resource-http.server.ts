import { getSql } from "../db";
import { createCatalog, CatalogError } from "./repository";
import { catalogMedia, runtimeSetting } from "./media.server";
import { assertCatalogOwner } from "./owner";
import { createGalleryService } from "./gallery-service";
import { errorResponse, privateHeaders } from "../api/errors";
import { catalogRequest, readLimited } from "./http.server";
export async function catalogResourceRequest(request: Request): Promise<Response> {
  // TanStack splats also match an empty suffix. Preserve the exact legacy root.
  if (new URL(request.url).pathname === "/api/catalog") return catalogRequest(request);
  try {
    const url = new URL(request.url),
      path = url.pathname.slice("/api/catalog/".length).split("/");
    const coverWrite =
      request.method === "POST" &&
      path.length === 3 &&
      path[0] === "galleries" &&
      path[2] === "cover";
    if (request.method !== "GET" && !coverWrite) throw new CatalogError("Method not allowed", 405);
    if (coverWrite && request.headers.get("origin") !== url.origin)
      throw new CatalogError("Same-origin request required", 403);
    const owner = coverWrite || url.searchParams.get("owner") === "1" || path[0] === "library";
    let actor = "";
    if (owner) {
      const { getSessionUser } = await import("../auth/verify.server");
      actor = assertCatalogOwner((await getSessionUser())?.id, runtimeSetting("OWNER_USER_IDS"));
    }
    const sql = await getSql(),
      catalog = createCatalog(sql, catalogMedia()),
      service = createGalleryService(sql, catalog.authorizeGallery);
    const id = path[1];
    const grant = id
      ? request.headers
          .get("cookie")
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(`wgp-gallery-${id}=`))
          ?.slice(`wgp-gallery-${id}=`.length)
      : undefined;
    let data: unknown;
    if (coverWrite) {
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(await readLimited(request, 2048)));
      } catch (error) {
        if (error instanceof CatalogError) throw error;
        throw new CatalogError("Invalid JSON body");
      }
      data = await service.setCover(id, body, actor);
    } else if (path.length === 1 && path[0] === "galleries")
      data = await service.galleries(url.searchParams, owner);
    else if (path.length === 2 && path[0] === "galleries")
      data = await service.detail(id, grant, owner);
    else if (path.length === 3 && path[0] === "galleries" && path[2] === "photos")
      data = await service.photos(id, url.searchParams, grant, owner);
    else if (path.join("/") === "folders/tree")
      data = await service.folders(url.searchParams, owner);
    else if (path.length === 1 && path[0] === "library")
      data = await service.library(url.searchParams);
    else throw new CatalogError("Resource not found", 404);
    return Response.json(data, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
