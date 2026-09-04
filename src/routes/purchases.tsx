import { createFileRoute } from "@tanstack/react-router";
import { PurchasesPage } from "@/components/catalog/commerce-customer";
export const Route = createFileRoute("/purchases")({ component: PurchasesPage });
