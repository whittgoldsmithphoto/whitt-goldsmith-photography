import { CatalogError } from "./errors.ts";
import { errorResponse, privateHeaders } from "../api/errors.ts";

export function libraryMetadataHandler(deps: {
  enabled: boolean;
  owner(): Promise<string>;
  service(): Promise<{
    list(params: URLSearchParams, actor: string): Promise<unknown>;
    bulk(input: unknown, actor: string): Promise<unknown>;
  }>;
}) {
  return async (request: Request) => {
    try {
      if (!["GET", "POST"].includes(request.method))
        throw new CatalogError("Method not allowed", 405);
      const url = new URL(request.url);
      if (request.method === "POST" && request.headers.get("origin") !== url.origin)
        throw new CatalogError("Same-origin request required", 403);
      const actor = await deps.owner();
      if (!actor || actor === "dev-user")
        throw new CatalogError("Sign in to access the studio", 401);
      if (!deps.enabled)
        throw new CatalogError("Library metadata is not enabled on this deployment yet", 503);
      const service = await deps.service();
      if (request.method === "GET")
        return Response.json(await service.list(url.searchParams, actor), {
          headers: privateHeaders,
        });
      if (url.search || !request.headers.get("content-type")?.startsWith("application/json"))
        throw new CatalogError("Use a JSON request body", 400);
      const reader = request.body?.getReader();
      if (!reader) throw new CatalogError("Request body required", 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 48_000) throw new CatalogError("Metadata request too large", 400);
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new CatalogError("Invalid JSON", 400);
      }
      const result = await service.bulk(body, actor);
      return Response.json(result, { headers: privateHeaders });
    } catch (error) {
      if (
        error instanceof Error &&
        ["Metadata changed; refresh before saving", "Photo unavailable"].includes(error.message)
      )
        return errorResponse(new CatalogError(error.message, 409));
      return errorResponse(error);
    }
  };
}
