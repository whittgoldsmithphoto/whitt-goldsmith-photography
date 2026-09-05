import { createFileRoute } from "@tanstack/react-router";
import { archiveRequest } from "@/lib/catalog-commerce/archive.server";

export const Route = createFileRoute("/api/commerce-archive")({
  server: { handlers: { POST: ({ request }) => archiveRequest(request) } },
});
