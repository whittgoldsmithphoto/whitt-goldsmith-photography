export type CatalogGallery = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  customerInstructions: string;
  downloadPolicy: "none" | "purchased_only";
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
  updatedAt: string;
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
    processingStatus: string | null;
    processingStage: string | null;
    progressPercent: number;
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
  customerInstructions?: string;
  downloadPolicy?: CatalogGallery["downloadPolicy"];
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
  idempotencyKey?: string;
};
export type ProofSelection = {
  id: string | null;
  galleryId: string;
  photoIds: string[];
  note: string;
  revision: number;
  updatedAt: string | null;
  unavailableCount: number;
};
export type ProofInput = {
  galleryId: string;
  photoIds: string[];
  note: string;
  revision: number;
};
export type OwnerProof = ProofSelection & {
  id: string;
  galleryTitle: string;
  reviewedRevision: number;
  customerName?: string;
  customerEmail?: string;
  photos: { id: string; filename: string; thumbSrc: string; unavailable: boolean }[];
};
