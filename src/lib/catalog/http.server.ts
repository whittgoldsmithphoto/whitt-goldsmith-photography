import { ZodError } from "zod";
import { getSql } from "../db";
import { createCatalog, CatalogError, digest } from "./repository";
import { catalogMedia, catalogConfiguration, runtimeSetting } from "./media.server";
import { assertCatalogOwner } from "./owner";
import { proofQuerySchema } from "./proof-query";
import { createFolderService } from "./folders";
import { dispatchMediaJob } from "./media-queue.server";
import { MAX_PHOTO_BYTES } from "./upload-limits";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Link: '</api/catalog/galleries>; rel="successor-version"',
  "X-Catalog-API": "legacy-compatibility",
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
async function customer() {
  const { getSessionUser } = await import("../auth/verify.server");
  const user = await getSessionUser();
  if (!user || user.id === "dev-user")
    throw new CatalogError("Sign in to save your selection", 401);
  return user.id;
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
      if (op === "capabilities") {
        const { getSessionUser } = await import("../auth/verify.server");
        const user = await getSessionUser();
        let isOwner = false;
        try {
          assertCatalogOwner(user?.id, runtimeSetting("OWNER_USER_IDS"));
          isOwner = true;
        } catch {
          /* No owner capability. */
        }
        return Response.json({ isOwner, checkoutAvailable: false }, { headers });
      }
      if (op === "diagnostics") {
        await owner();
        const sql = await getSql();
        const migrations = await sql<{ name: string }>`select name from _migrations order by name`;
        const required = [
          "0005_catalog.sql",
          "0006_photo_management.sql",
          "0007_proof_selections.sql",
          "0008_commerce.sql",
          "0009_sports_metadata.sql",
          "0010_folder_revisions.sql",
          "0011_commerce_session_outcomes.sql",
          "0012_gallery_customer_policy.sql",
          "0013_customer_download_authorization.sql",
          "0014_remove_legacy_download.sql",
          "0015_gallery_client_limits.sql",
          "0016_catalog_pagination_and_covers.sql",
          "0023_media_jobs.sql",
          "0028_gallery_downloads.sql",
          "0033_gallery_layout.sql",
        ];
        return Response.json(
          {
            ...(await catalogConfiguration()),
            missingMigrations: required.filter(
              (name) => !migrations.some((row) => row.name === name),
            ),
          },
          { headers },
        );
      }
      if (op === "proof")
        return Response.json(await catalog.readProof(id, await customer(), token(request, id)), {
          headers,
        });
      if (op === "owner-proofs") {
        await owner();
        return Response.json(await catalog.ownerProofs(), { headers });
      }
      if (op === "owner-proof-page") {
        await owner();
        return Response.json(
          await catalog.ownerProofPage(
            proofQuerySchema.parse({
              q: url.searchParams.get("q") ?? undefined,
              status: url.searchParams.get("status") ?? undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
              limit: url.searchParams.get("limit") ?? undefined,
            }),
          ),
          { headers },
        );
      }
      if (op === "index") return Response.json(await catalog.publicIndex(), { headers });
      if (op === "owner") {
        await owner();
        return Response.json(await catalog.ownerIndex(), { headers });
      }
      if (op === "folder-tree") {
        await owner();
        return Response.json(await createFolderService(await getSql()).folderTree(), { headers });
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
        const uploaded = await catalog.uploadOriginal(
          id,
          await readLimited(request, MAX_PHOTO_BYTES),
          actor,
        );
        if (await dispatchMediaJob(uploaded.jobId))
          return Response.json(uploaded, { headers, status: 202 });
        // Local development has no Cloudflare Queue. Preserve a real, testable
        // processing path there while deployed environments fail closed.
        return Response.json(await catalog.process(id, actor), { headers });
      }
      const data = JSON.parse(new TextDecoder().decode(await readLimited(request, 32768)));
      if (op === "proof")
        return Response.json(
          await catalog.saveProof(data, await customer(), token(request, data.galleryId)),
          { headers },
        );
      if (op === "unlock") {
        // Cloudflare supplies CF-Connecting-IP; do not trust caller-selected X-Forwarded-For.
        const secret = runtimeSetting("BETTER_AUTH_SECRET");
        if (!secret) throw new CatalogError("Gallery access is not configured", 503);
        const clientBucket = await digest(
          new TextEncoder().encode(
            `${secret}:${id}:${request.headers.get("CF-Connecting-IP") || "local"}`,
          ),
        );
        const access = await catalog.unlock(id, data.password, clientBucket);
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
      if (op === "proof-review")
        return Response.json(await catalog.reviewProof(data, actor), { headers });
      if (op === "photo") return Response.json(await catalog.savePhoto(data, actor), { headers });
      if (op === "gallery")
        return Response.json(await catalog.saveGallery(data, actor), { headers });
      if (op === "folder" || op === "folder-save")
        return Response.json(await createFolderService(await getSql()).saveFolder(data, actor), {
          headers,
        });
      if (op === "reserve") return Response.json(await catalog.reserve(data, actor), { headers });
      if (op === "retry") return Response.json(await catalog.process(id, actor), { headers });
      if (op === "cancel-processing")
        return Response.json(await catalog.cancelProcessing(id, actor), { headers });
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
