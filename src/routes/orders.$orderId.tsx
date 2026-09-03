import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PhotoImage } from "@/components/photo-image";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";
import { formatWhen } from "@/lib/utils";
import { downloadOriginal } from "@/lib/vault";

export const Route = createFileRoute("/orders/$orderId")({ component: OrderPage });

function OrderPage() {
  const { orderId } = Route.useParams();
  const orders = useStudioStore((s) => s.orders);
  const photos = useStudioStore((s) => s.photos);
  const updateOrderStatus = useStudioStore((s) => s.updateOrderStatus);
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Order not found</h1>
        <Button asChild className="mt-8">
          <Link to="/sell">Back to selling</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-sm text-muted-foreground">
        <Link to="/sell" className="hover:text-foreground">
          Selling
        </Link>
        {" / "}
        {order.number}
      </p>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {order.status}
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight">{order.number}</h1>
      <p className="mt-2 text-muted-foreground">
        {order.buyerName} · {order.buyerEmail} · {formatWhen(order.createdAt)}
      </p>
      {order.note ? <p className="mt-4 text-sm">{order.note}</p> : null}

      <ul className="mt-10 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
        {order.items.map((item, i) => {
          const photo = photos.find((p) => p.id === item.photoId);
          return (
            <li key={`${item.photoId}-${item.productId}-${i}`} className="flex items-center gap-4 p-4">
              {photo ? (
                <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                  <PhotoImage photo={photo} alt="" variant="thumb" className="size-full object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.photoTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {item.productName} · ×{item.qty}
                </p>
              </div>
              <p className="tabular-nums">{formatMoney(item.unitPrice * item.qty)}</p>
              {item.kind === "digital" && photo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void downloadOriginal(photo)
                      .then(() => toast("File downloaded"))
                      .catch(() => toast("Could not download"))
                  }
                >
                  Download
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-6 space-y-1">
        <p className="flex justify-between gap-4 text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatMoney(order.subtotal ?? order.total)}</span>
        </p>
        {(order.discount ?? 0) > 0 ? (
          <p className="flex justify-between gap-4 text-sm text-muted-foreground">
            <span>{order.couponCode ? `${order.couponCode} · discount` : "Discount"}</span>
            <span className="tabular-nums">−{formatMoney(order.discount)}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-3xl tabular-nums">{formatMoney(order.total)}</p>
        <div className="flex gap-2">
          {order.status === "new" && (
            <Button onClick={() => updateOrderStatus(order.id, "fulfilled")}>Mark fulfilled</Button>
          )}
          {order.status !== "cancelled" && (
            <Button variant="outline" onClick={() => updateOrderStatus(order.id, "cancelled")}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
