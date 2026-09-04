import { ZodError } from "zod";
import { CatalogError } from "../catalog/errors.ts";
import type { IntegrityResult } from "./service.ts";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function handleIntegrityRequest(
  request: Request,
  deps: { owner: () => Promise<string>; verify: (input: unknown) => Promise<IntegrityResult> },
): Promise<Response> {
  try {
    if (request.method !== "POST") throw new CatalogError("Method not allowed", 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new CatalogError("Same-origin request required", 403);
    await deps.owner();
    const reader = request.body?.getReader();
    if (!reader) throw new CatalogError("Request body required");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 512) {
        await reader.cancel();
        throw new CatalogError("Integrity request too large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return Response.json(await deps.verify(JSON.parse(new TextDecoder().decode(bytes))), {
      headers,
    });
  } catch (error) {
    if (error instanceof CatalogError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json({ error: "Provide one valid photo ID" }, { status: 400, headers });
    return Response.json(
      {
        error:
          "Integrity could not be checked. Storage may be unavailable; retry later. No files were changed.",
      },
      { status: 503, headers },
    );
  }
}
