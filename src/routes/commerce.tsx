import { createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";
import { CommercePricing } from "@/components/catalog-commerce/pricing";

export const Route = createFileRoute("/commerce")({
  component: () => (
    <RequireOwner>
      <CommercePricing />
    </RequireOwner>
  ),
});
