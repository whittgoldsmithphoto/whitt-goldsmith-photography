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

  const name = studio.name.replace(/ photography$/i, "");

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("min-h-svh bg-background text-foreground", inStudio && "management-shell")}>
        <a
          href="#main-content"
          className="fixed left-4 top-2 z-[100] -translate-y-24 bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
        >
          Skip to content
        </a>
        <header className="fixed inset-x-0 top-0 z-40 border-b border-foreground/15 bg-background">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
            <Link to="/" className="min-w-0">
              <span className="masthead block text-[1.35rem] sm:text-[1.65rem]">{name}</span>
              <span className="lede hidden text-[0.95rem] text-foreground/80 sm:block">
                Photography
              </span>
            </Link>

            <nav
              aria-label={inStudio ? "Studio shortcuts" : "Main navigation"}
              className="hidden items-center gap-5 md:flex"
            >
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "kicker inline-flex h-12 items-center",
                    active(item.to) ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active(item.to) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
              {isOwner && (
                <Link
                  to={inStudio ? "/galleries" : "/organize"}
                  className="kicker inline-flex h-12 items-center text-muted-foreground hover:text-foreground"
                >
                  {inStudio ? "View site" : "Studio"}
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
                    <SheetTitle className="masthead text-3xl normal-case tracking-normal">
                      {name}
                    </SheetTitle>
                  </SheetHeader>
                  <nav
                    aria-label={inStudio ? "Owner workspace" : "Main navigation"}
                    className="mt-8 flex flex-col gap-1"
                  >
                    {(inStudio ? [...STUDIO_NAV, { to: "/galleries" as const, label: "View site" }] : PUBLIC_NAV).map(
                      (item) => (
                        <SheetClose key={item.to} asChild>
                          <Link
                            to={item.to}
                            aria-current={active(item.to) ? "page" : undefined}
                            className={cn(
                              "flex min-h-12 items-center px-1 text-lg",
                              active(item.to) && "font-semibold",
                            )}
                          >
                            {item.label}
                          </Link>
                        </SheetClose>
                      ),
                    )}
                    {isOwner && !inStudio && (
                      <SheetClose asChild>
                        <Link to="/organize" className="mt-4 flex min-h-12 items-center border-t px-1">
                          Studio
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

        <main
          id="main-content"
          tabIndex={-1}
          className={cn("pt-14 sm:pt-16", inStudio && "owner-workspace pb-[4.75rem] md:pb-0")}
        >
          {legacyPage && (
            <SignedIn>
              <div
                role="note"
                className="mx-auto mt-6 max-w-[1400px] border border-border p-4 text-sm text-muted-foreground"
              >
                This page still includes tools from the previous local workspace. Use Organizer for
                saved galleries and uploads.
              </div>
            </SignedIn>
          )}
          {legacyPage ? (
            <section className="mx-auto max-w-3xl px-6 py-20">
              <h1>Legacy tools are disabled</h1>
              <p className="mt-4 font-sans text-base font-normal normal-case tracking-normal">
                These tools do not update the shared server catalog. Use Organizer or Selling.
              </p>
              <Link to="/organize" className="mt-6 inline-block underline">
                Open Organizer
              </Link>
            </section>
          ) : (
            children
          )}
        </main>

        {inStudio && (
          <nav
            aria-label="Owner workspace"
            className="desk-tabs fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-foreground/15 bg-background md:hidden"
          >
            {STUDIO_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active(item.to) ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.12em]",
                  active(item.to) ? "text-primary" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        {pathname === "/login" || ownerPage ? null : <SiteFooter />}

        <Toaster
          theme="light"
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
