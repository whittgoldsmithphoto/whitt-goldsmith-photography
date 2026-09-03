import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cartCount } from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";

export function CartButton() {
  const cart = useStudioStore((s) => s.cart);
  const n = cartCount(cart);
  return (
    <Button asChild variant="ghost" size="icon" aria-label={n ? `Cart, ${n} items` : "Cart"}>
      <Link to="/cart" className="relative">
        <ShoppingBag />
        {n > 0 && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {n > 9 ? "9+" : n}
          </span>
        )}
      </Link>
    </Button>
  );
}
