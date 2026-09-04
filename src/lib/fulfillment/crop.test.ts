import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePrintCrop } from "./crop.ts";

const fixture = () => ({ versionId: "version_123", sourceWidth: 6000, sourceHeight: 4000, orientation: 1, crop: { x: 0, y: 0, width: 1, height: 1 }, outputWidthInches: 12, outputHeightInches: 8, minimumDpi: 300 });
test("valid crop binds immutable version and computes effective DPI", () => {
  const input = fixture();
  const result = validatePrintCrop(input);
  assert.equal(result.effectiveDpi, 500);
  assert.equal(result.versionId, "version_123");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.crop));
  input.crop.width = 0.5;
  assert.equal(result.crop.width, 1);
});
test("EXIF orientations 5 through 8 swap display dimensions", () => {
  for (const orientation of [5, 6, 7, 8]) {
    const result = validatePrintCrop({ ...fixture(), orientation, outputWidthInches: 8, outputHeightInches: 12 });
    assert.equal(result.croppedWidthPixels, 4000);
    assert.equal(result.croppedHeightPixels, 6000);
    assert.equal(result.effectiveDpi, 500);
  }
});
test("rejects unbound versions, invalid orientations and unbounded dimensions", () => {
  for (const patch of [{ versionId: "" }, { versionId: "../key" }, { sourceWidth: 0 }, { sourceHeight: Infinity }, { sourceWidth: 1.5 }, { sourceWidth: 100001 }, { orientation: 0 }, { orientation: 9 }, { outputWidthInches: 0 }, { outputHeightInches: NaN }, { outputWidthInches: 1001 }, { minimumDpi: 0 }, { minimumDpi: Infinity }]) {
    assert.throws(() => validatePrintCrop({ ...fixture(), ...patch }));
  }
});
test("rejects non-normalized, empty, out-of-bounds and low resolution crops", () => {
  for (const crop of [{ x: -0.1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: 0.1, y: 0, width: 1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0.1, height: 0.1 }]) {
    assert.throws(() => validatePrintCrop({ ...fixture(), crop }));
  }
  assert.throws(() => validatePrintCrop({ ...fixture(), outputWidthInches: 10 }), /aspect/);
});
test("DPI boundary is conservative and normalized grid behaves consistently", () => {
  assert.equal(validatePrintCrop({ ...fixture(), minimumDpi: 500 }).effectiveDpi, 500);
  assert.throws(() => validatePrintCrop({ ...fixture(), minimumDpi: 501 }), /DPI/);
  for (let i = 1; i <= 10; i++) {
    const fraction = i / 10;
    const result = validatePrintCrop({ ...fixture(), crop: { x: 0, y: 0, width: fraction, height: fraction }, outputWidthInches: 12 * fraction, outputHeightInches: 8 * fraction });
    assert.ok(result.effectiveDpi >= 499);
  }
});
