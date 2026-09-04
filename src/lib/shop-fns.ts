import { createServerFn } from "@tanstack/react-start";
import { ownerMiddleware as authMiddleware } from "@/lib/auth/owner-middleware";
import type { Address } from "./address";
import { addressReady } from "./address";

export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getR2Secrets, getStripeSecrets, getSmugmugSecrets, smugmugConnected } =
      await import("./secrets.server");
    const r2 = await getR2Secrets();
    const stripe = await getStripeSecrets();
    const smug = await getSmugmugSecrets();
    return {
      r2: Boolean(r2),
      r2Bucket: r2?.bucket || "",
      // Stripe is only "connected" for the shop when both the API key and
      // webhook signing secret are present. An API key alone can create a
      // checkout session but cannot safely fulfill orders.
      stripe: Boolean(stripe?.secretKey && stripe.webhookSecret),
      stripeLive: Boolean(stripe?.secretKey.startsWith("sk_live_")),
      webhook: Boolean(stripe?.webhookSecret),
      smugmug: smugmugConnected(smug),
    };
  });

export const probeIntegrations = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { probeIntegrations: probe } = await import("./secrets.server");
    return probe();
  });

export const saveR2Connection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      publicBaseUrl: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { saveR2Secrets } = await import("./secrets.server");
    return saveR2Secrets(data);
  });

export const saveStripeConnection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { secretKey: string; webhookSecret: string }) => input)
  .handler(async ({ data }) => {
    const { saveStripeSecrets } = await import("./secrets.server");
    return saveStripeSecrets(data);
  });

export const saveStudioShipFrom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: Address) => input)
  .handler(async ({ data }) => {
    if (!addressReady(data))
      throw new Error("Ship-from needs a street, city, state, ZIP, and phone.");
    const { writeSetting } = await import("./secrets.server");
    await writeSetting("ship_from", JSON.stringify(data));
    return { ok: true as const };
  });

export const loadShipFrom = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getSql } = await import("./db");
    const sql = await getSql();
    const rows = await sql<{
      value: string;
    }>`select value from shop_settings where key = ${"ship_from"}`;
    if (!rows[0]?.value) return null;
    try {
      return JSON.parse(rows[0].value) as Address;
    } catch {
      return null;
    }
  });

export const createR2Upload = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      photoId: string;
      kind: "orig" | "display" | "thumb";
      contentType: string;
      folderSlug?: string;
      gallerySlug?: string;
      filename?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { r2Ready } = await import("./secrets.server");
    if (!(await r2Ready())) return { connected: false as const };
    const { presignPut, r2UploadKey } = await import("./r2.server");
    const key = r2UploadKey(data);
    const url = await presignPut(key, data.contentType || "image/jpeg");
    return { connected: true as const, url, key };
  });

export const createStripeCheckout = createServerFn({ method: "POST" })
  .validator(
    (input: {
      email: string;
      name: string;
      note: string;
      items: { productId: string; name: string; amount: number; qty: number; photoId?: string }[];
      successPath: string;
      cancelPath: string;
    }) => input,
  )
  .handler(async () => {
    // Legacy callers must not bypass the unavailable checkout screen. Replace
    // this boundary only when server quotes and fulfillment pass acceptance.
    throw new Error(
      "Purchasing is unavailable while server pricing and fulfillment are being verified.",
    );
  });

export const getSmugmugStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getSmugmugSecrets, smugmugConnected } = await import("./secrets.server");
    const secrets = await getSmugmugSecrets();
    return {
      hasApp: Boolean(secrets?.apiKey),
      connected: smugmugConnected(secrets),
      nickName: secrets?.nickName || "",
      displayName: secrets?.displayName || "",
    };
  });

export const saveSmugmugApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { apiKey: string; apiSecret: string }) => input)
  .handler(async ({ data }) => {
    const { saveSmugmugApp: save } = await import("./secrets.server");
    return save(data);
  });

export const startSmugmugLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getSmugmugSecrets, writeSetting } = await import("./secrets.server");
    const secrets = await getSmugmugSecrets();
    if (!secrets) throw new Error("Paste the SmugMug API key and secret first.");
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    const callback = `${origin}/api/smugmug/callback`;
    const { getRequestToken, authorizeUrl } = await import("./smugmug-oauth.server");
    const request = await getRequestToken({
      consumerKey: secrets.apiKey,
      consumerSecret: secrets.apiSecret,
      callback,
    });
    await writeSetting(
      "smugmug_oauth_pending",
      JSON.stringify({ token: request.token, secret: request.secret, at: Date.now() }),
    );
    return { url: authorizeUrl(request.token) };
  });

export const disconnectSmugmug = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { disconnectSmugmug: disconnect } = await import("./secrets.server");
    await disconnect();
    return { ok: true as const };
  });

export const listShopOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const { getSql } = await import("./db");
    const sql = await getSql();
    return sql<{
      id: string;
      number: string;
      created_at: string;
      status: string;
      buyer_name: string;
      buyer_email: string;
      total: number;
    }>`select id, number, created_at, status, buyer_name, buyer_email, total from shop_orders order by created_at desc limit 80`;
  });
