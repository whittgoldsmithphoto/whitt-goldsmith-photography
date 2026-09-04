import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Toaster } from "sonner";
import { catalogFetch } from "@/lib/catalog/client";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SignedIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useStudioStore } from "@/lib/store";
import { defaultStudio } from "@/lib/seed";
import { cn } from "@/lib/utils";

const PUBLIC_NAV = [
  { to: "/galleries" as const, label: "Find your photos" },
  { to: "/about" as const, label: "About" },
];

const STUDIO_NAV = [
  { to: "/organize" as const, label: "Organizer" },
  { to: "/favorites" as const, label: "Proofs" },
  { to: "/sell" as const, label: "Selling" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const legacyPage = ["/keywords", "/migrate", "/settings", "/publish", "/orders"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const studio = defaultStudio;
  const persist = useStudioStore.persist;
  const setHydrated = useStudioStore((s) => s.setHydrated);
  const { user } = useCurrentUserState();
  const userId = user?.id;
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOwnerUserId(null);
    if (userId)
      catalogFetch<{ isOwner: boolean }>("op=capabilities")
        .then((result) => {
          if (!cancelled && result.isOwner) setOwnerUserId(userId);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const isOwner = Boolean(user && ownerUserId === user.id);
  const ownerPage = [
    "/organize",
    "/upload",
    "/library",
    "/favorites",
    "/sell",
    "/commerce",
  ].includes(pathname);
  const inStudio = isOwner && ownerPage;
  const nav = inStudio ? STUDIO_NAV : PUBLIC_NAV;
  const active = (to: string) =>
    pathname === to ||
    pathname.startsWith(`${to}/`) ||
    (to === "/organize" && ["/upload", "/library"].includes(pathname)) ||
    (to === "/sell" && pathname === "/commerce");

  useEffect(() => {
    const finish = () => setHydrated(true);
    if (persist.hasHydrated()) finish();
    const unsub = persist.onFinishHydration(finish);
    persist.rehydrate();
    return unsub;
  }, [persist, setHydrated]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-svh bg-background text-foreground">
        <a
          href="#main-content"
          className="fixed left-4 top-2 z-[100] -translate-y-24 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
        >
          Skip to content
        </a>
        <header className="fixed inset-x-0 top-0 z-40 border-b bg-background">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
            <Link to="/" className="min-w-0">
              <span className="block max-w-[13rem] text-sm font-semibold leading-tight sm:max-w-none sm:text-base">
                {studio.name}
              </span>
            </Link>

            <nav
              aria-label={inStudio ? "Studio shortcuts" : "Main navigation"}
              className="hidden items-center gap-1 md:flex"
            >
              {!inStudio &&
                nav.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "inline-flex h-12 items-center border-b-2 px-3 text-sm transition-colors",
                      active(item.to)
                        ? "border-primary font-semibold text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={active(item.to) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              {isOwner && (
                <Link
                  to={inStudio ? "/galleries" : "/organize"}
                  className="inline-flex h-12 items-center px-4 text-sm text-muted-foreground hover:text-foreground"
                >
                  {inStudio ? "View site" : "Owner studio"}
                </Link>
              )}
              <SignedIn>
                <UserButton />
              </SignedIn>
            </nav>

            <div className="flex items-center gap-1 md:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open menu">
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{studio.name}</SheetTitle>
                  </SheetHeader>
                  <nav
                    aria-label={inStudio ? "Owner workspace" : "Main navigation"}
                    className="mt-8 flex flex-col gap-1"
                  >
                    {nav.map((item) => (
                      <SheetClose key={item.to} asChild>
                        <Link
                          to={item.to}
                          aria-current={active(item.to) ? "page" : undefined}
                          className={cn(
                            "flex h-12 items-center rounded-md px-3 text-base text-foreground",
                            active(item.to) && "bg-accent font-semibold",
                          )}
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    ))}
                    {isOwner && (
                      <SheetClose asChild>
                        <Link
                          to={inStudio ? "/galleries" : "/organize"}
                          className="mt-4 flex h-12 items-center border-t px-3 text-muted-foreground"
                        >
                          {inStudio ? "View site" : "Owner studio"}
                        </Link>
                      </SheetClose>
                    )}
                  </nav>
                  <SignedIn>
                    <div className="mt-auto pt-6">
                      <UserButton />
                    </div>
                  </SignedIn>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        {inStudio && (
          <aside className="fixed bottom-0 left-0 top-16 hidden w-48 border-r bg-card px-3 py-8 md:block">
            <p className="mb-5 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Owner studio
            </p>
            <nav aria-label="Owner workspace" className="space-y-1">
              {STUDIO_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active(item.to) ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center rounded-md border-l-2 px-3 text-sm",
                    active(item.to)
                      ? "border-primary bg-accent font-semibold"
                      : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn("pt-16", inStudio && "owner-workspace md:pl-48")}
        >
          {legacyPage && (
            <SignedIn>
              <div
                role="note"
                className="mx-auto mt-6 max-w-[1400px] rounded-lg border border-border p-4 text-sm text-muted-foreground"
              >
                This page still includes tools from the previous local workspace. Its photo, proof,
                and pricing controls do not edit the shared catalog yet. Use Organizer for saved
                galleries and uploads.
              </div>
            </SignedIn>
          )}
          {legacyPage ? (
            <section className="mx-auto max-w-3xl px-6 py-20">
              <h1 className="text-2xl">Legacy tools are disabled</h1>
              <p className="mt-4">
                These tools do not update the shared server catalog. No changes have been made. Use
                Organizer or Selling for the current server-backed tools.
              </p>
              <Link to="/organize">Open Organizer</Link>
            </section>
          ) : (
            children
          )}
        </main>
        {pathname === "/login" || ownerPage ? null : <SiteFooter />}

        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: "font-sans",
            style: {
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              color: "var(--color-foreground)",
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
}
