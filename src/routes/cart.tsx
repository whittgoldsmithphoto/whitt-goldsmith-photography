import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PhotoImage } from "@/components/photo-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cartCount, cartTotals, couponSummary, formatMoney, lineTotal } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";

export const Route = createFileRoute("/cart")({ component: CartPage });

function CartPage() {
  const cart = useStudioStore((s) => s.cart);
  const photos = useStudioStore((s) => s.photos);
  const products = useStudioStore((s) => s.products);
  const coupons = useStudioStore((s) => s.coupons);
  const appliedCoupon = useStudioStore((s) => s.appliedCoupon);
  const updateCartQty = useStudioStore((s) => s.updateCartQty);
  const removeFromCart = useStudioStore((s) => s.removeFromCart);
  const applyCoupon = useStudioStore((s) => s.applyCoupon);
  const clearCoupon = useStudioStore((s) => s.clearCoupon);
  const [code, setCode] = useState("");
  const totals = cartTotals(cart, products, coupons, appliedCoupon);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Studio
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Cart</h1>
      <p className="mt-2 text-muted-foreground">
        {cart.length === 0
          ? "Nothing waiting. Open a gallery and buy a print from the photograph."
          : `${cartCount(cart)} ${cartCount(cart) === 1 ? "item" : "items"}`}
      </p>

      {cart.length === 0 ? (
        <Button asChild className="mt-8">
          <Link to="/galleries">Browse galleries</Link>
        </Button>
      ) : (
        <>
          <ul className="mt-10 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
            {cart.map((item) => {
              const photo = photos.find((p) => p.id === item.photoId);
              const product = products.find((p) => p.id === item.productId);
              if (!photo || !product) return null;
              return (
                <li key={item.id} className="flex gap-4 p-4">
                  <div className="size-20 shrink-0 overflow-hidden rounded-md bg-muted">
                    <PhotoImage photo={photo} alt="" variant="thumb" className="size-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{photo.title}</p>
                    <p className="text-sm text-muted-foreground">{product.name}</p>
                    <p className="mt-1 text-sm tabular-nums">{formatMoney(product.price)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Decrease quantity"
                        onClick={() => updateCartQty(item.id, item.qty - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="w-6 text-center text-sm tabular-nums">{item.qty}</span>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Increase quantity"
                        onClick={() => updateCartQty(item.id, item.qty + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <p className="tabular-nums">{formatMoney(lineTotal(item, products))}</p>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove from cart"
                      onClick={() => removeFromCart(item.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <form
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const error = applyCoupon(code);
              if (error) {
                toast(error);
                return;
              }
              setCode("");
              toast("Code applied");
            }}
          >
            <div className="grid min-w-0 flex-1 gap-1.5">
              <label htmlFor="coupon-code" className="text-sm text-muted-foreground">
                Have a code?
              </label>
              <Input
                id="coupon-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="WELCOME10"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>

          {totals.coupon ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <span className="font-medium">{totals.coupon.code}</span>
                <span className="text-muted-foreground"> · {couponSummary(totals.coupon)}</span>
              </p>
              <Button type="button" size="sm" variant="ghost" onClick={() => clearCoupon()}>
                Remove
              </Button>
            </div>
          ) : null}
          {totals.reason ? (
            <p className="mt-1 text-sm text-muted-foreground">{totals.reason}</p>
          ) : null}

          <div className="mt-8 flex items-end justify-between gap-4">
            <p className="max-w-xs text-sm text-muted-foreground">
              Prints are fulfilled by the studio. Digital files download after the order. Nothing is
              charged in this preview.
            </p>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">
                Subtotal {formatMoney(totals.subtotal)}
              </p>
              {totals.discount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Discount −{formatMoney(totals.discount)}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">Total</p>
              <p className="font-display text-3xl tabular-nums">{formatMoney(totals.total)}</p>
              <Button asChild className="mt-4">
                <Link to="/checkout">Checkout</Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
