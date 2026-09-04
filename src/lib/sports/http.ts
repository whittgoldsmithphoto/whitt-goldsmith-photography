import { ZodError } from "zod";
import { CatalogError } from "../catalog/errors.ts";
import type { createSportsService } from "./repository.ts";

type Dependencies = {
  service: () => Promise<ReturnType<typeof createSportsService>>;
  owner: () => Promise<string>;
};
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new CatalogError("Request body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16384) {
      await reader.cancel();
      throw new CatalogError("Metadata request too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function handleSportsRequest(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const operation = url.searchParams.get("op") || "search";
    if (request.method !== "GET" && request.method !== "POST")
      throw new CatalogError("Method not allowed", 405);
    if (request.method === "POST" && request.headers.get("origin") !== url.origin)
      throw new CatalogError("Same-origin request required", 403);
    if (request.method === "GET" && operation === "search") {
      const service = await dependencies.service();
      return Response.json(
        await service.search({
          query: url.searchParams.get("q") || "",
          offset: Number(url.searchParams.get("offset") || "0"),
        }),
        { headers },
      );
    }
    const actor = await dependencies.owner();
    const service = await dependencies.service();
    const photoId = url.searchParams.get("photoId") || "";
    if (request.method === "GET" && operation === "read")
      return Response.json(await service.read(photoId), { headers });
    if (request.method === "GET" && operation === "history")
      return Response.json(await service.history(photoId), { headers });
    if (request.method === "POST") {
      const data = await readBody(request);
      if (operation === "save") return Response.json(await service.save(data, actor), { headers });
      if (operation === "restore")
        return Response.json(await service.restore(data, actor), { headers });
    }
    throw new CatalogError("Not found", 404);
  } catch (error) {
    if (error instanceof CatalogError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "Invalid metadata or search fields" },
        { status: 400, headers },
      );
    return Response.json(
      { error: "Sports metadata is unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
