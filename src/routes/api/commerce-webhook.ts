import { createFileRoute } from "@tanstack/react-router";
import { catalogStripeWebhook } from "@/lib/catalog-commerce/stripe-webhook.server";

export const Route = createFileRoute("/api/commerce-webhook")({
  server: { handlers: { POST: ({ request }) => catalogStripeWebhook(request) } },
});
