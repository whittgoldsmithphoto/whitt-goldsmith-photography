import { createFileRoute } from "@tanstack/react-router";
import { CatalogIndex } from "@/components/catalog/public";
export const Route = createFileRoute("/galleries/")({
  component: () => <CatalogIndex page="galleries" />,
});
