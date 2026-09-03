import { createFileRoute } from "@tanstack/react-router";
import { CatalogIndex } from "@/components/catalog/public";
export const Route = createFileRoute("/folders/$folderId")({ component: Folder });
function Folder() {
  const { folderId } = Route.useParams();
  return <CatalogIndex page="galleries" folderId={folderId} />;
}
