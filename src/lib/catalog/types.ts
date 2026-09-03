export type CatalogGallery = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  category: string;
  visibility: "private" | "public" | "unlisted";
  published: boolean;
  requiresPassword: boolean;
  revision: number;
  updatedAt: string;
};
export type CatalogPhoto = {
  id: string;
  galleryId: string;
  filename: string;
  width: number;
  height: number;
  src: string;
  thumbSrc: string;
  caption: string;
};
export type OwnerCatalogPhoto = CatalogPhoto & {
  hidden: boolean;
  archived: boolean;
  displayOrder: number;
  revision: number;
};
export type PhotoInput = {
  id: string;
  revision: number;
  caption: string;
  hidden: boolean;
  archived: boolean;
  displayOrder: number;
};
export type CatalogFolder = { id: string; parentId: string | null; title: string };
export type PublicCatalog = {
  galleries: CatalogGallery[];
  photos: CatalogPhoto[];
  folders: CatalogFolder[];
};
export type OwnerCatalog = Omit<PublicCatalog, "photos"> & {
  photos: OwnerCatalogPhoto[];
  jobs: {
    id: string;
    galleryId: string;
    filename: string;
    status: string;
    error: string | null;
    updatedAt: string;
    checksum: string;
    bytes: number;
  }[];
};
export type GalleryInput = {
  id?: string;
  revision?: number;
  title: string;
  description: string;
  category: string;
  folderId: string | null;
  visibility: CatalogGallery["visibility"];
  published: boolean;
  password?: string;
  revokeAccess?: boolean;
};
export type ReservationInput = {
  galleryId: string;
  filename: string;
  mime: string;
  bytes: number;
  checksum: string;
};
