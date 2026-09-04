import { env } from "cloudflare:workers";
import { getSql } from "../db";
import { getSessionUser } from "../auth/verify.server";
import { createCatalog } from "../catalog/repository";
import { catalogMedia, runtimeSetting } from "../catalog/media.server";
import { readVerifiedOriginal } from "../catalog-integrity/service";
import {
  createCustomerDownloadHandler,
  customerDownloadsEnabled,
  CustomerDownloadError,
} from "./customer-download";

export async function customerDownloadRequest(request: Request) {
  const enabled = customerDownloadsEnabled(runtimeSetting);
  if (!enabled)
    return Response.json(
      { error: "Purchased download delivery is disabled pending sandbox acceptance" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      },
    );
  try {
    const sql = await getSql();
    const catalog = createCatalog(sql, catalogMedia());
    function galleryToken(id: string) {
      const name = `wgp-gallery-${id}=`;
      return request.headers
        .get("cookie")
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(name))
        ?.slice(name.length);
    }
    return await createCustomerDownloadHandler(true, {
      sql,
      user: async () => {
        const account = await getSessionUser();
        if (!account || account.id === "dev-user")
          throw new CustomerDownloadError("Sign in to download", 401);
        return account.id;
      },
      authorizeGallery: async (id) => {
        const name = `wgp-gallery-${id}=`;
        const token = request.headers
          .get("cookie")
          ?.split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith(name))
          ?.slice(name.length);
        return (await catalog.detail(id, token)).gallery.revision;
      },
      galleryGrantHash: async (id) => {
        const token = galleryToken(id);
        if (!token || token.length > 100) return null;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        );
      },
      readOriginal: async (key, expectedBytes, expectedChecksum) => {
        const bucket = (
          env as unknown as {
            CATALOG_BUCKET?: {
              get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array> } | null>;
            };
          }
        ).CATALOG_BUCKET;
        if (!bucket) throw new CustomerDownloadError("Download storage unavailable", 503);
        const object = await bucket.get(key);
        if (!object) throw new CustomerDownloadError("Download storage unavailable", 503);
        const result = await readVerifiedOriginal(object, expectedBytes, expectedChecksum);
        if (result.status !== "verified")
          throw new CustomerDownloadError("Original integrity verification failed", 503);
        return result.bytes;
      },
    })(request);
  } catch {
    return Response.json(
      { error: "Download service unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
