export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrintCropInput {
  versionId: string;
  sourceWidth: number;
  sourceHeight: number;
  /** EXIF orientation. Crops are expressed in the displayed, oriented coordinate space. */
  orientation: number;
  crop: NormalizedCrop;
  outputWidthInches: number;
  outputHeightInches: number;
  minimumDpi: number;
}

function bounded(value: number, maximum: number, integer = false) {
  return Number.isFinite(value) && value > 0 && value <= maximum && (!integer || Number.isSafeInteger(value));
}

/** Pure preflight, not fulfillment authorization. The server must load the immutable
 * version dimensions/orientation and product dimensions/minimum DPI itself. Never
 * trust browser-supplied source metadata or treat this result as proof of payment. */
export function validatePrintCrop(input: PrintCropInput) {
  if (!input || typeof input.versionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.versionId)) throw new Error("Invalid immutable photo version ID");
  if (!bounded(input.sourceWidth, 100000, true) || !bounded(input.sourceHeight, 100000, true)) throw new Error("Invalid source dimensions");
  if (!bounded(input.orientation, 8, true)) throw new Error("Invalid EXIF orientation");
  if (!bounded(input.outputWidthInches, 1000) || !bounded(input.outputHeightInches, 1000) || !bounded(input.minimumDpi, 2400)) throw new Error("Invalid print dimensions or DPI constraint");
  const crop = input.crop;
  if (!crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || crop.x < 0 || crop.y < 0 || !bounded(crop.width, 1) || !bounded(crop.height, 1) || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error("Invalid normalized crop rectangle");
  const swapsAxes = input.orientation >= 5;
  const width = swapsAxes ? input.sourceHeight : input.sourceWidth;
  const height = swapsAxes ? input.sourceWidth : input.sourceHeight;
  // Pixel coverage rounds inward; fractional edge pixels cannot inflate printable resolution.
  const croppedWidthPixels = Math.floor((crop.x + crop.width) * width) - Math.ceil(crop.x * width);
  const croppedHeightPixels = Math.floor((crop.y + crop.height) * height) - Math.ceil(crop.y * height);
  if (croppedWidthPixels < 1 || croppedHeightPixels < 1) throw new Error("Crop contains no complete pixels");
  const desiredRatio = input.outputWidthInches / input.outputHeightInches;
  const ratio = crop.width * width / (crop.height * height);
  // Small arithmetic tolerance only, never silently stretch or add an unapproved crop.
  if (Math.abs(ratio / desiredRatio - 1) > 0.000001) throw new Error("Crop aspect ratio does not match print dimensions");
  const effectiveDpi = Math.min(croppedWidthPixels / input.outputWidthInches, croppedHeightPixels / input.outputHeightInches);
  if (effectiveDpi < input.minimumDpi) throw new Error("Crop does not meet minimum print DPI");
  return Object.freeze({ versionId: input.versionId, orientation: input.orientation, crop: Object.freeze({ ...crop }), outputWidthInches: input.outputWidthInches, outputHeightInches: input.outputHeightInches, minimumDpi: input.minimumDpi, croppedWidthPixels, croppedHeightPixels, effectiveDpi });
}
