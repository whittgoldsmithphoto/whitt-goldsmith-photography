import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cartTotals, couponSummary, formatMoney } from "@/lib/commerce";
import { createStripeCheckout } from "@/lib/shop-fns";
import { useStudioStore } from "@/lib/store";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

function CheckoutPage() {
  const cart = useStudioStore((s) => s.cart);
  const products = useStudioStore((s) => s.products);
  const coupons = useStudioStore((s) => s.coupons);
  const appliedCoupon = useStudioStore((s) => s.appliedCoupon);
  const photos = useStudioStore((s) => s.photos);
  const placeOrder = useStudioStore((s) => s.placeOrder);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const totals = cartTotals(cart, products, coupons, appliedCoupon);

  if (!cart.length) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Cart is empty</h1>
        <Button asChild className="mt-8">
          <Link to="/galleries">Browse galleries</Link>
        </Button>
      </div>
    );
  }

  async function payWithCard() {
    setBusy(true);
    try {
      const items = cart.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        const photo = photos.find((p) => p.id === item.photoId);
        return {
          productId: item.productId,
          name: `${photo?.title ?? "Photograph"} · ${product?.name ?? "Print"}`,
          amount: product?.price ?? 0,
          qty: item.qty,
          photoId: item.photoId,
        };
      });
      const { url } = await createStripeCheckout({
        data: {
          email,
          name,
          note,
          items,
          successPath: "/checkout/thanks",
          cancelPath: "/checkout",
        },
      });
      window.location.assign(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start checkout";
      if (message.includes("not connected")) {
        const id = placeOrder({ buyerName: name, buyerEmail: email, note });
        if (id) {
          toast("Order recorded. Stripe is not connected yet, so nothing was charged.");
          void navigate({ to: "/orders/$orderId", params: { orderId: id } });
          return;
        }
      }
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Order</p>
      <h1 className="font-display mt-2 text-4xl tracking-tight">Checkout</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Guest checkout. No account. Name and email are recorded with the order. Tax is calculated by Stripe.
      </p>
      <div className="mt-4 space-y-1 text-sm text-muted-foreground">
        <p className="flex justify-between gap-4">
          <span>Subtotal</span>
          <span className="tabular-nums text-foreground">{formatMoney(totals.subtotal)}</span>
        </p>
        {totals.discount > 0 && totals.coupon ? (
          <p className="flex justify-between gap-4">
            <span>
              {totals.coupon.code}
              <span className="text-muted-foreground"> · {couponSummary(totals.coupon)}</span>
            </span>
            <span className="tabular-nums text-foreground">−{formatMoney(totals.discount)}</span>
          </p>
        ) : null}
        {totals.reason ? <p>{totals.reason}</p> : null}
        <p className="flex justify-between gap-4 pt-2 text-base text-foreground">
          <span>Total before tax</span>
          <span className="font-display text-2xl tabular-nums">{formatMoney(totals.total)}</span>
        </p>
      </div>
      <form
        className="mt-10 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void payWithCard();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="co-name">Name</Label>
          <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="co-email">Email</Label>
          <Input id="co-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="co-note">Note</Label>
          <Textarea id="co-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Opening Stripe…" : "Pay with card"}
        </Button>
      </form>
    </div>
  );
}
