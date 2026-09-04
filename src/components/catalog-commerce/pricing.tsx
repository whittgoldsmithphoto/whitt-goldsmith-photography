import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import type { Quote } from "@/lib/catalog-commerce/service";

type Product = { id: string; name: string; license: string; active: boolean };
type PriceList = { id: string; name: string; is_default: boolean };
type Pricing = {
  products: Product[];
  priceLists: PriceList[];
  prices: { price_list_id: string; product_id: string; unit_cents: number }[];
  galleryPrices: { gallery_id: string; price_list_id: string }[];
  coupons: {
    code: string;
    percent_off: number;
    max_uses: number;
    consumed: number;
    expires_at: string;
  }[];
  orders: { id: string; status: string; total_cents: number; currency: string }[];
};
async function request<T>(op: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/api/commerce?op=${op}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Pricing request failed");
  return data;
}
const fieldClass =
  "min-w-0 max-w-full w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const buttonClass =
  "rounded border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const panelClass = "min-w-0 space-y-4 break-words rounded-xl border border-border p-5";

/** Real owner-only database configuration, deliberately separated from checkout. */
export function CommercePricing() {
  const [data, setData] = useState<Pricing>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote>();
  const reload = useCallback(async () => {
    setError("");
    try {
      setData(await request<Pricing>("owner"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function save(
    event: FormEvent<HTMLFormElement>,
    op: string,
    make: (form: FormData) => unknown,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(op, make(new FormData(form)));
      setNotice("Saved to the shared database.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function previewQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setQuote(undefined);
    try {
      const coupon = String(fields.get("coupon") || "").trim();
      const result = await request<{ quote: Quote }>("quote", {
        galleryId: String(fields.get("gallery")),
        items: [
          {
            photoId: String(fields.get("photo")),
            productId: String(fields.get("product")),
            quantity: 1,
          },
        ],
        ...(coupon ? { couponCode: coupon } : {}),
      });
      setQuote(result.quote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-10">
      <header className="space-y-3">
        <a href="/organize" className="text-sm underline">
          Back to Organizer
        </a>
        <h1 className="text-3xl font-semibold">Pricing &amp; commerce</h1>
        <p className="max-w-3xl text-muted-foreground">
          Manage saved digital products, price lists, gallery overrides, and coupons. Prices are
          integer US cents; for example, 2500 means $25.00.
        </p>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          Checkout is disabled. These are configuration and quote tools, not a live store. Stripe,
          tax assessment, print shipping, and fulfillment still require acceptance testing.
        </p>
      </header>
      {error && (
        <div role="alert" className="rounded border border-red-500 p-4">
          {error}{" "}
          <button className="underline" onClick={() => void reload()}>
            Retry loading
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p role="status">{error ? "Pricing data is unavailable." : "Loading saved pricing…"}</p>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <form
              className={panelClass}
              onSubmit={(e) =>
                void save(e, "price-list", (f) => ({
                  id: String(f.get("id")),
                  name: String(f.get("name")),
                  isDefault: f.get("default") === "on",
                }))
              }
            >
              <h2 className="text-lg font-semibold">1. Create or update a price list</h2>
              <label className="block">
                List ID
                <input
                  required
                  name="id"
                  maxLength={150}
                  placeholder="sports-digital"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                Name
                <input
                  required
                  name="name"
                  maxLength={120}
                  placeholder="Sports digital downloads"
                  className={fieldClass}
                />
              </label>
              <label className="flex gap-2">
                <input type="checkbox" name="default" />
                Default for galleries without an override
              </label>
              <p className="text-xs text-muted-foreground">
                Only one default is allowed. To change it, first save the current default with this
                box unchecked.
              </p>
              <button disabled={busy} className={buttonClass}>
                Save price list
              </button>
            </form>
            <form
              className={panelClass}
              onSubmit={(e) =>
                void save(e, "product", (f) => ({
                  id: String(f.get("id")),
                  name: String(f.get("name")),
                  license: String(f.get("license")),
                  active: f.get("active") === "on",
                }))
              }
            >
              <h2 className="text-lg font-semibold">2. Create or update a digital product</h2>
              <label className="block">
                Product ID
                <input
                  required
                  name="id"
                  maxLength={150}
                  placeholder="personal-digital"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                Name
                <input
                  required
                  name="name"
                  maxLength={160}
                  placeholder="Full-resolution personal download"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                License terms
                <textarea
                  aria-label="License terms"
                  required
                  name="license"
                  maxLength={4000}
                  rows={3}
                  className={fieldClass}
                />
              </label>
              <label className="flex gap-2">
                <input type="checkbox" name="active" />
                Available for quote previews
              </label>
              <button disabled={busy} className={buttonClass}>
                Save product
              </button>
            </form>
            <form
              className={panelClass}
              onSubmit={(e) =>
                void save(e, "price", (f) => ({
                  priceListId: String(f.get("list")),
                  productId: String(f.get("product")),
                  unitCents: Number(f.get("cents")),
                }))
              }
            >
              <h2 className="text-lg font-semibold">3. Set a product price</h2>
              <label className="block">
                Price list
                <select aria-label="Price list" required name="list" className={fieldClass}>
                  <option value="">Choose a list</option>
                  {data.priceLists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Product
                <select aria-label="Product" required name="product" className={fieldClass}>
                  <option value="">Choose a product</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Price in cents
                <input
                  required
                  name="cents"
                  type="number"
                  min="1"
                  max="10000000"
                  step="1"
                  className={fieldClass}
                />
              </label>
              <button
                disabled={busy || !data.products.length || !data.priceLists.length}
                className={buttonClass}
              >
                Save price
              </button>
            </form>
            <form
              className={panelClass}
              onSubmit={(e) =>
                void save(e, "gallery-price", (f) => ({
                  galleryId: String(f.get("gallery")),
                  priceListId: String(f.get("list")) || null,
                }))
              }
            >
              <h2 className="text-lg font-semibold">Gallery price override</h2>
              <label className="block">
                Gallery ID
                <input required name="gallery" maxLength={150} className={fieldClass} />
              </label>
              <p className="text-xs text-muted-foreground">
                Copy the gallery ID from its gallery URL. A missing price in an override list is
                unavailable, never silently replaced by a different price.
              </p>
              <label className="block">
                Price list
                <select aria-label="Price list" name="list" className={fieldClass}>
                  <option value="">Use the default list</option>
                  {data.priceLists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} className={buttonClass}>
                Save gallery pricing
              </button>
            </form>
            <form
              className={panelClass}
              onSubmit={(e) =>
                void save(e, "coupon", (f) => ({
                  code: String(f.get("code")),
                  percentOff: Number(f.get("percent")),
                  maxUses: Number(f.get("uses")),
                  minimumCents: Number(f.get("minimum")),
                  galleryId: String(f.get("gallery")) || null,
                  expiresAt: new Date(String(f.get("expires"))).toISOString(),
                  active: true,
                }))
              }
            >
              <h2 className="text-lg font-semibold">Create a coupon</h2>
              <label className="block">
                Code
                <input required name="code" pattern="[A-Za-z0-9_-]{3,40}" className={fieldClass} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  Percent off
                  <input
                    required
                    name="percent"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    className={fieldClass}
                  />
                </label>
                <label>
                  Maximum uses
                  <input
                    required
                    name="uses"
                    type="number"
                    min="1"
                    step="1"
                    className={fieldClass}
                  />
                </label>
              </div>
              <label className="block">
                Minimum subtotal in cents
                <input
                  required
                  name="minimum"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue="0"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                Gallery ID (optional)
                <input name="gallery" className={fieldClass} />
              </label>
              <label className="block">
                Expires (your local time)
                <input required name="expires" type="datetime-local" className={fieldClass} />
              </label>
              <p className="text-xs text-muted-foreground">
                Codes cannot be overwritten while reservations exist. Open quote reservations last
                15 minutes; pending payments retain their reservation.
              </p>
              <button disabled={busy} className={buttonClass}>
                Create coupon
              </button>
            </form>
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">Saved configuration</h2>
              {!data.priceLists.length && <p>No price lists have been saved.</p>}
              {data.priceLists.map((list) => (
                <div key={list.id} className="space-y-2">
                  <h3 className="font-medium">
                    {list.name}
                    {list.is_default ? " · default" : ""}
                  </h3>
                  <p className="break-all text-xs text-muted-foreground">ID: {list.id}</p>
                  {data.prices
                    .filter((p) => p.price_list_id === list.id)
                    .map((p) => (
                      <p key={p.product_id} className="text-sm">
                        {data.products.find((product) => product.id === p.product_id)?.name ||
                          p.product_id}
                        : ${(p.unit_cents / 100).toFixed(2)}
                      </p>
                    ))}
                </div>
              ))}
              <h3 className="font-medium">Products</h3>
              {data.products.length ? (
                data.products.map((p) => (
                  <p key={p.id} className="break-all text-sm">
                    {p.id} · {p.name} · {p.active ? "quotable" : "inactive"}
                  </p>
                ))
              ) : (
                <p>No products saved.</p>
              )}
              <h3 className="font-medium">Coupons</h3>
              {data.coupons.length ? (
                data.coupons.map((c) => (
                  <p key={c.code} className="text-sm">
                    {c.code}: {c.percent_off}% · {c.consumed}/{c.max_uses} paid uses · expires{" "}
                    {new Date(c.expires_at).toLocaleString()}
                  </p>
                ))
              ) : (
                <p>No coupons saved.</p>
              )}
              <h3 className="font-medium">Latest orders</h3>
              {data.orders.length ? (
                data.orders.map((o) => (
                  <p key={o.id} className="break-all text-sm">
                    {o.id} · {o.status} · ${(o.total_cents / 100).toFixed(2)}
                  </p>
                ))
              ) : (
                <p>No server-backed commerce orders.</p>
              )}
            </section>
            <form className={panelClass} onSubmit={(e) => void previewQuote(e)}>
              <h2 className="text-lg font-semibold">Quote preview — no payment</h2>
              <p className="text-sm text-muted-foreground">
                Tests the same server-side availability and price checks used by customers. The
                gallery must be published and accessible to this account. A coupon preview reserves
                a use for 15 minutes.
              </p>
              <label className="block">
                Gallery ID
                <input required name="gallery" className={fieldClass} />
              </label>
              <label className="block">
                Photo ID
                <input required name="photo" className={fieldClass} />
              </label>
              <label className="block">
                Product
                <select aria-label="Product" required name="product" className={fieldClass}>
                  <option value="">Choose a product</option>
                  {data.products
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                Coupon (optional)
                <input name="coupon" className={fieldClass} />
              </label>
              <button disabled={busy} className={buttonClass}>
                Preview server quote
              </button>
              {quote && (
                <div role="status" className="space-y-2 rounded border border-border p-3 text-sm">
                  <p>
                    Subtotal: ${(quote.subtotal_cents / 100).toFixed(2)} · Discount: $
                    {(quote.discount_cents / 100).toFixed(2)}
                  </p>
                  <p>Pre-tax preview: ${(quote.total_cents / 100).toFixed(2)} USD</p>
                  <p>Tax assessment is not configured. This preview cannot be purchased.</p>
                  <p>Expires: {new Date(quote.expires_at).toLocaleString()}</p>
                  <p className="break-all">Quote reference: {quote.id}</p>
                </div>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
