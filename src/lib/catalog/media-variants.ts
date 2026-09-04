export const DERIVATIVE_VARIANT_NAMES = [
  "placeholder",
  "thumbnail",
  "thumbnail-2x",
  "small",
  "small-2x",
  "display",
] as const;

export const MEDIA_VARIANT_NAMES = [...DERIVATIVE_VARIANT_NAMES, "original"] as const;

export type DerivativeVariantName = (typeof DERIVATIVE_VARIANT_NAMES)[number];
export type MediaVariantName = (typeof MEDIA_VARIANT_NAMES)[number];

export const VARIANT_MAX_EDGE: Record<DerivativeVariantName, number> = {
  placeholder: 48,
  thumbnail: 320,
  "thumbnail-2x": 640,
  small: 960,
  "small-2x": 1920,
  display: 2560,
};

export function derivativeVariantKey(
  photoId: string,
  name: DerivativeVariantName,
  checksum: string,
  transformationVersion: number,
) {
  return `catalog/derivatives/v${transformationVersion}/${photoId}/${name}-${checksum}.jpg`;
}

export function fittedDimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
