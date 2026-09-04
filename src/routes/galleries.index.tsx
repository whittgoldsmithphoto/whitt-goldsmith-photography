import { createFileRoute } from "@tanstack/react-router";
import { CatalogIndex } from "@/components/catalog/public";
import { SportsSearch } from "@/lib/sports/SportsSearch";
export const Route = createFileRoute("/galleries/")({
  component: () => (
    <>
      <CatalogIndex page="galleries" />
      <SportsSearch />
    </>
  ),
});
