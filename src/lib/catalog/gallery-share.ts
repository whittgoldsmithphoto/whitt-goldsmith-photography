type ShareGallery = { id: string; published: boolean; visibility: string };

export function galleryShareUrl(origin: string, gallery: ShareGallery) {
  if (!gallery.published || !["public", "unlisted"].includes(gallery.visibility))
    throw new Error("Publish this gallery for customers before sharing.");
  const site = new URL(origin);
  if (
    !["http:", "https:"].includes(site.protocol) ||
    site.origin !== origin ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gallery.id)
  )
    throw new Error("Invalid gallery share address");
  return `${site.origin}/galleries/${gallery.id}`;
}

/** Encodes only the existing gallery page, never a password, grant or original URL. */
export async function galleryQrSvg(origin: string, gallery: ShareGallery) {
  const url = galleryShareUrl(origin, gallery);
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
