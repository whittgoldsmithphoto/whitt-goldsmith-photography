import { createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";
import { CommercePricing } from "@/components/catalog-commerce/pricing";

// The prior browser-local product/coupon editor is retained in Git history.
// This route now writes only to the authenticated server-backed commerce domain.
export const Route = createFileRoute("/sell")({
  component: () => (
    <RequireOwner>
      <CommercePricing />
    </RequireOwner>
  ),
});
