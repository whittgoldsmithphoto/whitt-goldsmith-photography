/** Remove metadata from encoded preview bytes, never from archival originals.
 * Keep only a canonical Adobe color-transform (APP14) application segment.
 * The image renderer must normalize color first; arbitrary ICC/FlashPix APP2
 * payloads can carry private tags and are not allowed in customer previews.
 * EXIF/XMP/IPTC/comments/C2PA/embedded thumbnails and bytes after EOI are excluded.
 * Entropy-coded data is copied byte-for-byte, including progressive scans.
 */
export function privateMetadataFreeJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Preview is not JPEG");
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let cursor = 2;
  let scanning = false;
  let sawScan = false;
  while (cursor < bytes.length) {
    if (scanning) {
      const start = cursor;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor++;
          continue;
        }
        let end = cursor + 1;
        while (bytes[end] === 0xff) end++;
        const marker = bytes[end];
        if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) {
          cursor = end + 1;
          continue;
        }
        break;
      }
      chunks.push(bytes.subarray(start, cursor));
      scanning = false;
    }
    const start = cursor;
    if (bytes[cursor++] !== 0xff) throw new Error("Malformed JPEG preview");
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd9) {
      if (!sawScan) throw new Error("JPEG preview has no image scan");
      chunks.push(new Uint8Array([0xff, 0xd9]));
      const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    }
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      throw new Error("Unexpected JPEG marker");
    if (marker === 1) {
      chunks.push(bytes.subarray(start, cursor));
      continue;
    }
    if (cursor + 2 > bytes.length) throw new Error("Truncated JPEG segment");
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length)
      throw new Error("Invalid JPEG segment length");
    const adobeColorTransform =
      marker === 0xee &&
      length === 14 &&
      [65, 100, 111, 98, 101].every((byte, index) => bytes[cursor + 2 + index] === byte) &&
      bytes[cursor + 13] <= 2;
    if (adobeColorTransform) {
      // Version and reserved flags are not image data. Normalize rather than
      // carrying arbitrary bytes through the sole retained application segment.
      chunks.push(
        new Uint8Array([
          255,
          238,
          0,
          14,
          65,
          100,
          111,
          98,
          101,
          0,
          100,
          0,
          0,
          0,
          0,
          bytes[cursor + 13],
        ]),
      );
    }
    const metadata = marker === 0xfe || (marker >= 0xe0 && marker <= 0xef);
    cursor += length;
    if (!metadata) chunks.push(bytes.subarray(start, cursor));
    if (marker === 0xda) {
      scanning = true;
      sawScan = true;
    }
  }
  throw new Error("JPEG preview has no end marker");
}
