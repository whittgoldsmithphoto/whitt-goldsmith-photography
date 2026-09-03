import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { RequireOwner } from "@/components/require-owner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { disconnectSmugmug, getSmugmugStatus, saveSmugmugApp, startSmugmugLogin } from "@/lib/shop-fns";

const searchSchema = z.object({
  smugmug: z.string().optional(),
  reason: z.string().optional(),
});

export const Route = createFileRoute("/migrate")({
  validateSearch: searchSchema,
  component: () => (
    <RequireOwner>
      <MigratePage />
    </RequireOwner>
  ),
});

function MigratePage() {
  const search = Route.useSearch();
  const [appBusy, setAppBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [smug, setSmug] = useState({
    hasApp: false,
    connected: false,
    nickName: "",
    displayName: "",
  });

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/smugmug/callback`);
    void getSmugmugStatus()
      .then(setSmug)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (search.smugmug === "connected") {
      toast("SmugMug is signed in.");
      void getSmugmugStatus().then(setSmug);
    } else if (search.smugmug === "error" && search.reason) {
      toast(search.reason);
    }
  }, [search.smugmug, search.reason]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Migrate</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Sign in with SmugMug so this shop can read galleries as you — including originals. Folders on
        this site stay empty until you create them and upload. I never see your password.
      </p>

      <section className="mt-8 rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-2xl">Sign in with SmugMug</h2>
        {smug.connected ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Signed in as <span className="font-medium">{smug.displayName || smug.nickName}</span>
              {smug.nickName ? ` · ${smug.nickName}` : ""}.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={loginBusy}
              onClick={() => {
                setLoginBusy(true);
                void disconnectSmugmug()
                  .then(() => {
                    setSmug((s) => ({ ...s, connected: false, nickName: "", displayName: "" }));
                    toast("SmugMug signed out.");
                  })
                  .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not disconnect"))
                  .finally(() => setLoginBusy(false));
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
              <li>
                Stay signed into SmugMug as you. Open{" "}
                <a
                  className="underline underline-offset-2"
                  href="https://api.smugmug.com/api/developer/apply"
                  target="_blank"
                  rel="noreferrer"
                >
                  api.smugmug.com/api/developer/apply
                </a>
                . App name: <span className="text-foreground">Whitt Goldsmith Photography</span>. If it asks
                for a callback URL, paste{" "}
                <code className="break-all text-foreground">{callbackUrl || "this shop’s /api/smugmug/callback"}</code>.
              </li>
              <li>Paste the API Key and API Secret below. That identifies this shop, not your login.</li>
              <li>
                Click <span className="text-foreground">Sign in with SmugMug</span> and allow Full / Read.
              </li>
            </ol>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setAppBusy(true);
                void saveSmugmugApp({ data: { apiKey, apiSecret } })
                  .then(() => {
                    setSmug((s) => ({ ...s, hasApp: true }));
                    setApiSecret("");
                    toast("API key saved. Sign in with SmugMug next.");
                  })
                  .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not save"))
                  .finally(() => setAppBusy(false));
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="sm-key">API Key</Label>
                <Input id="sm-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sm-secret">API Secret</Label>
                <Input
                  id="sm-secret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="new-password"
                  placeholder={smug.hasApp ? "Already saved — paste again only to replace" : ""}
                  required={!smug.hasApp}
                />
              </div>
              <Button type="submit" variant="outline" disabled={appBusy}>
                {appBusy ? "Saving…" : smug.hasApp ? "Update API key" : "Save API key"}
              </Button>
            </form>
            <Button
              type="button"
              size="lg"
              disabled={loginBusy || (!smug.hasApp && !apiKey)}
              onClick={() => {
                const run = async () => {
                  if (!smug.hasApp) {
                    if (!apiKey.trim() || !apiSecret.trim()) {
                      toast("Save the API key and secret first.");
                      return;
                    }
                    await saveSmugmugApp({ data: { apiKey, apiSecret } });
                    setSmug((s) => ({ ...s, hasApp: true }));
                  }
                  const { url } = await startSmugmugLogin();
                  window.location.assign(url);
                };
                setLoginBusy(true);
                void run().catch((err: unknown) => {
                  toast(err instanceof Error ? err.message : "Could not start SmugMug login");
                  setLoginBusy(false);
                });
              }}
            >
              {loginBusy ? "Opening SmugMug…" : "Sign in with SmugMug"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
