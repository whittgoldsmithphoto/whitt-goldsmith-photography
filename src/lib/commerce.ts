import type {
  CartItem,
  Coupon,
  CouponAppliesTo,
  Gallery,
  Photo,
  PriceList,
  Product,
} from "./types";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function isForSale(photo: Photo, gallery?: Gallery) {
  return Boolean(gallery?.forSale && photo.forSale && !photo.archived && !photo.hidden);
}

export function productsOnList(list: PriceList | undefined, products: Product[]) {
  if (!list) return [];
  return list.productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
}

export function listForGallery(gallery: Gallery | undefined, lists: PriceList[]) {
  if (!gallery?.priceListId) return undefined;
  return lists.find((l) => l.id === gallery.priceListId);
}

export function startingPrice(list: PriceList | undefined, products: Product[]) {
  const prices = productsOnList(list, products).map((p) => p.price);
  if (!prices.length) return 0;
  return Math.min(...prices);
}

export function cartCount(cart: CartItem[]) {
  return cart.reduce((n, i) => n + i.qty, 0);
}

export function lineTotal(item: CartItem, products: Product[]) {
  const product = products.find((p) => p.id === item.productId);
  return (product?.price ?? 0) * item.qty;
}

export function cartTotal(cart: CartItem[], products: Product[]) {
  return cart.reduce((n, i) => n + lineTotal(i, products), 0);
}

export function findCoupon(code: string, coupons: Coupon[]) {
  const needle = code.trim().toUpperCase();
  if (!needle) return undefined;
  return coupons.find((c) => c.code.toUpperCase() === needle);
}

export function couponApplies(coupon: Coupon, product: Product) {
  return coupon.appliesTo === "all" || product.kind === coupon.appliesTo;
}

function matchingUnitPrices(coupon: Coupon, cart: CartItem[], products: Product[]) {
  const prices: number[] = [];
  for (const item of cart) {
    const product = products.find((p) => p.id === item.productId);
    if (!product || !couponApplies(coupon, product)) continue;
    for (let i = 0; i < item.qty; i++) prices.push(product.price);
  }
  return prices;
}

export function couponDiscount(coupon: Coupon, cart: CartItem[], products: Product[]) {
  const prices = matchingUnitPrices(coupon, cart, products);
  const eligible = prices.reduce((n, p) => n + p, 0);
  if (!prices.length) return 0;
  if (coupon.kind === "percent") {
    return Math.round((eligible * (coupon.percent ?? 0)) / 100);
  }
  if (coupon.kind === "amount") {
    return Math.min(coupon.amount ?? 0, eligible);
  }
  const buy = Math.max(1, coupon.bogoBuy ?? 1);
  const get = Math.max(1, coupon.bogoGet ?? 1);
  const freeCount = Math.floor(prices.length / (buy + get)) * get;
  if (!freeCount) return 0;
  return prices
    .slice()
    .sort((a, b) => a - b)
    .slice(0, freeCount)
    .reduce((n, p) => n + p, 0);
}

export type CartTotals = {
  subtotal: number;
  discount: number;
  total: number;
  coupon: Coupon | null;
  reason?: string;
};

export function cartTotals(
  cart: CartItem[],
  products: Product[],
  coupons: Coupon[],
  appliedCode: string | null,
): CartTotals {
  const subtotal = cartTotal(cart, products);
  if (!appliedCode) return { subtotal, discount: 0, total: subtotal, coupon: null };
  const coupon = findCoupon(appliedCode, coupons);
  if (!coupon) {
    return { subtotal, discount: 0, total: subtotal, coupon: null, reason: "Unknown code" };
  }
  if (!coupon.active) {
    return { subtotal, discount: 0, total: subtotal, coupon, reason: "This code is paused" };
  }
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return {
      subtotal,
      discount: 0,
      total: subtotal,
      coupon,
      reason: `Spend ${formatMoney(coupon.minSubtotal)} to use this code`,
    };
  }
  const prices = matchingUnitPrices(coupon, cart, products);
  if (!prices.length) {
    return {
      subtotal,
      discount: 0,
      total: subtotal,
      coupon,
      reason: scopeReason(coupon.appliesTo),
    };
  }
  const discount = Math.min(couponDiscount(coupon, cart, products), subtotal);
  if (coupon.kind === "bogo" && discount === 0) {
    return {
      subtotal,
      discount: 0,
      total: subtotal,
      coupon,
      reason: "Add another qualifying item",
    };
  }
  return { subtotal, discount, total: Math.max(0, subtotal - discount), coupon };
}

function scopeReason(appliesTo: CouponAppliesTo) {
  if (appliesTo === "print") return "No prints in the cart";
  if (appliesTo === "digital") return "No digital files in the cart";
  if (appliesTo === "package") return "No packages in the cart";
  return "Nothing in the cart qualifies";
}

export function couponSummary(coupon: Coupon) {
  const scope =
    coupon.appliesTo === "all"
      ? ""
      : coupon.appliesTo === "print"
        ? " on prints"
        : coupon.appliesTo === "digital"
          ? " on digital files"
          : " on packages";
  if (coupon.kind === "percent") return `${coupon.percent ?? 0}% off${scope}`;
  if (coupon.kind === "amount") return `${formatMoney(coupon.amount ?? 0)} off${scope}`;
  const buy = coupon.bogoBuy ?? 1;
  const get = coupon.bogoGet ?? 1;
  return `Buy ${buy}, get ${get} free${scope}`;
}

export function keywordIndex(photos: Photo[]) {
  const map = new Map<string, number>();
  for (const p of photos) {
    if (p.archived) continue;
    for (const tag of p.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function photosWithKeyword(photos: Photo[], tag: string) {
  const needle = tag.toLowerCase();
  return photos.filter((p) => !p.archived && p.tags.includes(needle));
}

export function nextOrderNumber(existing: { number: string }[]) {
  const nums = existing
    .map((o) => Number.parseInt(o.number.replace(/\D/g, ""), 10))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 1041) + 1;
  return `WG-${next}`;
}
