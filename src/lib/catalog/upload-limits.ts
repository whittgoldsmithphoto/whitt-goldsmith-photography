/** Ceiling for one original JPEG/PNG. Sports bodies routinely exceed 20 MiB. */
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
export const MAX_PHOTO_LABEL = "40 MB";

export function photoUploadError(file: { type: string; size: number }): string | null {
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size <= 0) {
    return `Use a nonempty JPEG or PNG up to ${MAX_PHOTO_LABEL}. RAW/TIFF are not supported yet.`;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `That file is larger than ${MAX_PHOTO_LABEL}. Compress it as JPEG or PNG and retry.`;
  }
  return null;
}
