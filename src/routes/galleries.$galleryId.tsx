import { createFileRoute } from "@tanstack/react-router";
import { CatalogGalleryPage } from "@/components/catalog/public";
export const Route = createFileRoute("/galleries/$galleryId")({ component: Gallery });
function Gallery() {
  const { galleryId } = Route.useParams();
  return <CatalogGalleryPage key={galleryId} id={galleryId} />;
}
