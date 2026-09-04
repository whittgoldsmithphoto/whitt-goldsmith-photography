import { z } from "zod";
import type { Sql } from "../db.ts";
import { CatalogError } from "./errors.ts";

export type ManagedFolder = {
  id: string;
  parentId: string | null;
  title: string;
  revision: number;
  depth: number;
  path: string[];
};
export type FolderTree = { folders: ManagedFolder[] };
const input = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().min(1).max(2147483646).optional(),
    title: z.string().trim().min(1).max(180),
    parentId: z.string().uuid().nullable(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.id) === Boolean(value.revision),
    "Existing folder and revision are required together",
  );
type FolderRow = { id: string; parent_id: string | null; title: string; revision: number };
const safeErrors = new Set([
  "Invalid folder input",
  "Folder already exists",
  "Folder unavailable",
  "Folder changed. Reload before saving",
  "Parent folder unavailable",
  "A folder cannot be moved into itself or a descendant",
  "Folder hierarchy needs repair",
  "Folders can be nested at most 8 levels",
  "Folder manager supports up to 5000 folders",
]);
export function createFolderService(sql: Sql) {
  return {
    async folderTree(): Promise<FolderTree> {
      const result = await sql.query<
        FolderRow & { depth: number; path: string[]; total_count: number }
      >(`WITH RECURSIVE tree AS (
        SELECT f.*,1 AS depth,ARRAY[f.title] AS path,ARRAY[f.id] AS visited FROM catalog_folders f WHERE parent_id IS NULL
        UNION ALL
        SELECT f.*,t.depth+1,t.path||f.title,t.visited||f.id FROM tree t JOIN catalog_folders f ON f.parent_id=t.id
          WHERE t.depth<8 AND NOT f.id=ANY(t.visited)
      ) SELECT tree.id,tree.parent_id,tree.title,tree.revision,tree.depth,tree.path,totals.total_count
        FROM (SELECT count(*)::integer AS total_count FROM catalog_folders) totals LEFT JOIN tree ON true
        ORDER BY tree.path,tree.id LIMIT 5001`);
      const rows = result.filter((row) => row.id);
      const total = result[0]?.total_count ?? 0;
      if (total > 5000)
        throw new CatalogError(
          "Folder manager supports up to 5000 folders; contact the owner for an archive review",
          409,
        );
      if (rows.length !== total)
        throw new CatalogError("Folder hierarchy needs repair; no folders have been changed", 409);
      return {
        folders: rows.map((row) => ({
          id: row.id,
          parentId: row.parent_id,
          title: row.title,
          revision: row.revision,
          depth: row.depth,
          path: row.path,
        })),
      };
    },
    async saveFolder(raw: unknown, owner: string) {
      const data = input.parse(raw);
      if (!owner || owner === "dev-user") throw new CatalogError("Owner sign-in required", 401);
      try {
        const [row] = await sql.query<FolderRow>(
          `SELECT * FROM catalog_save_folder($1,$2,$3,$4,$5)`,
          [data.id ?? crypto.randomUUID(), data.revision ?? 0, data.title, data.parentId, owner],
        );
        return { id: row.id, parentId: row.parent_id, title: row.title, revision: row.revision };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (safeErrors.has(message))
          throw new CatalogError(message, message.includes("changed") ? 409 : 400);
        throw error;
      }
    },
  };
}
