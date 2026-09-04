import { test } from "node:test";
import assert from "node:assert/strict";
import { privateMetadataFreeJpeg } from "./jpeg-privacy.ts";
const segment = (marker: number, value: number[]) => [255, marker, 0, value.length + 2, ...value];
const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
test("strips EXIF XMP IPTC comments embedded thumbnails provenance and trailing data without changing scan bytes", () => {
  const entropy = [1, 2, 255, 0, 3, 255, 0xd0, 4];
  const jpeg = new Uint8Array([
    255,
    216,
    ...segment(0xe0, [1]),
    ...segment(0xe1, [2]),
    ...segment(0xed, [3]),
    ...segment(0xeb, [4]),
    ...segment(0xfe, [5]),
    ...segment(0xe2, [6, 7, 8]),
    ...segment(0xee, [65, 100, 111, 98, 101, 9, 9, 9, 9, 9, 9, 9, 9]),
    ...sos,
    ...entropy,
    255,
    217,
    6,
    7,
    8,
  ]);
  assert.deepEqual(
    privateMetadataFreeJpeg(jpeg),
    new Uint8Array([255, 216, ...sos, ...entropy, 255, 217]),
  );
});
test("retains color-transform segments and strips metadata between progressive scans", () => {
  const color = segment(0xee, [65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 1]);
  const jpeg = new Uint8Array([
    255,
    216,
    ...color,
    ...sos,
    1,
    2,
    ...segment(0xe1, [9, 9]),
    ...sos,
    3,
    4,
    255,
    217,
  ]);
  const expected = new Uint8Array([255, 216, ...color, ...sos, 1, 2, ...sos, 3, 4, 255, 217]);
  assert.deepEqual(privateMetadataFreeJpeg(jpeg), expected);
  assert.deepEqual(privateMetadataFreeJpeg(expected), expected);
});
test("malformed or truncated previews fail closed", () => {
  for (const bytes of [
    [1, 2, 3],
    [255, 216, 255, 217],
    [255, 216, 255, 225, 0, 1],
    [255, 216, 255, 225, 0, 30, 1],
    [255, 216, ...sos, 1, 2],
    [255, 216, ...sos, 255],
  ])
    assert.throws(() => privateMetadataFreeJpeg(new Uint8Array(bytes)));
});
test("Adobe APP14 normalizes arbitrary version and flags while preserving only valid transforms", () => {
  for (const transform of [0, 1, 2, 3, 255]) {
    const arbitrary = segment(0xee, [65, 100, 111, 98, 101, 71, 80, 83, 88, 89, 90, transform]);
    const input = new Uint8Array([255, 216, ...arbitrary, ...sos, 1, 2, 255, 217]);
    const expected = new Uint8Array([
      255,
      216,
      ...(transform <= 2
        ? segment(0xee, [65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, transform])
        : []),
      ...sos,
      1,
      2,
      255,
      217,
    ]);
    const output = privateMetadataFreeJpeg(input);
    assert.deepEqual(output, expected);
    assert.equal(new TextDecoder().decode(output).includes("GPSXYZ"), false);
    assert.deepEqual(privateMetadataFreeJpeg(output), output);
  }
});
