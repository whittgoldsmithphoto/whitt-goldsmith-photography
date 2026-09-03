import { Outlet, createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";

export const Route = createFileRoute("/keywords")({
  component: () => (
    <RequireOwner>
      <Outlet />
    </RequireOwner>
  ),
});
