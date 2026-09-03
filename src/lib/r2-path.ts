export type R2Kind = "orig" | "display" | "thumb";

export function r2Slug(value: string, fallback = "untitled") {
  return (
    value
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

export function r2Stem(filename: string, photoId: string) {
  const base = filename.replace(/\.[^.]+$/, "");
  return r2Slug(base, r2Slug(photoId, "frame"));
}

export function r2Ext(filename: string, mime: string, kind: R2Kind) {
  if (kind !== "orig") return "jpg";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpeg") return "jpg";
  if (["jpg", "png", "tif", "tiff", "webp", "heic"].includes(ext)) return ext;
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

export function r2Role(kind: R2Kind) {
  if (kind === "orig") return "original";
  if (kind === "display") return "wall";
  return "thumb";
}

export function r2ObjectKey(input: {
  folderSlug: string;
  gallerySlug: string;
  stem: string;
  kind: R2Kind;
  ext: string;
}) {
  const folder = r2Slug(input.folderSlug, "uncategorized");
  const gallery = r2Slug(input.gallerySlug, "gallery");
  const stem = r2Slug(input.stem, "frame");
  const ext = input.kind === "orig" ? input.ext : "jpg";
  return `library/${folder}/${gallery}/${stem}/${r2Role(input.kind)}.${ext}`;
}

export function r2GalleryPrefix(folderSlug: string, gallerySlug: string) {
  return `library/${r2Slug(folderSlug, "uncategorized")}/${r2Slug(gallerySlug, "gallery")}/`;
}

export function legacyR2Key(photoId: string, kind: R2Kind) {
  const folder = kind === "orig" ? "originals" : "wall";
  return `${folder}/${photoId}/${kind}`;
}
