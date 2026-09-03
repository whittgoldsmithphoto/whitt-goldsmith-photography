import { ZodError } from "zod";
import { getSql } from "../db";
import { createCatalog, CatalogError } from "./repository";
import { catalogMedia, runtimeSetting } from "./media.server";
import { assertCatalogOwner } from "./owner";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const cookieName = (id: string) => `wgp-gallery-${id}`;
function token(request: Request, id: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName(id)}=`))
    ?.slice(cookieName(id).length + 1);
}
async function owner() {
  const { getSessionUser } = await import("../auth/verify.server");
  const user = await getSessionUser();
  return assertCatalogOwner(user?.id, runtimeSetting("OWNER_USER_IDS"));
}
export async function readLimited(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new CatalogError("Request body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new CatalogError("File or request exceeds the upload limit", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function catalogRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const op = url.searchParams.get("op") || "index";
    const id = url.searchParams.get("id") || "";
    const catalog = createCatalog(await getSql(), catalogMedia());
    if (request.method === "GET") {
      if (op === "index") return Response.json(await catalog.publicIndex(), { headers });
      if (op === "owner") {
        await owner();
        return Response.json(await catalog.ownerIndex(), { headers });
      }
      if (op === "detail")
        return Response.json(await catalog.detail(id, token(request, id)), { headers });
      if (op === "media") {
        const isOwner = url.searchParams.get("owner") === "1";
        if (isOwner) await owner();
        const galleryId = await catalog.photoGallery(id);
        const image = await catalog.media(
          id,
          url.searchParams.get("kind") || "",
          galleryId ? token(request, galleryId) : undefined,
          isOwner,
        );
        return new Response(new Uint8Array(image.bytes), {
          headers: { ...headers, "Content-Type": image.mime },
        });
      }
    }
    if (request.method === "POST") {
      if (request.headers.get("origin") !== url.origin)
        throw new CatalogError("Same-origin request required", 403);
      if (op === "upload") {
        const actor = await owner();
        return Response.json(
          await catalog.upload(id, await readLimited(request, 20 * 1024 * 1024), actor),
          { headers },
        );
      }
      const data = JSON.parse(new TextDecoder().decode(await readLimited(request, 32768)));
      if (op === "unlock") {
        const access = await catalog.unlock(id, data.password);
        return Response.json(
          { ok: true },
          {
            headers: {
              ...headers,
              "Set-Cookie": `${cookieName(id)}=${access}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${url.protocol === "https:" ? "; Secure" : ""}`,
            },
          },
        );
      }
      const actor = await owner();
      if (op === "photo") return Response.json(await catalog.savePhoto(data, actor), { headers });
      if (op === "gallery")
        return Response.json(await catalog.saveGallery(data, actor), { headers });
      if (op === "folder")
        return Response.json(await catalog.createFolder(data, actor), { headers });
      if (op === "reserve") return Response.json(await catalog.reserve(data, actor), { headers });
      if (op === "retry") return Response.json(await catalog.process(id, actor), { headers });
    }
    throw new CatalogError("Not found", 404);
  } catch (error) {
    if (error instanceof CatalogError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid request fields" }, { status: 400, headers });
    // Never return provider errors, signed URLs, connection strings, or SQL to the browser.
    return Response.json(
      { error: "The catalog service is unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
