import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import type { QuoteItem } from "@/lib/catalog-commerce/service";
import { useResourcePage } from "@/lib/catalog/resource-client";

type OrderSummary = {
  id: string;
  status: string;
  created_at: string;
  total_cents: number;
  currency: string;
};
type Entitlement = {
  id: string;
  photo_id: string;
  expires_at: string;
  downloads: number;
  max_downloads: number;
  revoked_at: string | null;
};
type CustomerOrder = OrderSummary & { items: QuoteItem[]; entitlements: Entitlement[] };
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const date = (value: string) => new Date(value).toLocaleDateString();

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return new Error(
    typeof body?.error === "string"
      ? body.error
      : body?.error?.message || "Request unavailable. Please try again.",
  );
}
async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(path, { signal, cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function CustomerGate({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <p role="status">Checking your account…</p>;
  if (!user || user.isDevFallback)
    return (
      <div className="space-y-4">
        <p>Sign in with the account used at checkout to view your purchases.</p>
        <Button asChild>
          <a href="/login?returnTo=%2Fpurchases">Sign in</a>
        </Button>
      </div>
    );
  return <div key={user.id}>{children}</div>;
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-20">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Whitt Goldsmith Photography
      </p>
      <h1 className="mb-6 font-display text-4xl">{title}</h1>
      {children}
      <nav className="mt-10 flex gap-6 text-sm">
        <a href="/galleries" className="underline underline-offset-4">
          Browse galleries
        </a>
        <a href="/purchases" className="underline underline-offset-4">
          Your purchases
        </a>
      </nav>
    </main>
  );
}
export function PurchasesPage() {
  return (
    <Frame title="Your purchases">
      <CustomerGate>
        <PurchaseList />
      </CustomerGate>
    </Frame>
  );
}
function PurchaseList() {
  const state = useResourcePage<OrderSummary>("/api/commerce?op=orders&limit=50");
  const orders = state.data?.data;
  return (
    <div className="space-y-4">
      {state.error ? (
        <div role="alert">
          <p>{state.error.message}</p>
          <Button variant="outline" className="mt-3" onClick={state.reload}>
            Retry
          </Button>
        </div>
      ) : !orders ? (
        <p role="status">Loading purchases…</p>
      ) : orders.length === 0 ? (
        <p className="text-muted-foreground">No purchases are recorded for this account.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Recent purchases recorded for your account.
          </p>
          <ul className="divide-y rounded-lg border">
            {orders.map((order) => (
              <li key={order.id}>
                <a
                  className="flex flex-wrap justify-between gap-3 p-4 hover:bg-muted/50"
                  href={`/checkout/complete?orderId=${encodeURIComponent(order.id)}`}
                >
                  <span>
                    <span className="block text-sm">{date(order.created_at)}</span>
                    <span className="mt-1 block break-all text-xs text-muted-foreground">
                      Order {order.id}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block">{money(order.total_cents, order.currency)}</span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {order.status.replaceAll("_", " ")}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {state.data?.page.hasMore && (
            <Button
              variant="outline"
              disabled={state.loadingMore}
              onClick={() => void state.loadMore()}
            >
              {state.loadingMore ? "Loading…" : "Load more purchases"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
export function CheckoutResultPage({
  orderId,
  cancelled = false,
}: {
  orderId?: string;
  cancelled?: boolean;
}) {
  return (
    <Frame title={cancelled ? "Checkout closed" : "Order status"}>
      {cancelled && (
        <p className="mb-6 text-muted-foreground">
          You returned from checkout. Closing checkout does not itself cancel or confirm a payment.
          The recorded order status is shown below.
        </p>
      )}
      <CustomerGate>
        {orderId ? (
          <OrderDetail key={orderId} orderId={orderId} />
        ) : (
          <p>No order reference was supplied. Open your purchases to find an existing order.</p>
        )}
      </CustomerGate>
    </Frame>
  );
}
function OrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<CustomerOrder>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setError("");
    setStopped(false);
    async function refresh() {
      try {
        const next = await getJson<CustomerOrder>(
          `/api/commerce?op=order&id=${encodeURIComponent(orderId)}`,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setOrder(next);
        setError("");
        if (next.status === "pending" && ++attempts < 12)
          timer = setTimeout(() => void refresh(), 5000);
        else setStopped(next.status === "pending");
      } catch (error) {
        if (!abort.signal.aborted) {
          setOrder(undefined);
          setError(error instanceof Error ? error.message : "Order unavailable");
        }
      }
    }
    void refresh();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [orderId, retry]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button variant="outline" className="mt-3" onClick={() => setRetry((n) => n + 1)}>
          Retry order status
        </Button>
      </div>
    );
  if (!order) return <p role="status">Loading recorded order status…</p>;
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-5">
        <p className="break-all text-xs text-muted-foreground">Order {order.id}</p>
        <h2 className="mt-2 text-xl capitalize">{order.status.replaceAll("_", " ")}</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {order.status === "paid"
            ? "Payment has been confirmed by the server. Download availability is checked again when you request each file."
            : order.status === "pending"
              ? "Waiting for verified payment confirmation. Returning from Stripe does not confirm payment or unlock files."
              : order.status === "review"
                ? "This payment needs review by the photographer. Downloads are unavailable while it is under review."
                : "Downloads are not available for this order status."}
        </p>
        <p className="mt-4 font-medium">{money(order.total_cents, order.currency)}</p>
        {stopped && (
          <p role="status" className="mt-3 text-sm">
            Automatic checking has paused. You can refresh or return to your purchases later.
          </p>
        )}
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setRetry((n) => n + 1)}>
          Refresh order status
        </Button>
      </div>
      <ul className="divide-y rounded-lg border">
        {order.items.map((item, index) => {
          const entitlement = order.entitlements?.find((entry) => entry.photo_id === item.photoId);
          return (
            <li key={`${item.photoId}:${item.productId}:${index}`} className="space-y-2 p-4">
              <p className="break-words font-medium">{item.filename}</p>
              <p className="text-sm">
                {item.name} · {item.quantity} × {money(item.unitCents, order.currency)}
              </p>
              <p className="text-xs text-muted-foreground">{item.license}</p>
              {order.status === "paid" && entitlement ? (
                <Download
                  entitlement={entitlement}
                  filename={item.filename}
                  onDownloaded={() => setRetry((n) => n + 1)}
                />
              ) : order.status === "paid" ? (
                <p className="text-sm text-muted-foreground">
                  No download authorization is currently available. Contact the photographer if this
                  persists.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
function Download({
  entitlement,
  filename,
  onDownloaded,
}: {
  entitlement: Entitlement;
  filename: string;
  onDownloaded: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [complete, setComplete] = useState(false);
  const remaining = Math.max(0, entitlement.max_downloads - entitlement.downloads);
  const eligible =
    !entitlement.revoked_at && remaining > 0 && Date.parse(entitlement.expires_at) > Date.now();
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    setComplete(false);
    let objectUrl: string | undefined;
    try {
      const post = (body: unknown) =>
        apiFetch("/api/commerce-download", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const issued = await post({ op: "issue", entitlementId: entitlement.id });
      if (!issued.ok) throw await responseError(issued);
      const { token } = await issued.json();
      if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token))
        throw new Error("Download authorization was unavailable.");
      const response = await post({ op: "deliver", token });
      if (!response.ok) throw await responseError(response);
      const blob = await response.blob();
      if (!blob.size || !["image/jpeg", "image/png"].includes(blob.type))
        throw new Error("The server did not return a supported photo file.");
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        Array.from(filename, (char) =>
          char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\"
            ? "_"
            : char,
        )
          .slice(0, 180)
          .join("") || "photo";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setComplete(true);
      onDownloaded();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Download unavailable. Please retry.");
    } finally {
      if (objectUrl) {
        const url = objectUrl;
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs text-muted-foreground">
        {entitlement.revoked_at
          ? "Download authorization revoked."
          : `${remaining} download attempts remaining · Expires ${date(entitlement.expires_at)}`}
      </p>
      <Button variant="outline" disabled={!eligible || busy} onClick={() => void download()}>
        {busy ? "Preparing file…" : "Download original"}
      </Button>
      {complete && (
        <p role="status" className="text-sm">
          File sent to your browser. Check your downloads.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
