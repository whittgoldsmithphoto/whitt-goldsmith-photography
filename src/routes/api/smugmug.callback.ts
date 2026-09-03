import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/smugmug/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const fail = (reason: string) =>
          Response.redirect(`${origin}/migrate?smugmug=error&reason=${encodeURIComponent(reason)}`, 302);
        try {
          const token = url.searchParams.get("oauth_token")?.trim() || "";
          const verifier = url.searchParams.get("oauth_verifier")?.trim() || "";
          if (!token || !verifier) return fail("SmugMug did not send a verifier. Try Sign in again.");
          const { getSql } = await import("@/lib/db");
          const { getSmugmugSecrets, saveSmugmugAccess, writeSetting } = await import("@/lib/secrets.server");
          const { getAccessToken, fetchAuthUser } = await import("@/lib/smugmug-oauth.server");
          const secrets = await getSmugmugSecrets();
          if (!secrets) return fail("API key missing. Save it on Migrate and try again.");
          const sql = await getSql();
          const rows = await sql<{ value: string }>`
            select value from shop_settings where key = ${"smugmug_oauth_pending"}
          `;
          let pending: { token?: string; secret?: string } = {};
          try {
            pending = JSON.parse(rows[0]?.value || "{}") as typeof pending;
          } catch {
            pending = {};
          }
          if (!pending.token || !pending.secret || pending.token !== token) {
            return fail("That login expired. Click Sign in with SmugMug again.");
          }
          const access = await getAccessToken({
            consumerKey: secrets.apiKey,
            consumerSecret: secrets.apiSecret,
            token: pending.token,
            tokenSecret: pending.secret,
            verifier,
          });
          const user = await fetchAuthUser({
            consumerKey: secrets.apiKey,
            consumerSecret: secrets.apiSecret,
            token: access.token,
            tokenSecret: access.secret,
          });
          await saveSmugmugAccess({
            accessToken: access.token,
            accessTokenSecret: access.secret,
            nickName: user.nickName,
            displayName: user.name,
          });
          await writeSetting("smugmug_oauth_pending", "{}");
          return Response.redirect(`${origin}/migrate?smugmug=connected`, 302);
        } catch (err) {
          const message = err instanceof Error ? err.message : "SmugMug login failed.";
          return fail(message);
        }
      },
    },
  },
});
