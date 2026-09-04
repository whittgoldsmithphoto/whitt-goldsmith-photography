import { createFileRoute } from "@tanstack/react-router";
import { catalogResourceRequest } from "@/lib/catalog/resource-http.server";
export const Route = createFileRoute("/api/catalog_/$")({
  server: {
    handlers: {
      GET: ({ request }) => catalogResourceRequest(request),
      POST: ({ request }) => catalogResourceRequest(request),
      PUT: ({ request }) => catalogResourceRequest(request),
      DELETE: ({ request }) => catalogResourceRequest(request),
    },
  },
});
