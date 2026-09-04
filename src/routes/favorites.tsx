import { createFileRoute } from "@tanstack/react-router";
import { RequireOwner } from "@/components/require-owner";
import { ProofInbox } from "@/components/catalog/proof-inbox";

export const Route = createFileRoute("/favorites")({
  component: () => (
    <RequireOwner>
      <ProofInbox />
    </RequireOwner>
  ),
});
