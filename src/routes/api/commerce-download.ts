import { createFileRoute } from "@tanstack/react-router";
import { customerDownloadRequest } from "@/lib/catalog-commerce/customer-download.server";

export const Route = createFileRoute("/api/commerce-download")({
  server: { handlers: { POST: ({ request }) => customerDownloadRequest(request) } },
});
