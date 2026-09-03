import type { Folder, Gallery, Photo } from "./types";

export type TreeNode =
  | { kind: "folder"; id: string; parentId: string | null; title: string; position: number }
  | { kind: "gallery"; id: string; parentId: string | null; title: string; position: number };

export function asTree(folders: Folder[], galleries: Gallery[]): TreeNode[] {
  return [
    ...folders.map((f) => ({
      kind: "folder" as const,
      id: f.id,
      parentId: f.parentId,
      title: f.title,
      position: f.position,
    })),
    ...galleries.map((g) => ({
      kind: "gallery" as const,
      id: g.id,
      parentId: g.parentId,
      title: g.title,
      position: g.position,
    })),
  ];
}

export function childrenOf(nodes: TreeNode[], parentId: string | null) {
  return nodes
    .filter((n) => n.parentId === parentId)
    .slice()
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.position - b.position || a.title.localeCompare(b.title);
    });
}

export function breadcrumbs(folders: Folder[], galleries: Gallery[], id: string | null) {
  const trail: { id: string; title: string; kind: "folder" | "gallery" }[] = [];
  let cursor: string | null = id;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const folder = folders.find((f) => f.id === cursor);
    if (folder) {
      trail.unshift({ id: folder.id, title: folder.title, kind: "folder" });
      cursor = folder.parentId;
      continue;
    }
    const gallery = galleries.find((g) => g.id === cursor);
    if (gallery) {
      trail.unshift({ id: gallery.id, title: gallery.title, kind: "gallery" });
      cursor = gallery.parentId;
      continue;
    }
    break;
  }
  return trail;
}

export function descendantFolderIds(folders: Folder[], id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const f of folders) {
      if (f.parentId === pid) {
        out.push(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return out;
}

export function canMoveNode(
  folders: Folder[],
  nodeId: string,
  kind: "folder" | "gallery",
  destFolderId: string | null,
) {
  if (kind === "gallery") return destFolderId === null || folders.some((f) => f.id === destFolderId);
  if (destFolderId === nodeId) return false;
  if (destFolderId && descendantFolderIds(folders, nodeId).includes(destFolderId)) return false;
  return destFolderId === null || folders.some((f) => f.id === destFolderId);
}

export function folderPhotoCount(
  folderId: string,
  folders: Folder[],
  galleries: Gallery[],
  photos: Photo[],
) {
  const ids = new Set([folderId, ...descendantFolderIds(folders, folderId)]);
  const galleryIds = new Set(
    galleries.filter((g) => g.parentId && ids.has(g.parentId)).map((g) => g.id),
  );
  return photos.filter((p) => !p.archived && galleryIds.has(p.galleryId)).length;
}

export function folderHasPublicContent(
  folderId: string,
  folders: Folder[],
  galleries: Gallery[],
) {
  const ids = new Set([folderId, ...descendantFolderIds(folders, folderId)]);
  return galleries.some(
    (g) => g.privacy === "public" && g.parentId && ids.has(g.parentId),
  );
}
