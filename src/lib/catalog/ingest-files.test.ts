import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { collectUploadFiles } from "./ingest-files.ts";

function jpeg(name: string) {
  return new File([new Uint8Array([255, 216, 255, 1])], name, { type: "image/jpeg" });
}

test("keeps jpeg and png files and skips other types", async () => {
  const files = await collectUploadFiles([
    jpeg("a.jpg"),
    new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" }),
    new File([new Uint8Array([137, 80])], "b.png", { type: "image/png" }),
  ]);
  assert.deepEqual(
    files.map((file) => file.name),
    ["a.jpg", "b.png"],
  );
});

test("expands a zip of photographs", async () => {
  const zipped = zipSync({
    "game/SWG01452.jpg": new Uint8Array([255, 216, 255, 1]),
    "game/ignore.txt": new Uint8Array([1, 2, 3]),
  });
  const files = await collectUploadFiles([
    new File([zipped], "game.zip", { type: "application/zip" }),
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "SWG01452.jpg");
  assert.equal(files[0].type, "image/jpeg");
});
