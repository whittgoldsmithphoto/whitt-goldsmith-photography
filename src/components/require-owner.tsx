import type { ReactNode } from "react";
import { RedirectToSignIn, SignedIn, SignedOut } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useCatalog } from "@/lib/catalog/client";
import { CatalogStatus } from "@/components/catalog/public";

function VerifiedOwner({ children }: { children: ReactNode }) {
  const status = useCatalog("op=owner");
  if (!status.data) return <CatalogStatus {...status} />;
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  const { isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24">
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="mt-4 h-4 w-64 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }
  return (
    <>
      <SignedIn>
        <VerifiedOwner>{children}</VerifiedOwner>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
