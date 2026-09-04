/** Attach preview credentials only to same-origin API requests, never external URLs. */
export function apiFetch(input: string, init: RequestInit = {}) {
  if (!input.startsWith("/api/") || input.startsWith("//"))
    throw new Error("Same-origin API path required");
  const headers = new Headers(init.headers);
  try {
    const token =
      typeof window === "undefined"
        ? null
        : window.sessionStorage.getItem("grok-auth.bearer-token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    /* Cookie authentication still works when browser storage is unavailable. */
  }
  return fetch(input, { ...init, credentials: "same-origin", headers });
}
