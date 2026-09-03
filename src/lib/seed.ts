import type {
  Coupon,
  Folder,
  Gallery,
  Order,
  Photo,
  PriceList,
  Product,
  StudioProfile,
} from "./types";

export const defaultStudio: StudioProfile = {
  name: "Whitt Goldsmith Photography",
  tagline: "Sports and events, kept with care.",
  about:
    "A studio in Greenville, South Carolina. Galleries for the games, rooms for proofs, and a quiet place to take a print — or the file — home.",
  location: "Greenville, South Carolina",
  watermark: true,
  protect: true,
};

/** Empty on purpose. Folders and galleries are created in Organizer. */
export const seedFolders: Folder[] = [];
export const seedGalleries: Gallery[] = [];
export const seedPhotos: Photo[] = [];
export const seedOrders: Order[] = [];

export const seedProducts: Product[] = [
  {
    id: "print-4x6",
    kind: "print",
    name: "4×6 print",
    description: "Luster paper. A small print for a desk or a note.",
    size: "4×6",
    finish: "Luster",
    price: 1500,
  },
  {
    id: "print-5x7",
    kind: "print",
    name: "5×7 print",
    description: "Luster paper. The classic gift size.",
    size: "5×7",
    finish: "Luster",
    price: 2200,
  },
  {
    id: "print-8x10",
    kind: "print",
    name: "8×10 print",
    description: "Luster paper. Ready for a standard frame.",
    size: "8×10",
    finish: "Luster",
    price: 3600,
  },
  {
    id: "print-11x14",
    kind: "print",
    name: "11×14 print",
    description: "Luster paper. A presence on the wall without shouting.",
    size: "11×14",
    finish: "Luster",
    price: 5800,
  },
  {
    id: "print-16x20",
    kind: "print",
    name: "16×20 print",
    description: "Luster paper. The photograph as a room would have it.",
    size: "16×20",
    finish: "Luster",
    price: 9600,
  },
  {
    id: "canvas-16x24",
    kind: "print",
    name: "16×24 canvas",
    description: "Gallery wrap. No glass, no glare.",
    size: "16×24",
    finish: "Canvas",
    price: 18000,
  },
  {
    id: "digital-web",
    kind: "digital",
    name: "Web file",
    description: "A display-size JPEG for screens and sharing.",
    price: 2500,
    digitalVariant: "display",
  },
  {
    id: "digital-orig",
    kind: "digital",
    name: "Original file",
    description: "The vault original. Highest resolution on file.",
    price: 7500,
    digitalVariant: "original",
  },
  {
    id: "pkg-wall",
    kind: "package",
    name: "Wall set",
    description: "One 16×20 print and the original file.",
    price: 15000,
  },
];

export const seedPriceLists: PriceList[] = [
  {
    id: "list-standard",
    name: "Standard prints",
    description: "Public galleries. Prints, canvas, and files.",
    productIds: [
      "print-4x6",
      "print-5x7",
      "print-8x10",
      "print-11x14",
      "print-16x20",
      "canvas-16x24",
      "digital-web",
      "digital-orig",
      "pkg-wall",
    ],
  },
  {
    id: "list-proofing",
    name: "Client proofing",
    description: "Private rooms. Larger prints and the original file.",
    productIds: ["print-8x10", "print-11x14", "print-16x20", "canvas-16x24", "digital-orig", "pkg-wall"],
  },
];

export const seedCoupons: Coupon[] = [
  {
    id: "coupon-welcome",
    code: "WELCOME10",
    description: "Ten percent off the order. A first visit.",
    kind: "percent",
    percent: 10,
    appliesTo: "all",
    minSubtotal: 0,
    active: true,
  },
  {
    id: "coupon-print15",
    code: "PRINT15",
    description: "Fifteen dollars off prints when the cart is fifty or more.",
    kind: "amount",
    amount: 1500,
    appliesTo: "print",
    minSubtotal: 5000,
    active: true,
  },
  {
    id: "coupon-bogo",
    code: "BOGO",
    description: "Buy one print, get the next print free. The cheaper print is the gift.",
    kind: "bogo",
    bogoBuy: 1,
    bogoGet: 1,
    appliesTo: "print",
    minSubtotal: 0,
    active: true,
  },
];
