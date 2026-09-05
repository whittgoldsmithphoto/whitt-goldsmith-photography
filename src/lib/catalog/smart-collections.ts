import { z } from "zod";
import type { Sql } from "../db.ts";
import { libraryRules } from "./library-metadata.ts";
import { CatalogError } from "./errors.ts";
export interface SmartCollection {
  id: string;
  title: string;
  rules: z.infer<typeof libraryRules>;
  revision: number;
}
const input = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(120),
    rules: libraryRules,
  })
  .strict()
  .refine((value) => Boolean(value.id) === Boolean(value.revision));
export function createSmartCollections(sql: Sql) {
  return {
    async list(actor: string, after = "") {
      return sql.query<SmartCollection>(
        `select id,title,rules,revision from catalog_smart_collections where owner_id=$1 and id>$2 order by id limit 100`,
        [actor, after],
      );
    },
    async save(raw: unknown, actor: string) {
      if (!actor) throw new CatalogError("Owner identity required", 401);
      const value = input.parse(raw);
      if (value.id) {
        const [row] = await sql.query<SmartCollection>(
          `update catalog_smart_collections set title=$3,rules=$4::jsonb,revision=revision+1,updated_at=now()
          where id=$1 and owner_id=$2 and revision=$5 returning id,title,rules,revision`,
          [value.id, actor, value.title, JSON.stringify(value.rules), value.revision],
        );
        if (!row)
          throw new CatalogError("Collection changed or unavailable; refresh before saving", 409);
        return row;
      }
      const [row] = await sql.query<SmartCollection>(
        `insert into catalog_smart_collections(id,owner_id,title,rules) values($1,$2,$3,$4::jsonb) returning id,title,rules,revision`,
        [crypto.randomUUID(), actor, value.title, JSON.stringify(value.rules)],
      );
      return row;
    },
  };
}
