import { createFileRoute } from "@tanstack/react-router";
import { CatalogOrganizer } from "@/components/catalog/organizer";
import { RequireOwner } from "@/components/require-owner";
export const Route = createFileRoute("/library")({
  component: () => (
    <RequireOwner>
      <CatalogOrganizer />
    </RequireOwner>
  ),
});
