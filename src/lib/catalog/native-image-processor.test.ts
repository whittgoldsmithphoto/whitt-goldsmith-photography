import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNativeImageProcessor,
  NativeImageProcessorError,
  type NativeImagesBinding,
} from "./native-image-processor.ts";
import { DERIVATIVE_VARIANT_NAMES } from "./media-variants.ts";

const jpeg = new Uint8Array([255, 216, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 255, 217]);

function binding(output: () => Response, info: unknown = { width: 6000, height: 4000 }) {
  const chain = () => ({
    transform() {
      return this;
    },
    draw() {
      return this;
    },
    async output() {
      return { response: output };
    },
  });
  return {
    input: () => chain(),
    info: async () => info,
  } as NativeImagesBinding;
}

async function failureCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NativeImageProcessorError);
    assert.equal(error.code, code);
    return true;
  });
}

test("native processor is unavailable without both binding and watermark", async () => {
  await failureCode(
    createNativeImageProcessor(undefined, async () => jpeg)(jpeg),
    "processor_unavailable",
  );
  await failureCode(
    createNativeImageProcessor(
      binding(() => new Response(jpeg)),
      async () => {
        throw new Error("private storage detail");
      },
    )(jpeg),
    "processor_unavailable",
  );
});

test("native processor rejects malformed dimensions and response contracts", async () => {
  for (const info of [
    null,
    {},
    { width: 0, height: 1 },
    { width: 1.5, height: 2 },
    { width: 100_000, height: 100_000 },
  ])
    await failureCode(
      createNativeImageProcessor(
        binding(() => new Response(jpeg), info),
        async () => jpeg,
      )(jpeg),
      "invalid_output",
    );
  for (const response of [
    () => new Response("failure", { status: 500 }),
    () => new Response(jpeg, { headers: { "content-type": "text/html" } }),
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
  ])
    await failureCode(
      createNativeImageProcessor(binding(response), async () => jpeg)(jpeg),
      "invalid_output",
    );
});

test("native processor rejects declared and streamed oversized outputs", async () => {
  await failureCode(
    createNativeImageProcessor(
      binding(
        () =>
          new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": "11" } }),
      ),
      async () => jpeg,
      { maxDerivativeBytes: 10 },
    )(jpeg),
    "output_too_large",
  );
  await failureCode(
    createNativeImageProcessor(
      binding(() =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(8));
              controller.enqueue(new Uint8Array(8));
              controller.close();
            },
          }),
          { headers: { "content-type": "image/jpeg" } },
        ),
      ),
      async () => jpeg,
      { maxDerivativeBytes: 10 },
    )(jpeg),
    "output_too_large",
  );
});

test("native processor returns exact complete privacy-filtered variant contract", async () => {
  let rendered = 0;
  const outputWithMetadata = new Uint8Array([255, 216, 255, 225, 0, 3, 9, ...jpeg.slice(2)]);
  const process = createNativeImageProcessor(
    binding(() => {
      rendered++;
      return new Response(outputWithMetadata, { headers: { "content-type": "image/jpeg" } });
    }),
    async () => jpeg,
  );
  const result = await process(new Uint8Array([1, 2, 3]));
  assert.equal(result.width, 6000);
  assert.equal(result.height, 4000);
  assert.deepEqual(Object.keys(result.variants), [...DERIVATIVE_VARIANT_NAMES]);
  assert.equal(rendered, DERIVATIVE_VARIANT_NAMES.length);
  for (const bytes of Object.values(result.variants)) assert.deepEqual(bytes, jpeg);
});
