import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RequireOwner } from "@/components/require-owner";
import { livePhotos, useStudioStore, vaultBytes } from "@/lib/store";
import {
  getIntegrationStatus,
  loadShipFrom,
  saveR2Connection,
  saveStripeConnection,
  saveStudioShipFrom,
} from "@/lib/shop-fns";
import { addressReady, emptyAddress, US_STATES, type Address } from "@/lib/address";
import { formatBytes, formatCount } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: () => (
    <RequireOwner>
      <SettingsPage />
    </RequireOwner>
  ),
});

function SettingsPage() {
  const studio = useStudioStore((s) => s.studio);
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = useStudioStore((s) => s.photos);
  const updateStudio = useStudioStore((s) => s.updateStudio);
  const resetStudio = useStudioStore((s) => s.resetStudio);
  const [name, setName] = useState(studio.name);
  const [tagline, setTagline] = useState(studio.tagline);
  const [location, setLocation] = useState(studio.location);
  const [about, setAbout] = useState(studio.about);
  const [confirm, setConfirm] = useState(false);

  const live = livePhotos(photos);
  const removed = photos.filter((p) => p.archived).length;
  const used = vaultBytes(photos);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Studio
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Settings</h1>
      <p className="mt-2 text-muted-foreground">
        Your name on the door. Paste R2 and Stripe here — never in chat. Publish on Cloudflare (same account as R2).
      </p>

      <form
        className="mt-10 grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          updateStudio({
            name: name.trim() || "Whitt Goldsmith Photography",
            tagline: tagline.trim(),
            location: location.trim(),
            about: about.trim(),
            watermark: studio.watermark,
            protect: studio.protect,
          });
          toast("Studio updated");
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="st-name">Studio name</Label>
          <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-tag">Tagline</Label>
          <Input id="st-tag" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-loc">Location</Label>
          <Input id="st-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-about">About</Label>
          <Textarea id="st-about" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={studio.watermark !== false}
            onChange={(e) => updateStudio({ watermark: e.target.checked })}
          />
          Display watermark on the public wall
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={studio.protect !== false}
            onChange={(e) => updateStudio({ protect: e.target.checked })}
          />
          Lock right-click on public photographs
        </label>
        <div>
          <Button type="submit">Save</Button>
        </div>
      </form>

      <div className="mt-16 border-t border-border pt-10">
        <h2 className="font-display text-2xl">Vault</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Originals are stored in this browser. Display and thumb sizes are derived on ingest, the way
          a photo host keeps one master file.
        </p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Used</dt>
            <dd className="font-display mt-1 text-3xl tabular-nums">{formatBytes(used)}</dd>
          </div>
          <div className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Originals</dt>
            <dd className="font-display mt-1 text-3xl tabular-nums">{live.length}</dd>
          </div>
          <div className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Folders</dt>
            <dd className="font-display mt-1 text-3xl tabular-nums">{folders.length}</dd>
          </div>
          <div className="rounded-xl bg-card px-4 py-4 shadow-[var(--shadow-border)]">
            <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Galleries</dt>
            <dd className="font-display mt-1 text-3xl tabular-nums">{galleries.length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">
          {formatCount(removed, "photograph")} in Removed.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/organize">Open Organizer</Link>
        </Button>
      </div>

      <div className="mt-16 border-t border-border pt-10">
        <h2 className="font-display text-2xl">Connections</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cloudflare R2 holds originals as library/sport/gallery/filename/. Stripe takes payment and
          tax. Guests check out without an account. The site itself publishes as a Cloudflare Worker
          (HOSTING.md). WHCC waits.
        </p>
        <IntegrationsPanel />
      </div>

      <div className="mt-16 border-t border-border pt-10">
        <h2 className="font-display text-2xl">Selling</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Price lists, coupons, and orders. Attach a list to a gallery to sell prints from the wall.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link to="/sell">Open selling</Link>
        </Button>
      </div>

      <div className="mt-16 border-t border-border pt-10">
        <h2 className="font-display text-2xl">Empty the catalog</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Removes folders, galleries, and photographs in this browser. Price lists stay.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => setConfirm(true)}>
          Empty catalog
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the catalog?</AlertDialogTitle>
            <AlertDialogDescription>
              Folders, galleries, and photographs in this browser will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my work</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await resetStudio();
                const next = useStudioStore.getState().studio;
                setName(next.name);
                setTagline(next.tagline);
                setLocation(next.location);
                setAbout(next.about);
                toast("Catalog emptied");
              }}
            >
              Empty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`mt-1 inline-block size-2.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
      aria-label={on ? "Connected" : "Not connected"}
    />
  );
}

function IntegrationsPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    r2: boolean;
    r2Bucket: string;
    stripe: boolean;
    stripeLive: boolean;
    webhook: boolean;
  } | null>(null);
  const [r2, setR2] = useState({
    accountId: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    publicBaseUrl: "",
  });
  const [stripe, setStripe] = useState({ secretKey: "", webhookSecret: "" });
  const [ship, setShip] = useState<Address>(emptyAddress());
  const [webhookUrl, setWebhookUrl] = useState("");

  function refresh() {
    void getIntegrationStatus()
      .then(setStatus)
      .catch(() => undefined);
    void loadShipFrom()
      .then((addr) => addr && setShip(addr))
      .catch(() => undefined);
  }

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/stripe`);
    refresh();
  }, []);

  return (
    <div className="mt-6 grid gap-6">
      <form
        className="rounded-xl bg-card px-4 py-5 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy("r2");
          void saveR2Connection({ data: r2 })
            .then((result) => {
              toast(`R2 connected · ${result.bucket}`);
              setR2((s) => ({ ...s, secretAccessKey: "" }));
              refresh();
            })
            .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not reach R2"))
            .finally(() => setBusy(null));
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Cloudflare R2</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Private bucket. Files land as library/sport/gallery/filename/original.jpg
            </p>
          </div>
          <StatusDot on={Boolean(status?.r2)} />
        </div>
        {status?.r2Bucket ? (
          <p className="mt-2 text-xs text-muted-foreground">Bucket {status.r2Bucket}</p>
        ) : null}
        <div className="mt-5 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="r2-account">Account ID</Label>
            <Input
              id="r2-account"
              value={r2.accountId}
              onChange={(e) => setR2((s) => ({ ...s, accountId: e.target.value }))}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r2-key">Access Key ID</Label>
            <Input
              id="r2-key"
              value={r2.accessKeyId}
              onChange={(e) => setR2((s) => ({ ...s, accessKeyId: e.target.value }))}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r2-secret">Secret Access Key</Label>
            <Input
              id="r2-secret"
              type="password"
              value={r2.secretAccessKey}
              onChange={(e) => setR2((s) => ({ ...s, secretAccessKey: e.target.value }))}
              autoComplete="new-password"
              placeholder={status?.r2 ? "Already saved — paste again only to replace" : ""}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r2-bucket">Bucket</Label>
            <Input
              id="r2-bucket"
              value={r2.bucket}
              onChange={(e) => setR2((s) => ({ ...s, bucket: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="r2-cdn">Public base URL (optional)</Label>
            <Input
              id="r2-cdn"
              value={r2.publicBaseUrl}
              onChange={(e) => setR2((s) => ({ ...s, publicBaseUrl: e.target.value }))}
              placeholder="https://photos.example.com"
            />
          </div>
          <Button type="submit" disabled={busy === "r2"}>
            {busy === "r2" ? "Testing…" : "Save and test R2"}
          </Button>
        </div>
      </form>

      <form
        className="rounded-xl bg-card px-4 py-5 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy("stripe");
          void saveStripeConnection({ data: stripe })
            .then((result) => {
              toast(result.live ? "Stripe live key saved" : "Stripe test key saved");
              setStripe((s) => ({ ...s, secretKey: "" }));
              refresh();
            })
            .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not reach Stripe"))
            .finally(() => setBusy(null));
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Stripe</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Guest checkout. Stripe Tax on the domain. Secret key from Developers → API keys (sk_live_…).
            </p>
          </div>
          <StatusDot on={Boolean(status?.stripe)} />
        </div>
        <div className="mt-5 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sk">Secret key</Label>
            <Input
              id="sk"
              type="password"
              value={stripe.secretKey}
              onChange={(e) => setStripe((s) => ({ ...s, secretKey: e.target.value }))}
              autoComplete="new-password"
              placeholder={status?.stripe ? "Already saved — paste again only to replace" : "sk_live_…"}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wh">Webhook signing secret</Label>
            <Input
              id="wh"
              type="password"
              value={stripe.webhookSecret}
              onChange={(e) => setStripe((s) => ({ ...s, webhookSecret: e.target.value }))}
              autoComplete="new-password"
              placeholder="whsec_…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Webhook URL: <code className="break-all text-foreground">{webhookUrl}</code>
            {status?.webhook ? " · signing secret saved" : ""}
          </p>
          <Button type="submit" disabled={busy === "stripe"}>
            {busy === "stripe" ? "Testing…" : "Save and test Stripe"}
          </Button>
        </div>
      </form>

      <form
        className="rounded-xl bg-card px-4 py-5 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!addressReady(ship)) {
            toast("Ship-from needs a street, city, state, ZIP, and phone.");
            return;
          }
          setBusy("ship");
          void saveStudioShipFrom({ data: ship })
            .then(() => toast("Ship-from saved"))
            .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not save"))
            .finally(() => setBusy(null));
        }}
      >
        <p className="font-medium">Ship from</p>
        <p className="mt-1 text-sm text-muted-foreground">Used for Stripe Tax origin.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sf-name">Name</Label>
            <Input id="sf-name" value={ship.name} onChange={(e) => setShip((s) => ({ ...s, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sf-line">Street</Label>
            <Input id="sf-line" value={ship.line1} onChange={(e) => setShip((s) => ({ ...s, line1: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-city">City</Label>
            <Input id="sf-city" value={ship.city} onChange={(e) => setShip((s) => ({ ...s, city: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-st">State</Label>
            <select
              id="sf-st"
              value={ship.state}
              onChange={(e) => setShip((s) => ({ ...s, state: e.target.value }))}
              className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
            >
              <option value="">Select</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-zip">ZIP</Label>
            <Input id="sf-zip" value={ship.postal} onChange={(e) => setShip((s) => ({ ...s, postal: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-phone">Phone</Label>
            <Input id="sf-phone" value={ship.phone} onChange={(e) => setShip((s) => ({ ...s, phone: e.target.value }))} />
          </div>
        </div>
        <Button type="submit" className="mt-4" disabled={busy === "ship"}>
          {busy === "ship" ? "Saving…" : "Save ship-from"}
        </Button>
      </form>
    </div>
  );
}
