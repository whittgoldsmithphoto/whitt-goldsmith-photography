import { createFileRoute } from "@tanstack/react-router";
import { Organizer } from "@/components/organizer/organizer";
import { RequireOwner } from "@/components/require-owner";

export const Route = createFileRoute("/organize")({
  component: () => (
    <RequireOwner>
      <Organizer />
    </RequireOwner>
  ),
});
