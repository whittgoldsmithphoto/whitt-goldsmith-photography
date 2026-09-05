import type { GalleryInput } from "./types.ts";

/** Explicit allowlist: copying appearance must never grant access or copy event identity. */
export function copyGalleryPresentation(
  draft: GalleryInput,
  source: Pick<GalleryInput, "layout" | "customerInstructions">,
): GalleryInput {
  return {
    ...draft,
    layout: source.layout ?? "compact",
    customerInstructions: source.customerInstructions ?? "",
  };
}
