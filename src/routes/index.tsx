import { createFileRoute } from "@tanstack/react-router";
import { CatalogIndex } from "@/components/catalog/public";
export const Route = createFileRoute("/")({ component: () => <CatalogIndex page="home" /> });
