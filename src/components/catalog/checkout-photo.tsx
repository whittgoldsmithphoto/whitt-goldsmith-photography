import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";

type Offer = { id: string; name: string; license: string; kind: "digital_photo" | "gallery_download"; unit_cents: number };
export function CheckoutPhoto({ galleryId, photoId }: { galleryId: string; photoId: string }) {
  const { user } = useCurrentUserState();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [product, setProduct] = useState("");
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setOffers([]);
    setProduct("");
    setError("");
    void apiFetch(`/api/commerce?op=offers&galleryId=${encodeURIComponent(galleryId)}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!abort.signal.aborted && data.checkoutAvailable)
          setOffers(data.products.filter((offer: Offer) => offer.kind === "digital_photo"));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [galleryId]);
  async function buy() {
    if (busy || !product) return;
    setBusy(true);
    setError("");
    const post = async (op: string, body: unknown) => {
      const response = await apiFetch(`/api/commerce?op=${op}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout unavailable");
      return data;
    };
    try {
      const { quote } = await post("quote", {
        galleryId,
        items: [{ photoId, productId: product, quantity: 1 }],
        ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
      });
      const { url } = await post("checkout", { quoteId: quote.id });
      const destination = new URL(url);
      if (
        destination.origin !== "https://checkout.stripe.com" ||
        destination.username ||
        destination.password ||
        !destination.pathname.startsWith("/c/pay/")
      )
        throw new Error("Invalid checkout destination");
      window.location.assign(destination.href);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Checkout unavailable");
    } finally {
      setBusy(false);
    }
  }
  if (!offers.length) return null;
  const selected = offers.find((offer) => offer.id === product);
  return (
    <section className="mt-4 space-y-3 border-t pt-4" aria-label="Buy digital photo">
      <label className="block">
        Digital download
        <select
          aria-label="Digital download"
          className="ml-3 rounded border bg-background p-2"
          value={product}
          onChange={(event) => setProduct(event.target.value)}
          disabled={busy}
        >
          <option value="">Choose a license</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.name} — ${(offer.unit_cents / 100).toFixed(2)} before tax
            </option>
          ))}
        </select>
      </label>
      {selected && <p className="whitespace-pre-wrap text-sm">{selected.license}</p>}
      <label className="block text-sm">
        Discount code (optional)
        <input
          className="ml-3 rounded border bg-background p-2"
          maxLength={40}
          value={coupon}
          onChange={(event) => setCoupon(event.target.value)}
          disabled={busy}
        />
      </label>
      {user && !user.isDevFallback ? (
        <Button disabled={!product || busy} onClick={() => void buy()}>
          {busy ? "Opening checkout…" : "Continue to secure checkout"}
        </Button>
      ) : (
        <Button asChild>
          <a href="/login">Sign in to purchase</a>
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Stripe displays the final tax and total before you pay. Your original file becomes available
        in Your purchases after payment is verified.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/** Gallery-level download purchase. The server snapshots every purchasable
 * photo in the gallery and grants a separate bounded entitlement per photo. */
export function CheckoutGallery({ galleryId, anchorPhotoId }: { galleryId: string; anchorPhotoId?: string }) {
  const { user } = useCurrentUserState();
  const [offer, setOffer] = useState<Offer>();
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void apiFetch(`/api/commerce?op=offers&galleryId=${encodeURIComponent(galleryId)}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!abort.signal.aborted && data.checkoutAvailable)
          setOffer(data.products.find((item: Offer) => item.kind === "gallery_download"));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [galleryId]);
  async function buy() {
    if (busy || !offer || !anchorPhotoId) return;
    setBusy(true);
    setError("");
    const post = async (op: string, body: unknown) => {
      const response = await apiFetch(`/api/commerce?op=${op}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout unavailable");
      return data;
    };
    try {
      const { quote } = await post("quote", {
        galleryId,
        items: [{ photoId: anchorPhotoId, productId: offer.id, quantity: 1 }],
        ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
      });
      const { url } = await post("checkout", { quoteId: quote.id });
      const destination = new URL(url);
      if (destination.origin !== "https://checkout.stripe.com" || !destination.pathname.startsWith("/c/pay/"))
        throw new Error("Invalid checkout destination");
      window.location.assign(destination.href);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Checkout unavailable");
    } finally {
      setBusy(false);
    }
  }
  if (!offer) return null;
  return (
    <section className="my-6 max-w-2xl space-y-3 rounded border border-border p-4" aria-label="Buy entire gallery">
      <h2 className="font-display text-2xl">Download the complete gallery</h2>
      <p className="text-sm text-muted-foreground">{offer.name} — ${(offer.unit_cents / 100).toFixed(2)} before tax</p>
      <p className="whitespace-pre-wrap text-sm">{offer.license}</p>
      <label className="block text-sm">
        Discount code (optional)
        <input className="ml-3 rounded border bg-background p-2" maxLength={40} value={coupon} onChange={(event) => setCoupon(event.target.value)} disabled={busy} />
      </label>
      {user && !user.isDevFallback ? (
        <Button disabled={busy || !anchorPhotoId} onClick={() => void buy()}>
          {busy ? "Opening checkout…" : "Buy complete gallery"}
        </Button>
      ) : (
        <Button asChild>
          <a href={`/login?returnTo=${encodeURIComponent(location.pathname)}`}>Sign in to buy</a>
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
