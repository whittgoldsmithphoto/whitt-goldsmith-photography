import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
test("photography palette uses neutral dark surfaces and accessible action blue", () => {
  assert.match(css, /--color-background: #101418/);
  assert.match(css, /--color-primary: #0866e6/i);
  assert.match(css, /color-scheme: dark/);
  assert.doesNotMatch(css, /filter: saturate|#f3ead6|#c94b12/i);
});
test("studio navigation has a desktop rail and preserves mobile controls", () => {
  const shell = readFileSync(
    new URL("../src/components/studio-shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /studio-rail/);
  assert.match(shell, /md:pl-\[184px\]/);
  assert.match(shell, /aria-label="Owner workspace"/);
});

test("file picker snapshots the live FileList before resetting the input", () => {
  const organizer = readFileSync(new URL("../src/components/catalog/organizer.tsx", import.meta.url), "utf8");
  assert.match(organizer, /const list = Array\.from\(event\.target\.files \?\? \[\]\);\s*event\.target\.value = "";/);
});
