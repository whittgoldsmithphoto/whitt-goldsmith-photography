import { createFileRoute } from "@tanstack/react-router";
import { catalogRequest } from "@/lib/catalog/http.server";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: ({ request }) => catalogRequest(request),
      POST: ({ request }) => catalogRequest(request),
    },
  },
});
