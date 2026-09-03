import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, couponSummary } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";
import type { Coupon, CouponAppliesTo, CouponKind, Product, ProductKind } from "@/lib/types";
import { RequireOwner } from "@/components/require-owner";
import { formatWhen } from "@/lib/utils";

export const Route = createFileRoute("/sell")({
  component: () => (
    <RequireOwner>
      <SellPage />
    </RequireOwner>
  ),
});

function SellPage() {
  const products = useStudioStore((s) => s.products);
  const priceLists = useStudioStore((s) => s.priceLists);
  const coupons = useStudioStore((s) => s.coupons);
  const galleries = useStudioStore((s) => s.galleries);
  const orders = useStudioStore((s) => s.orders);
  const createProduct = useStudioStore((s) => s.createProduct);
  const createPriceList = useStudioStore((s) => s.createPriceList);
  const createCoupon = useStudioStore((s) => s.createCoupon);
  const updateCoupon = useStudioStore((s) => s.updateCoupon);
  const deleteCoupon = useStudioStore((s) => s.deleteCoupon);
  const updateGallery = useStudioStore((s) => s.updateGallery);
  const [productOpen, setProductOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);

  const newOrders = orders.filter((o) => o.status === "new").length;
  const revenue = orders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.total, 0);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Studio
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Selling</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Price lists attach to galleries. Coupons land in the cart. Visitors buy from the photograph.
        Orders arrive here.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Open orders" value={String(newOrders)} />
        <Stat label="Recorded" value={formatMoney(revenue)} />
        <Stat label="Products" value={String(products.length)} />
      </div>

      <section className="mt-14">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-3xl tracking-tight">Orders</h2>
        </div>
        {orders.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: o.id }}
                  className="flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-accent"
                >
                  <span className="font-medium">{o.number}</span>
                  <span className="text-sm text-muted-foreground">{o.buyerName}</span>
                  <span className="text-sm capitalize text-muted-foreground">{o.status}</span>
                  <span className="ml-auto text-sm text-muted-foreground">{formatWhen(o.createdAt)}</span>
                  <span className="tabular-nums">{formatMoney(o.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-3xl tracking-tight">Price lists</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setProductOpen(true)}>
              New product
            </Button>
            <Button onClick={() => setListOpen(true)}>New list</Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {priceLists.map((list) => {
            const items = list.productIds
              .map((id) => products.find((p) => p.id === id))
              .filter((p): p is Product => Boolean(p));
            const attached = galleries.filter((g) => g.priceListId === list.id);
            return (
              <div key={list.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
                <h3 className="font-display text-2xl tracking-tight">{list.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{list.description}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {items.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>{p.name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatMoney(p.price)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-muted-foreground">
                  {attached.length
                    ? `On ${attached.map((g) => g.title).join(", ")}`
                    : "Not attached to a gallery"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl tracking-tight">Coupons</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Percent, a dollar amount, or buy-one-get-one. Visitors enter a code in the cart.
            </p>
          </div>
          <Button onClick={() => setCouponOpen(true)}>New coupon</Button>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {coupons.map((coupon) => (
            <CouponCard
              key={coupon.id}
              coupon={coupon}
              onToggle={() => updateCoupon(coupon.id, { active: !coupon.active })}
              onDelete={() => {
                deleteCoupon(coupon.id);
                toast("Coupon removed");
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-3xl tracking-tight">Galleries on sale</h2>
        <ul className="mt-6 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
          {galleries.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <select
                value={g.priceListId ?? ""}
                onChange={(e) => {
                  const priceListId = e.target.value || null;
                  updateGallery(g.id, { priceListId, forSale: Boolean(priceListId) || g.forSale });
                }}
                className="h-9 rounded-md bg-secondary px-2 text-sm shadow-[var(--shadow-border)]"
                aria-label={`Price list for ${g.title}`}
              >
                <option value="">No list</option>
                {priceLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant={g.forSale ? "secondary" : "outline"}
                onClick={() => updateGallery(g.id, { forSale: !g.forSale })}
              >
                {g.forSale ? "On sale" : "Off"}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <ProductDialog
        open={productOpen}
        onOpenChange={setProductOpen}
        onSubmit={(input) => {
          createProduct(input);
          toast("Product added");
        }}
      />
      <ListDialog
        open={listOpen}
        onOpenChange={setListOpen}
        products={products}
        onSubmit={(input) => {
          createPriceList(input);
          toast("Price list created");
        }}
      />
      <CouponDialog
        open={couponOpen}
        onOpenChange={setCouponOpen}
        onSubmit={(input) => {
          const id = createCoupon(input);
          if (!id) {
            toast("That code already exists");
            return false;
          }
          toast("Coupon added");
          return true;
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card px-5 py-4 shadow-[var(--shadow-border)]">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-3xl tracking-tight">{value}</p>
    </div>
  );
}

function ProductDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: {
    kind: ProductKind;
    name: string;
    description: string;
    size?: string;
    finish?: string;
    price: number;
    digitalVariant?: "display" | "original";
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ProductKind>("print");
  const [price, setPrice] = useState("36");
  const [size, setSize] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>A print, a file, or a package. Prices in US dollars.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number.parseFloat(price || "0") * 100);
            onSubmit({
              kind,
              name: name.trim() || "Untitled",
              description: description.trim(),
              size: size.trim() || undefined,
              price: Number.isFinite(cents) ? cents : 0,
              digitalVariant: kind === "digital" ? "original" : undefined,
            });
            setName("");
            setDescription("");
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pr-name">Name</Label>
            <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pr-kind">Kind</Label>
            <select
              id="pr-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ProductKind)}
              className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
            >
              <option value="print">Print</option>
              <option value="digital">Digital file</option>
              <option value="package">Package</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-price">Price (USD)</Label>
              <Input
                id="pr-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pr-size">Size</Label>
              <Input id="pr-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="8×10" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pr-desc">Description</Label>
            <Textarea id="pr-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add product</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({
  open,
  onOpenChange,
  products,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: Product[];
  onSubmit: (input: { name: string; description: string; productIds: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ids, setIds] = useState<Set<string>>(new Set());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New price list</DialogTitle>
          <DialogDescription>Choose the products a gallery can sell.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name: name.trim() || "Untitled list",
              description: description.trim(),
              productIds: Array.from(ids),
            });
            setName("");
            setDescription("");
            setIds(new Set());
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pl-name">Name</Label>
            <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pl-desc">Description</Label>
            <Textarea id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid max-h-48 gap-1 overflow-y-auto text-sm">
            {products.map((p) => (
              <label key={p.id} className="flex h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={ids.has(p.id)}
                  onChange={() => {
                    const next = new Set(ids);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    setIds(next);
                  }}
                  className="size-4 accent-primary"
                />
                {p.name}
                <span className="ml-auto tabular-nums text-muted-foreground">{formatMoney(p.price)}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create list</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CouponCard({
  coupon,
  onToggle,
  onDelete,
}: {
  coupon: Coupon;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium tracking-wide">{coupon.code}</p>
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {coupon.active ? "Active" : "Paused"}
        </span>
      </div>
      <p className="font-display mt-2 text-2xl tracking-tight">{couponSummary(coupon)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{coupon.description}</p>
      {coupon.minSubtotal > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Minimum {formatMoney(coupon.minSubtotal)}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant={coupon.active ? "secondary" : "outline"} onClick={onToggle}>
          {coupon.active ? "Pause" : "Activate"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function CouponDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: Omit<Coupon, "id">) => boolean;
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<CouponKind>("percent");
  const [percent, setPercent] = useState("10");
  const [amount, setAmount] = useState("15");
  const [bogoBuy, setBogoBuy] = useState("1");
  const [bogoGet, setBogoGet] = useState("1");
  const [appliesTo, setAppliesTo] = useState<CouponAppliesTo>("all");
  const [minSubtotal, setMinSubtotal] = useState("0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New coupon</DialogTitle>
          <DialogDescription>
            A code for the cart. Percent, dollars off, or buy one get one.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const min = Math.round(Number.parseFloat(minSubtotal || "0") * 100);
            const ok = onSubmit({
              code: code.trim().toUpperCase(),
              description: description.trim(),
              kind,
              percent: kind === "percent" ? Number.parseInt(percent, 10) || 0 : undefined,
              amount:
                kind === "amount"
                  ? Math.round(Number.parseFloat(amount || "0") * 100)
                  : undefined,
              bogoBuy: kind === "bogo" ? Number.parseInt(bogoBuy, 10) || 1 : undefined,
              bogoGet: kind === "bogo" ? Number.parseInt(bogoGet, 10) || 1 : undefined,
              appliesTo,
              minSubtotal: Number.isFinite(min) ? Math.max(0, min) : 0,
              active: true,
            });
            if (!ok) return;
            setCode("");
            setDescription("");
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="cp-code">Code</Label>
            <Input
              id="cp-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WELCOME10"
              required
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cp-kind">Deal</Label>
            <select
              id="cp-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as CouponKind)}
              className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
            >
              <option value="percent">Percent off</option>
              <option value="amount">Amount off</option>
              <option value="bogo">Buy one get one</option>
            </select>
          </div>
          {kind === "percent" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="cp-percent">Percent</Label>
              <Input
                id="cp-percent"
                type="number"
                min="1"
                max="100"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </div>
          ) : null}
          {kind === "amount" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="cp-amount">Amount (USD)</Label>
              <Input
                id="cp-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : null}
          {kind === "bogo" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cp-buy">Buy</Label>
                <Input
                  id="cp-buy"
                  type="number"
                  min="1"
                  value={bogoBuy}
                  onChange={(e) => setBogoBuy(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cp-get">Get free</Label>
                <Input
                  id="cp-get"
                  type="number"
                  min="1"
                  value={bogoGet}
                  onChange={(e) => setBogoGet(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cp-scope">Applies to</Label>
              <select
                id="cp-scope"
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value as CouponAppliesTo)}
                className="h-10 rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)]"
              >
                <option value="all">Everything</option>
                <option value="print">Prints</option>
                <option value="digital">Digital files</option>
                <option value="package">Packages</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-min">Minimum (USD)</Label>
              <Input
                id="cp-min"
                type="number"
                min="0"
                step="0.01"
                value={minSubtotal}
                onChange={(e) => setMinSubtotal(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cp-desc">Description</Label>
            <Textarea id="cp-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add coupon</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

