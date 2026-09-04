import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CheckoutResultPage } from "@/components/catalog/commerce-customer";
export const Route = createFileRoute("/checkout_/complete")({
  validateSearch: z.object({ orderId: z.string().uuid().optional().catch(undefined) }),
  component: Result,
});
function Result() {
  return <CheckoutResultPage orderId={Route.useSearch().orderId} />;
}
