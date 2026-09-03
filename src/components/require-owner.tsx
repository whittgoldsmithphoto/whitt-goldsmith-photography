import type { ReactNode } from "react";
import { RedirectToSignIn, SignedIn, SignedOut } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

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
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
