import { env } from "cloudflare:workers";
import { ZodError, z } from "zod";
import { getSql } from "../db";
import { assertCatalogOwner } from "../catalog/owner";
import { runtimeSetting } from "../catalog/media.server";
import { errorResponse, privateHeaders } from "../api/errors";
import { readLimited } from "../catalog/http.server";
import { createMultipartTransfer } from "./multipart-transfer";
import { createR2MultipartStore, type R2MultipartBinding } from "./r2-multipart";

const jsonId = z.string().uuid();
function binding() {
  return (env as unknown as { CATALOG_BUCKET?: R2MultipartBinding }).CATALOG_BUCKET;
}
async function owner() {
  const { getSessionUser } = await import("../auth/verify.server");
  return assertCatalogOwner((await getSessionUser())?.id, runtimeSetting("OWNER_USER_IDS"));
}

/** Staging-only owner endpoint for durable R2 multipart transfers. */
export async function multipartRequest(request: Request, uploadId?: string): Promise<Response> {
  try {
    if (runtimeSetting("CATALOG_ENV") !== "staging")
      return Response.json({ error: "Multipart transfers are not enabled here" }, { status: 404, headers: privateHeaders });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json({ error: "Same-origin request required" }, { status: 403, headers: privateHeaders });
    const bucket = binding();
    if (!bucket) return Response.json({ error: "Staging media storage is not configured" }, { status: 503, headers: privateHeaders });
    const actor = await owner();
    const transfer = createMultipartTransfer(await getSql(), createR2MultipartStore(bucket));
    const url = new URL(request.url);
    if (request.method === "POST" && !uploadId && url.searchParams.get("action") === "begin") {
      const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 32 * 1024)));
      return Response.json(await transfer.begin(actor, body), { status: 201, headers: privateHeaders });
    }
    const id = jsonId.parse(uploadId);
    if (request.method === "PUT") {
      const number = z.coerce.number().int().min(1).max(200).parse(url.searchParams.get("part"));
      const checksum = z.string().regex(/^[a-f0-9]{64}$/).parse(request.headers.get("x-content-sha256"));
      return Response.json(
        await transfer.uploadPart(actor, id, { number, checksum, bytes: await readLimited(request, 100 * 1024 * 1024) }),
        { headers: privateHeaders },
      );
    }
    if (request.method === "POST" && url.searchParams.get("action") === "complete")
      return Response.json(await transfer.complete(actor, id), { headers: privateHeaders });
    if (request.method === "DELETE")
      return Response.json(await transfer.abort(actor, id), { headers: privateHeaders });
    return Response.json({ error: "Multipart resource not found" }, { status: 404, headers: privateHeaders });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid multipart request" }, { status: 400, headers: privateHeaders });
    return errorResponse(error);
  }
}
