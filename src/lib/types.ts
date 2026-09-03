export type GalleryLayout = "justified" | "masonry" | "grid" | "filmstrip";
export type Privacy = "public" | "unlisted" | "private";
export type PhotoSort =
  | "manual"
  | "filename"
  | "uploaded"
  | "taken"
  | "modified"
  | "caption"
  | "rating";
export type ColorLabel = "none" | "select" | "maybe" | "reject";
export type ProductKind = "print" | "digital" | "package";
export type OrderStatus = "new" | "fulfilled" | "cancelled";
export type CouponKind = "percent" | "amount" | "bogo";
export type CouponAppliesTo = "all" | ProductKind;

export const PHOTO_SORTS: { id: PhotoSort; label: string }[] = [
  { id: "manual", label: "Manual" },
  { id: "filename", label: "Filename" },
  { id: "uploaded", label: "Date uploaded" },
  { id: "taken", label: "Date taken" },
  { id: "modified", label: "Date modified" },
  { id: "caption", label: "Caption" },
  { id: "rating", label: "Rating" },
];

export const PRIVACY_OPTIONS: { id: Privacy; label: string }[] = [
  { id: "public", label: "Public" },
  { id: "unlisted", label: "Unlisted — link only" },
  { id: "private", label: "Private" },
];

export const COLOR_LABELS: { id: ColorLabel; label: string }[] = [
  { id: "none", label: "No flag" },
  { id: "select", label: "Select" },
  { id: "maybe", label: "Maybe" },
  { id: "reject", label: "Reject" },
];

export type StudioProfile = {
  name: string;
  tagline: string;
  about: string;
  location: string;
  watermark: boolean;
  protect: boolean;
};

export type Folder = {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  highlightImageId: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type Gallery = {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  category: string;
  coverPhotoId: string | null;
  layout: GalleryLayout;
  featured: boolean;
  privacy: Privacy;
  sortBy: PhotoSort;
  position: number;
  createdAt: number;
  updatedAt: number;
  forSale: boolean;
  priceListId: string | null;
  password: string | null;
};

export type Photo = {
  id: string;
  galleryId: string;
  title: string;
  caption: string;
  tags: string[];
  src: string;
  originalSrc: string;
  thumbSrc: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  createdAt: number;
  modifiedAt: number;
  takenAt?: number;
  favorite: boolean;
  hidden: boolean;
  archived: boolean;
  archivedAt?: number;
  position: number;
  filename: string;
  mime: string;
  bytes: number;
  hash?: string;
  camera?: string;
  lens?: string;
  settings?: string;
  rating: number;
  label: ColorLabel;
  forSale: boolean;
  r2OriginalKey?: string;
  r2DisplayKey?: string;
  r2ThumbKey?: string;
};

export type UploadJob = {
  id: string;
  galleryId: string;
  filename: string;
  status: "working" | "done" | "error" | "skipped";
  message?: string;
};

export type Product = {
  id: string;
  kind: ProductKind;
  name: string;
  description: string;
  size?: string;
  finish?: string;
  price: number;
  digitalVariant?: "display" | "original";
};

export type PriceList = {
  id: string;
  name: string;
  description: string;
  productIds: string[];
};

export type Coupon = {
  id: string;
  code: string;
  description: string;
  kind: CouponKind;
  percent?: number;
  amount?: number;
  bogoBuy?: number;
  bogoGet?: number;
  appliesTo: CouponAppliesTo;
  minSubtotal: number;
  active: boolean;
};

export type CartItem = {
  id: string;
  photoId: string;
  productId: string;
  qty: number;
};

export type OrderItem = {
  photoId: string;
  photoTitle: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  kind: ProductKind;
};

export type Order = {
  id: string;
  number: string;
  createdAt: number;
  status: OrderStatus;
  buyerName: string;
  buyerEmail: string;
  note: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  couponCode?: string;
  total: number;
};
