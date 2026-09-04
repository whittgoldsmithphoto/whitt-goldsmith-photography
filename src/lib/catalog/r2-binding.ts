import { digest } from "./repository.ts";

export interface CatalogR2Binding {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    bytes: Uint8Array,
    options: {
      onlyIf?: Headers;
      httpMetadata: { contentType: string };
      sha256: string;
    },
  ): Promise<unknown | null>;
}

export function bindingStorage(bucket: CatalogR2Binding) {
  async function get(key: string) {
    const object = await bucket.get(key);
    if (!object) throw new Error("Object missing");
    return new Uint8Array(await object.arrayBuffer());
  }
  return {
    get,
    async putOriginal(key: string, bytes: Uint8Array, mime: string) {
      const checksum = await digest(bytes);
      try {
        const result = await bucket.put(key, bytes, {
          onlyIf: new Headers({ "If-None-Match": "*" }),
          httpMetadata: { contentType: mime },
          sha256: checksum,
        });
        if (result === null) throw new Error("Original already exists");
      } catch (error) {
        // A retry can accept only the exact existing bytes. Never overwrite the
        // key, and never fall back to another bucket after a binding error.
        if ((await digest(await get(key))) !== checksum) throw error;
      }
    },
    async putDerivative(key: string, bytes: Uint8Array) {
      const result = await bucket.put(key, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
        sha256: await digest(bytes),
      });
      if (result === null) throw new Error("Derivative write failed");
    },
  };
}
