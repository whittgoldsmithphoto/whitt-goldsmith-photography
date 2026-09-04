import { createFileRoute } from "@tanstack/react-router";
import { integrityRequest } from "@/lib/catalog-integrity/http.server";
export const Route = createFileRoute("/api/catalog-integrity")({
  server: { handlers: { POST: ({ request }) => integrityRequest(request) } },
});
