import { ZodError } from "zod";
import { CatalogError } from "../catalog/errors.ts";
import type { ApiError } from "./contracts.ts";
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function errorResponse(error: unknown) {
  const status =
    error instanceof CatalogError ? error.status : error instanceof ZodError ? 400 : 500;
  const codes: Record<number, string> = {
    400: "INVALID_REQUEST",
    401: "AUTHENTICATION_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    429: "RATE_LIMITED",
    503: "UNAVAILABLE",
  };
  const requestId = crypto.randomUUID();
  const body: ApiError = {
    error: {
      code: codes[status] || "INTERNAL_ERROR",
      message:
        error instanceof CatalogError
          ? error.message
          : status === 400
            ? "Invalid request"
            : "Request could not be completed",
      requestId,
    },
  };
  return Response.json(body, {
    status,
    headers: {
      ...privateHeaders,
      "X-Request-ID": requestId,
      ...(status === 405 ? { Allow: "GET" } : {}),
    },
  });
}
