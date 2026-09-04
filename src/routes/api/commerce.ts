import { createFileRoute } from "@tanstack/react-router";
import { commerceRequest } from "@/lib/catalog-commerce/http.server";

export const Route = createFileRoute("/api/commerce")({
  server: {
    handlers: {
      GET: ({ request }) => commerceRequest(request),
      POST: ({ request }) => commerceRequest(request),
    },
  },
});
