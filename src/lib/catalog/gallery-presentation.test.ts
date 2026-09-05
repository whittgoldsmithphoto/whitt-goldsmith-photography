import { test } from "node:test";
import assert from "node:assert/strict";
import type { GalleryInput } from "./types.ts";
import { copyGalleryPresentation } from "./gallery-presentation.ts";

test("reusing presentation never copies publication, passwords, identity or download authority", () => {
  const draft: GalleryInput = {
    id: "target",
    revision: 7,
    title: "New event",
    description: "",
    category: "Football",
    folderId: null,
    visibility: "private",
    published: false,
    password: "keep-this-password",
    downloadPolicy: "none",
  };
  const source = {
    ...draft,
    id: "source",
    revision: 42,
    title: "Old event",
    description: "Do not copy event-specific copy",
    customerInstructions: "Select favorites",
    layout: "comfortable" as const,
    published: true,
    visibility: "public" as const,
    password: "never-copy",
    downloadPolicy: "purchased_only" as const,
  };
  assert.deepEqual(copyGalleryPresentation(draft, source), {
    ...draft,
    customerInstructions: "Select favorites",
    layout: "comfortable",
  });
  assert.equal(draft.description, "");
  assert.equal(copyGalleryPresentation(draft, { customerInstructions: "" }).layout, "compact");
});
