import { test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch } from "./api-fetch.ts";
test("API helper forwards preview bearer only to same-origin paths and preserves request headers", async () => {
  const originalFetch = globalThis.fetch;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: { getItem: () => "fixture-token" } },
  });
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/catalog?op=owner");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-token");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(init?.credentials, "same-origin");
    return Response.json({ ok: true });
  };
  try {
    await apiFetch("/api/catalog?op=owner", { headers: { "Content-Type": "application/json" } });
    assert.throws(() => apiFetch("https://example.com/api/catalog"), /Same-origin/);
    assert.throws(() => apiFetch("//example.com/api/catalog"), /Same-origin/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
