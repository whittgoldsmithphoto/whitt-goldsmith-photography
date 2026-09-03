import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PhotoImage } from "@/components/photo-image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  formatMoney,
  isForSale,
  listForGallery,
  productsOnList,
} from "@/lib/commerce";
import { useStudioStore } from "@/lib/store";
import type { Photo, Product } from "@/lib/types";

export function BuySheet({
  photo,
  open,
  onOpenChange,
}: {
  photo: Photo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const galleries = useStudioStore((s) => s.galleries);
  const products = useStudioStore((s) => s.products);
  const priceLists = useStudioStore((s) => s.priceLists);
  const addToCart = useStudioStore((s) => s.addToCart);
  const gallery = galleries.find((g) => g.id === photo.galleryId);
  const list = listForGallery(gallery, priceLists);
  const items = productsOnList(list, products);
  const [picked, setPicked] = useState<string>(items[0]?.id ?? "");
  const product = items.find((p) => p.id === picked) ?? items[0];

  if (!gallery || !isForSale(photo, gallery) || !items.length) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(26rem,100%)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Buy a print</SheetTitle>
        </SheetHeader>
        <div className="mt-6 overflow-hidden rounded-lg bg-muted">
          <PhotoImage photo={photo} alt="" variant="thumb" className="aspect-[4/3] w-full object-cover" />
        </div>
        <p className="font-display mt-4 text-2xl tracking-tight">{photo.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{gallery.title}</p>

        <div className="mt-6 grid gap-2">
          <Label>Product</Label>
          {items.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              selected={product?.id === p.id}
              onSelect={() => setPicked(p.id)}
            />
          ))}
        </div>

        <Button
          className="mt-6 w-full"
          disabled={!product}
          onClick={() => {
            if (!product) return;
            addToCart(photo.id, product.id);
            toast(`${product.name} added to cart`);
            onOpenChange(false);
          }}
        >
          Add to cart{product ? ` · ${formatMoney(product.price)}` : ""}
        </Button>
        <Button asChild variant="ghost" className="mt-2 w-full">
          <Link to="/cart">View cart</Link>
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Prints are fulfilled by the studio. Files stay on this device until you download them from
          the order.
        </p>
      </SheetContent>
    </Sheet>
  );
}

function ProductRow({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-lg px-3 py-3 text-left shadow-[var(--shadow-border)] ${
        selected ? "bg-accent text-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-foreground">{product.name}</span>
        <span className="tabular-nums text-foreground">{formatMoney(product.price)}</span>
      </span>
      <span className="mt-1 block text-xs">
        {product.kind === "print" && product.finish ? `${product.finish} · ` : ""}
        {product.description}
      </span>
    </button>
  );
}
