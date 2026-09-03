import { createFileRoute } from "@tanstack/react-router";
import { CatalogIndex } from "@/components/catalog/public";
export const Route = createFileRoute("/about")({ component: () => <CatalogIndex page="about" /> });
