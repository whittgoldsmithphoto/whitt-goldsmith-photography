import {
  Fragment as ReactFragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import type { Quote } from "@/lib/catalog-commerce/service";

type Product = {
  id: string;
  name: string;
  license: string;
  active: boolean;
  kind: "digital_photo" | "gallery_download" | "print";
  width_inches?: string;
  height_inches?: string;
  finish?: string;
  minimum_dpi?: number;
};
type PriceList = { id: string; name: string; is_default: boolean };
type GalleryOption = { id: string; title: string };
type PhotoOption = { id: string; filename: string; status?: string };
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
async function catalogRequest<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || "Catalog request failed");
  return data;
}
const fieldClass =
  "min-h-12 min-w-0 max-w-full w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground";
const buttonClass =
  "min-h-12 rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const panelClass = "min-w-0 space-y-4 break-words border-t border-border pt-5";
const sellingSections = [
  { id: "pricing", label: "Pricing" },
  { id: "discounts", label: "Discounts" },
  { id: "orders", label: "Orders" },
  { id: "quote", label: "Test quote" },
] as const;
type SellingSection = (typeof sellingSections)[number]["id"];

/** Real owner-only database configuration, deliberately separated from checkout. */
export function CommercePricing() {
  const [data, setData] = useState<Pricing>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote>();
  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [section, setSection] = useState<SellingSection>("pricing");
  const [galleries, setGalleries] = useState<GalleryOption[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");
  const [galleryCursor, setGalleryCursor] = useState<string | null>(null);
  const [selectedGalleryId, setSelectedGalleryId] = useState("");
  const [photos, setPhotos] = useState<PhotoOption[]>([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState("");
  const selectedGalleryRef = useRef("");
  const photoRequestVersion = useRef(0);
  const [editingProduct, setEditingProduct] = useState<Product>();
  const [productKind, setProductKind] = useState<Product["kind"]>("digital_photo");
  const [priceListId, setPriceListId] = useState("");
  const [pricedProductId, setPricedProductId] = useState("");
  const reload = useCallback(async () => {
    setError("");
    try {
      setData(await request<Pricing>("owner"));
      setSandboxAvailable(
        (await request<{ sandboxCheckoutAvailable: boolean }>("payment-setup"))
          .sandboxCheckoutAvailable,
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setGalleryLoading(true);
    setGalleryError("");
    try {
      const result = await catalogRequest<{
        data: GalleryOption[];
        page?: { nextCursor?: string | null };
      }>("/api/catalog/galleries?owner=1&limit=50");
      setGalleries(result.data);
      setGalleryCursor(result.page?.nextCursor || null);
    } catch (e) {
      setGalleryError((e as Error).message);
    } finally {
      setGalleryLoading(false);
    }
  }, []);
  async function loadMoreGalleries() {
    if (!galleryCursor || galleryLoading) return;
    setGalleryLoading(true);
    setGalleryError("");
    try {
      const result = await catalogRequest<{
        data: GalleryOption[];
        page?: { nextCursor?: string | null };
      }>(`/api/catalog/galleries?owner=1&limit=50&cursor=${encodeURIComponent(galleryCursor)}`);
      setGalleries((current) => {
        const seen = new Set(current.map((gallery) => gallery.id));
        return [...current, ...result.data.filter((gallery) => !seen.has(gallery.id))];
      });
      setGalleryCursor(result.page?.nextCursor || null);
    } catch (e) {
      setGalleryError((e as Error).message);
    } finally {
      setGalleryLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [reload]);
  function galleryPagingControls() {
    return (
      <>
        {galleryCursor && (
          <button
            type="button"
            className={buttonClass}
            disabled={galleryLoading}
            onClick={() => void loadMoreGalleries()}
          >
            {galleryLoading ? "Loading more galleries…" : "Load more galleries"}
          </button>
        )}
        <p role="status" className="text-xs text-muted-foreground">
          Showing {galleries.length} galleries{galleryCursor ? "; more available" : "."}
        </p>
      </>
    );
  }
  function selectGallery(id: string) {
    selectedGalleryRef.current = id;
    photoRequestVersion.current += 1;
    setSelectedGalleryId(id);
  }
  useEffect(() => {
    selectedGalleryRef.current = selectedGalleryId;
    photoRequestVersion.current += 1;
    const requestVersion = photoRequestVersion.current;
    if (!selectedGalleryId) {
      setPhotos([]);
      setSelectedPhotoId("");
      setPhotoError("");
      setPhotoCursor(null);
      return;
    }
    let active = true;
    setPhotoLoading(true);
    setPhotoError("");
    setPhotos([]);
    setSelectedPhotoId("");
    setPhotoCursor(null);
    void catalogRequest<{ data: PhotoOption[]; page?: { nextCursor?: string | null } }>(
      `/api/catalog/galleries/${encodeURIComponent(selectedGalleryId)}/photos?owner=1&limit=50`,
    )
      .then((result) => {
        if (
          active &&
          selectedGalleryRef.current === selectedGalleryId &&
          photoRequestVersion.current === requestVersion
        ) {
          setPhotos(result.data);
          setPhotoCursor(result.page?.nextCursor || null);
        }
      })
      .catch((e) => {
        if (
          active &&
          selectedGalleryRef.current === selectedGalleryId &&
          photoRequestVersion.current === requestVersion
        )
          setPhotoError((e as Error).message);
      })
      .finally(() => {
        if (
          active &&
          selectedGalleryRef.current === selectedGalleryId &&
          photoRequestVersion.current === requestVersion
        )
          setPhotoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedGalleryId]);
  async function loadMorePhotos() {
    if (!selectedGalleryId || !photoCursor || photoLoading) return;
    const galleryId = selectedGalleryId;
    const requestVersion = photoRequestVersion.current;
    setPhotoLoading(true);
    setPhotoError("");
    try {
      const result = await catalogRequest<{
        data: PhotoOption[];
        page?: { nextCursor?: string | null };
      }>(
        `/api/catalog/galleries/${encodeURIComponent(galleryId)}/photos?owner=1&limit=50&cursor=${encodeURIComponent(photoCursor)}`,
      );
      if (
        selectedGalleryRef.current !== galleryId ||
        photoRequestVersion.current !== requestVersion
      )
        return;
      setPhotos((current) => {
        const seen = new Set(current.map((photo) => photo.id));
        return [...current, ...result.data.filter((photo) => !seen.has(photo.id))];
      });
      setPhotoCursor(result.page?.nextCursor || null);
    } catch (e) {
      if (
        selectedGalleryRef.current === galleryId &&
        photoRequestVersion.current === requestVersion
      )
        setPhotoError((e as Error).message);
    } finally {
      if (
        selectedGalleryRef.current === galleryId &&
        photoRequestVersion.current === requestVersion
      )
        setPhotoLoading(false);
    }
  }
  function onSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = sellingSections.findIndex((item) => item.id === section);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % sellingSections.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + sellingSections.length) % sellingSections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sellingSections.length - 1;
    else return;
    event.preventDefault();
    setSection(sellingSections[next].id);
    requestAnimationFrame(() =>
      document.getElementById(`selling-tab-${sellingSections[next].id}`)?.focus(),
    );
  }
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
  async function testCheckout() {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ url: string }>("checkout", { quoteId: quote.id });
      const url = new URL(result.url);
      if (url.origin !== "https://checkout.stripe.com" || url.username || url.password)
        throw new Error("Invalid checkout destination");
      window.location.assign(url.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <header className="space-y-2">
        <h1>Selling</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Digital files only for now. Checkout is{" "}
          {sandboxAvailable ? "available in sandbox" : "still off"}— live charges stay disabled
          until you turn them on.
        </p>
      </header>
      {error && (
        <div role="alert" className="rounded border border-border p-4">
          {error}{" "}
          <button className="underline" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && <SellingDesk data={data} busy={busy} onSave={save} galleries={galleries} />}
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer py-2 text-sm font-medium">
          Advanced price lists, coupons, and test quotes
        </summary>
        <div className="pt-4">
          <div
            role="tablist"
            aria-label="Selling tools"
            className="flex flex-wrap gap-2 border-b border-border pb-3"
          >
            {sellingSections.map((item) => (
              <button
                key={item.id}
                id={`selling-tab-${item.id}`}
                role="tab"
                tabIndex={section === item.id ? 0 : -1}
                aria-selected={section === item.id}
                aria-controls={`selling-${item.id}`}
                onClick={() => setSection(item.id)}
                onKeyDown={onSectionKeyDown}
                className={`min-h-12 rounded-lg border px-4 py-2 text-sm font-medium ${
                  section === item.id
                    ? "border-foreground bg-muted text-foreground underline underline-offset-4"
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {notice && <p role="status">{notice}</p>}
          {!data ? (
            <p role="status">{error ? "Pricing data is unavailable." : "Loading saved pricing…"}</p>
          ) : (
            <>
              <section
                id="selling-pricing"
                role="tabpanel"
                aria-labelledby="selling-tab-pricing"
                aria-label="Pricing"
                hidden={section !== "pricing"}
              >
                <p className="mb-6 text-sm text-muted-foreground">
                  Prices are integer US cents; for example, 2500 means $25.00.
                </p>
                <div className="grid gap-x-8 gap-y-8 md:grid-cols-2">
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
                      Only one default is allowed. To change it, first save the current default with
                      this box unchecked.
                    </p>
                    <button disabled={busy} className={buttonClass}>
                      Save price list
                    </button>
                  </form>
                  <form
                    key={editingProduct?.id || "new-product"}
                    className={panelClass}
                    onSubmit={(e) =>
                      void save(e, "product", (f) => ({
                        id: String(f.get("id")),
                        name: String(f.get("name")),
                        license: String(f.get("license")),
                        active: productKind !== "print" && f.get("active") === "on",
                        kind: productKind,
                        ...(productKind === "print"
                          ? {
                              widthInches: Number(f.get("width")),
                              heightInches: Number(f.get("height")),
                              finish: String(f.get("finish")),
                              minimumDpi: Number(f.get("dpi")),
                            }
                          : {}),
                      }))
                    }
                  >
                    <h2 className="text-lg font-semibold">2. Product details</h2>
                    <label className="block">
                      Edit saved product
                      <select
                        aria-label="Edit saved product"
                        className={fieldClass}
                        value={editingProduct?.id || ""}
                        onChange={(event) => {
                          const product = data.products.find(
                            (item) => item.id === event.target.value,
                          );
                          setEditingProduct(product);
                          setProductKind(product?.kind || "digital_photo");
                        }}
                      >
                        <option value="">Create a new product</option>
                        {data.products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      Product type
                      <select
                        aria-label="Product type"
                        className={fieldClass}
                        value={productKind}
                        disabled={Boolean(editingProduct)}
                        onChange={(event) => setProductKind(event.target.value as Product["kind"])}
                      >
                        <option value="digital_photo">Individual digital download</option>
                        <option value="gallery_download">Whole gallery / album download</option>
                        <option value="print">Physical print</option>
                      </select>
                    </label>
                    <label className="block">
                      Product ID
                      <input
                        required
                        name="id"
                        maxLength={150}
                        placeholder="personal-digital"
                        defaultValue={editingProduct?.id}
                        readOnly={Boolean(editingProduct)}
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
                        defaultValue={editingProduct?.name}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      License terms
                      <textarea
                        aria-label="License terms"
                        required
                        name="license"
                        defaultValue={editingProduct?.license}
                        maxLength={4000}
                        rows={3}
                        className={fieldClass}
                      />
                    </label>
                    {productKind === "print" && (
                      <fieldset className="space-y-3">
                        <legend>Print specifications — one product per size and finish</legend>
                        <label className="block">
                          Width in inches
                          <input
                            className={fieldClass}
                            required
                            name="width"
                            type="number"
                            min="0.01"
                            max="9999.99"
                            step="0.01"
                            defaultValue={editingProduct?.width_inches}
                          />
                        </label>
                        <label className="block">
                          Height in inches
                          <input
                            className={fieldClass}
                            required
                            name="height"
                            type="number"
                            min="0.01"
                            max="9999.99"
                            step="0.01"
                            defaultValue={editingProduct?.height_inches}
                          />
                        </label>
                        <label className="block">
                          Paper / finish
                          <input
                            className={fieldClass}
                            required
                            name="finish"
                            maxLength={80}
                            placeholder="Lustre"
                            defaultValue={editingProduct?.finish || ""}
                          />
                        </label>
                        <label className="block">
                          Minimum DPI
                          <input
                            className={fieldClass}
                            required
                            name="dpi"
                            type="number"
                            min="72"
                            max="600"
                            step="1"
                            defaultValue={editingProduct?.minimum_dpi || 150}
                          />
                        </label>
                      </fieldset>
                    )}
                    {productKind === "print" && (
                      <p role="status" className="text-sm text-muted-foreground">
                        You can save this product and its prices now. Sales remain disabled until{" "}
                        print fulfillment and shipping are connected.
                      </p>
                    )}
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={editingProduct?.active}
                        disabled={productKind === "print"}
                      />
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
                      <select
                        aria-label="Price list"
                        required
                        name="list"
                        className={fieldClass}
                        value={priceListId}
                        onChange={(event) => setPriceListId(event.target.value)}
                      >
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
                      <select
                        aria-label="Product"
                        required
                        name="product"
                        className={fieldClass}
                        value={pricedProductId}
                        onChange={(event) => setPricedProductId(event.target.value)}
                      >
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
                        key={`${priceListId}:${pricedProductId}:${data.prices.find((price) => price.price_list_id === priceListId && price.product_id === pricedProductId)?.unit_cents}`}
                        defaultValue={
                          data.prices.find(
                            (price) =>
                              price.price_list_id === priceListId &&
                              price.product_id === pricedProductId,
                          )?.unit_cents ?? ""
                        }
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
                      Gallery
                      <select
                        required
                        name="gallery"
                        aria-label="Gallery to override"
                        className={fieldClass}
                      >
                        <option value="">Choose a gallery</option>
                        {galleries.map((gallery) => (
                          <option key={gallery.id} value={gallery.id}>
                            {gallery.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {galleryPagingControls()}
                    <p className="text-xs text-muted-foreground">
                      Choose a gallery by title. A missing price in an override list is unavailable,
                      never silently replaced by a different price.
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
                  <section className={`${panelClass} md:col-span-2`}>
                    <h2 className="text-lg font-semibold">Saved pricing</h2>
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
                              <button
                                type="button"
                                className="ml-3 underline underline-offset-4"
                                onClick={() => {
                                  setPriceListId(list.id);
                                  setPricedProductId(p.product_id);
                                }}
                                aria-label={`Edit price for ${data.products.find((product) => product.id === p.product_id)?.name || p.product_id} in ${list.name}`}
                              >
                                Edit price
                              </button>
                            </p>
                          ))}
                      </div>
                    ))}
                    <h3 className="font-medium">Products</h3>
                    {data.products.length ? (
                      data.products.map((p) => (
                        <p key={p.id} className="break-all text-sm">
                          {p.id} · {p.name} · {p.kind.replaceAll("_", " ")} ·{" "}
                          {p.active ? "quotable" : "inactive"}
                          {p.kind === "print" &&
                            ` · ${p.width_inches} × ${p.height_inches} in · ${p.finish || "finish needs configuration"}`}
                        </p>
                      ))
                    ) : (
                      <p>No products saved.</p>
                    )}
                  </section>
                </div>
              </section>
              <section
                id="selling-discounts"
                role="tabpanel"
                aria-labelledby="selling-tab-discounts"
                aria-label="Discounts"
                hidden={section !== "discounts"}
              >
                <div className="grid gap-8 md:grid-cols-2">
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
                      <input
                        required
                        name="code"
                        pattern="[A-Za-z0-9_-]{3,40}"
                        className={fieldClass}
                      />
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
                      Gallery (optional)
                      <select name="gallery" aria-label="Coupon gallery" className={fieldClass}>
                        <option value="">All galleries</option>
                        {galleries.map((gallery) => (
                          <option key={gallery.id} value={gallery.id}>
                            {gallery.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {galleryPagingControls()}
                    <label className="block">
                      Expires (your local time)
                      <input required name="expires" type="datetime-local" className={fieldClass} />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Codes cannot be overwritten while reservations exist. Open quote reservations
                      last 15 minutes; pending payments retain their reservation.
                    </p>
                    <button disabled={busy} className={buttonClass}>
                      Create coupon
                    </button>
                  </form>
                  <section className={panelClass}>
                    <h2 className="text-lg font-semibold">Saved coupons</h2>
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
                  </section>
                </div>
              </section>
              <section
                id="selling-orders"
                role="tabpanel"
                aria-labelledby="selling-tab-orders"
                aria-label="Orders"
                hidden={section !== "orders"}
              >
                <div className={panelClass}>
                  <h2 className="text-lg font-semibold">Latest orders</h2>
                  {data.orders.length ? (
                    data.orders.map((o) => (
                      <p key={o.id} className="break-all text-sm">
                        {o.id} · {o.status} · ${(o.total_cents / 100).toFixed(2)}
                      </p>
                    ))
                  ) : (
                    <p>No server-backed commerce orders.</p>
                  )}
                </div>
              </section>
              <section
                id="selling-quote"
                role="tabpanel"
                aria-labelledby="selling-tab-quote"
                aria-label="Test quote"
                hidden={section !== "quote"}
                className="max-w-2xl"
              >
                <form className={panelClass} onSubmit={(e) => void previewQuote(e)}>
                  <h2 className="text-lg font-semibold">Quote preview — no payment</h2>
                  <p className="text-sm text-muted-foreground">
                    Tests the same server-side availability and price checks used by customers. The
                    gallery must be published and accessible to this account. A coupon preview
                    reserves a use for 15 minutes.
                  </p>
                  <label className="block">
                    Gallery
                    <select
                      required
                      name="gallery"
                      aria-label="Gallery"
                      className={fieldClass}
                      value={selectedGalleryId}
                      onChange={(event) => selectGallery(event.target.value)}
                      disabled={
                        (galleryLoading && galleries.length === 0) ||
                        (Boolean(galleryError) && galleries.length === 0)
                      }
                    >
                      <option value="">
                        {galleryLoading ? "Loading galleries…" : "Choose a gallery"}
                      </option>
                      {galleries.map((gallery) => (
                        <option key={gallery.id} value={gallery.id}>
                          {gallery.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {galleryPagingControls()}
                  <label className="block">
                    Photo
                    <select
                      required
                      name="photo"
                      aria-label="Photo"
                      className={fieldClass}
                      value={selectedPhotoId}
                      onChange={(event) => setSelectedPhotoId(event.target.value)}
                      disabled={
                        !selectedGalleryId ||
                        (photoLoading && photos.length === 0) ||
                        (Boolean(photoError) && photos.length === 0)
                      }
                    >
                      <option value="">
                        {photoLoading ? "Loading photos…" : "Choose a ready photo"}
                      </option>
                      {photos
                        .filter((photo) => !photo.status || photo.status === "ready")
                        .map((photo) => (
                          <option key={photo.id} value={photo.id}>
                            {photo.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                  {photoCursor && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={photoLoading}
                      onClick={() => void loadMorePhotos()}
                    >
                      {photoLoading ? "Loading more photos…" : "Load more photos"}
                    </button>
                  )}
                  {selectedGalleryId && (
                    <p role="status" className="text-xs text-muted-foreground">
                      Showing{" "}
                      {photos.filter((photo) => !photo.status || photo.status === "ready").length}{" "}
                      ready photos from {photos.length} loaded
                      {photoCursor ? "; more available" : "."}
                    </p>
                  )}
                  {(galleryError || photoError) && (
                    <p role="alert" className="text-sm text-muted-foreground">
                      {galleryError || photoError} Selectors are unavailable; your other form values
                      are preserved.
                    </p>
                  )}
                  <label className="block">
                    Product
                    <select aria-label="Product" required name="product" className={fieldClass}>
                      <option value="">Choose a product</option>
                      {data.products
                        .filter(
                          (p) => p.active && ["digital_photo", "gallery_download"].includes(p.kind),
                        )
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
                    <div
                      role="status"
                      className="space-y-2 rounded border border-border p-3 text-sm"
                    >
                      <p>
                        Subtotal: ${(quote.subtotal_cents / 100).toFixed(2)} · Discount: $
                        {(quote.discount_cents / 100).toFixed(2)}
                      </p>
                      <p>Pre-tax preview: ${(quote.total_cents / 100).toFixed(2)} USD</p>
                      <p>
                        {sandboxAvailable
                          ? "This is a test quote before tax. Stripe shows the final test total before payment; no real money is charged."
                          : "Tax assessment is not configured. This preview cannot be purchased."}
                      </p>
                      <p>Expires: {new Date(quote.expires_at).toLocaleString()}</p>
                      <p className="break-all">Quote reference: {quote.id}</p>
                      {sandboxAvailable && (
                        <>
                          <p>
                            Owner-only sandbox test. Use a Stripe test card; this does not charge
                            real money.
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            className={buttonClass}
                            onClick={() => void testCheckout()}
                          >
                            Open Stripe sandbox checkout
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </form>
              </section>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function SellingDesk({
  data,
  busy,
  galleries,
  onSave,
}: {
  data: Pricing;
  busy: boolean;
  galleries: GalleryOption[];
  onSave: (
    event: FormEvent<HTMLFormElement>,
    op: string,
    make: (form: FormData) => unknown,
  ) => Promise<void>;
}) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const digitalProducts = data.products.filter(
    (item) => item.kind === "digital_photo" || item.kind === "gallery_download",
  );
  const digital =
    digitalProducts.find((item) => item.id === selectedProductId) ||
    digitalProducts.find((item) => item.id === "digital-full-resolution") ||
    digitalProducts[0];
  const list = data.priceLists.find((item) => item.is_default) || data.priceLists[0];
  const price =
    digital && list
      ? data.prices.find((item) => item.product_id === digital.id && item.price_list_id === list.id)
      : undefined;
  return (
    <div className="grid gap-8 border-b border-border pb-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Digital downloads
        </h2>
        <label className="block max-w-lg text-sm">
          Download product
          <select
            className={fieldClass}
            value={digital?.id || ""}
            onChange={(event) => setSelectedProductId(event.target.value)}
          >
            {digitalProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        {digital && list ? (
          <ReactFragment
            key={`${digital.id}:${digital.name}:${digital.license}:${price?.unit_cents}`}
          >
            <form
              className="max-w-lg space-y-4"
              onSubmit={(event) =>
                void onSave(event, "product", (fields) => ({
                  id: digital.id,
                  name: String(fields.get("name")),
                  license: String(fields.get("license")),
                  active: digital.active,
                  kind: digital.kind,
                }))
              }
            >
              <label className="block text-sm">
                Name
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={digital.name}
                  className={fieldClass}
                />
              </label>
              <label className="block text-sm">
                License
                <textarea
                  name="license"
                  required
                  maxLength={4000}
                  rows={3}
                  defaultValue={digital.license}
                  className={fieldClass}
                />
              </label>
              <button disabled={busy} className={buttonClass}>
                Save name & license
              </button>
            </form>
            <form
              className="max-w-lg space-y-4"
              onSubmit={(event) =>
                void onSave(event, "price", (fields) => ({
                  priceListId: list.id,
                  productId: digital.id,
                  unitCents: Math.round(Number(fields.get("price")) * 100),
                }))
              }
            >
              <label className="block text-sm">
                Price (USD)
                <input
                  name="price"
                  type="number"
                  required
                  min="0.5"
                  step="0.01"
                  defaultValue={price ? dollars(price.unit_cents) : "4.95"}
                  className={fieldClass}
                />
              </label>
              <button disabled={busy} className={buttonClass}>
                Save price
              </button>
            </form>
          </ReactFragment>
        ) : (
          <p className="text-sm text-muted-foreground">
            No digital product is saved yet. Open Advanced below to create one, then it will appear
            here.
          </p>
        )}
        {list && (
          <form
            className="max-w-lg space-y-3"
            onSubmit={(event) =>
              void onSave(event, "gallery-price", (fields) => ({
                galleryId: String(fields.get("gallery")),
                priceListId: list.id,
              }))
            }
          >
            <label className="block text-sm">
              Use this price on a gallery
              <select name="gallery" required className={fieldClass} aria-label="Gallery">
                <option value="">Choose gallery</option>
                {galleries.map((gallery) => (
                  <option key={gallery.id} value={gallery.id}>
                    {gallery.title}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || !galleries.length} className={buttonClass}>
              Apply to gallery
            </button>
          </form>
        )}
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Orders
        </h2>
        {data.orders.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {data.orders.map((order) => (
              <li key={order.id}>
                {order.status} · ${dollars(order.total_cents)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No orders yet.</p>
        )}
      </section>
    </div>
  );
}
