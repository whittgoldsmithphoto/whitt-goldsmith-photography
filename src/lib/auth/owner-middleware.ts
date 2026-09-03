import { createMiddleware } from "@tanstack/react-start";
import { authMiddleware } from "./middleware";

export const ownerMiddleware = createMiddleware({ type: "function" })
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    const { assertCatalogOwner } = await import("../catalog/owner");
    const { runtimeSetting } = await import("../catalog/media.server");
    assertCatalogOwner(context.userId, runtimeSetting("OWNER_USER_IDS"));
    return next({ context });
  });
