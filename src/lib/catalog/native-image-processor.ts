import type { CatalogMedia } from "./repository.ts";
import {
  DERIVATIVE_VARIANT_NAMES,
  VARIANT_MAX_EDGE,
  type DerivativeVariantName,
} from "./media-variants.ts";
import { privateMetadataFreeJpeg } from "./jpeg-privacy.ts";

export type NativeProcessorErrorCode =
  "processor_unavailable" | "invalid_input" | "invalid_output" | "output_too_large";

export class NativeImageProcessorError extends Error {
  readonly code: NativeProcessorErrorCode;
  constructor(code: NativeProcessorErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "NativeImageProcessorError";
  }
}

export interface NativeImageChain {
  transform(options: Record<string, unknown>): NativeImageChain;
  draw(image: NativeImageChain, options: Record<string, unknown>): NativeImageChain;
  output(options: Record<string, unknown>): Promise<{ response(): Response }>;
}

export interface NativeImagesBinding {
  input(bytes: ReadableStream<Uint8Array>): NativeImageChain;
  info(bytes: ReadableStream<Uint8Array>): Promise<unknown>;
}

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_WATERMARK_BYTES = 5 * 1024 * 1024;
const MAX_DERIVATIVE_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;

function fail(code: NativeProcessorErrorCode, message: string): never {
  throw new NativeImageProcessorError(code, message);
}

function stream(bytes: Uint8Array) {
  return new Response(new Uint8Array(bytes)).body!;
}

function imageDimensions(value: unknown) {
  if (!value || typeof value !== "object") fail("invalid_output", "Processor dimensions missing");
  const { width, height } = value as { width?: unknown; height?: unknown };
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > MAX_PIXELS / (height as number)
  )
    fail("invalid_output", "Processor dimensions are invalid");
  return { width: width as number, height: height as number };
}

async function boundedJpeg(response: Response, limit: number) {
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";", 1)[0].trim() !== "image/jpeg"
  )
    fail("invalid_output", "Processor did not return a JPEG");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) fail("invalid_output", "Processor returned an invalid length");
    if (Number(declared) > limit)
      fail("output_too_large", "Processor output exceeds its byte limit");
  }
  const reader = response.body?.getReader();
  if (!reader) fail("invalid_output", "Processor output body is missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        fail("output_too_large", "Processor output exceeds its byte limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof NativeImageProcessorError) throw error;
    fail("invalid_output", "Processor output could not be read");
  }
  if (!total) fail("invalid_output", "Processor output is empty");
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return privateMetadataFreeJpeg(joined);
  } catch {
    fail("invalid_output", "Processor returned a malformed JPEG");
  }
}

/** Strict adapter around the native image binding. It validates the entire
 * provider contract before catalog code persists any derivative. Provider
 * diagnostics are intentionally replaced by stable, non-sensitive failures. */
export function createNativeImageProcessor(
  images: NativeImagesBinding | undefined,
  loadWatermark: () => Promise<Uint8Array>,
  options: { maxDerivativeBytes?: number } = {},
): CatalogMedia["process"] {
  const maxDerivativeBytes = options.maxDerivativeBytes ?? MAX_DERIVATIVE_BYTES;
  if (
    !Number.isSafeInteger(maxDerivativeBytes) ||
    maxDerivativeBytes < 1 ||
    maxDerivativeBytes > MAX_DERIVATIVE_BYTES
  )
    throw new TypeError("Invalid native processor output limit");
  return async (bytes) => {
    if (!images) fail("processor_unavailable", "Native image processor is unavailable");
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_SOURCE_BYTES)
      fail("invalid_input", "Source image is outside processing limits");
    let watermark: Uint8Array;
    try {
      watermark = await loadWatermark();
    } catch {
      fail("processor_unavailable", "Native image processor watermark is unavailable");
    }
    if (
      !(watermark instanceof Uint8Array) ||
      watermark.length < 1 ||
      watermark.length > MAX_WATERMARK_BYTES
    )
      fail("processor_unavailable", "Native image processor watermark is unavailable");
    try {
      const dimensions = imageDimensions(await images.info(stream(bytes)));
      const entries = await Promise.all(
        DERIVATIVE_VARIANT_NAMES.map(async (name): Promise<[DerivativeVariantName, Uint8Array]> => {
          const edge = VARIANT_MAX_EDGE[name];
          const output = await images
            .input(stream(bytes))
            .transform({ width: edge, height: edge, fit: "scale-down", metadata: "none" })
            .draw(
              images
                .input(stream(watermark))
                .transform({ width: Math.round(edge * 0.5), fit: "scale-down" }),
              { opacity: 0.5 },
            )
            .output({ format: "image/jpeg", quality: 85 });
          if (!output || typeof output.response !== "function")
            fail("invalid_output", "Processor response contract is malformed");
          return [name, await boundedJpeg(output.response(), maxDerivativeBytes)];
        }),
      );
      return {
        ...dimensions,
        variants: Object.fromEntries(entries) as Record<DerivativeVariantName, Uint8Array>,
      };
    } catch (error) {
      if (error instanceof NativeImageProcessorError) throw error;
      fail("invalid_output", "Native image processing failed");
    }
  };
}
