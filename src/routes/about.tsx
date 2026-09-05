import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "@/components/catalog/public";
export const Route = createFileRoute("/about")({ component: AboutPage });
