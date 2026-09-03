import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Toaster } from "sonner";
import { CartButton } from "@/components/shop/cart-button";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SignedIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useStudioStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const PUBLIC_NAV = [
  { to: "/galleries" as const, label: "Galleries" },
  { to: "/about" as const, label: "About" },
];

const STUDIO_NAV = [
  { to: "/organize" as const, label: "Organizer" },
  { to: "/upload" as const, label: "Upload" },
  { to: "/library" as const, label: "Library" },
  { to: "/favorites" as const, label: "Proofs" },
  { to: "/keywords" as const, label: "Keywords" },
  { to: "/sell" as const, label: "Selling" },
  { to: "/migrate" as const, label: "Migrate" },
  { to: "/publish" as const, label: "Publish" },
  { to: "/settings" as const, label: "Settings" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const overlay = pathname === "/";
  const studio = useStudioStore((s) => s.studio);
  const persist = useStudioStore.persist;
  const hydrated = useStudioStore((s) => s.hydrated);
  const setHydrated = useStudioStore((s) => s.setHydrated);
  const { user } = useCurrentUserState();
  const [scrolled, setScrolled] = useState(false);
  const nav = user ? [...PUBLIC_NAV, ...STUDIO_NAV] : PUBLIC_NAV;

  useEffect(() => {
    const finish = () => setHydrated(true);
    if (persist.hasHydrated()) finish();
    const unsub = persist.onFinishHydration(finish);
    persist.rehydrate();
    return unsub;
  }, [persist, setHydrated]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-svh bg-background text-foreground">
        <header
          className={cn(
            "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow] duration-200",
            overlay && !scrolled
              ? "bg-transparent"
              : "bg-background/92 shadow-[0_1px_0_0_var(--color-border)]",
          )}
        >
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
            <Link to="/" className="min-w-0">
              <span className="font-display block max-w-[11.5rem] truncate text-[0.95rem] uppercase leading-[1.05] tracking-[0.12em] sm:max-w-none sm:text-[1.2rem] sm:leading-none">
                {studio.name}
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex h-10 items-center px-3 text-sm transition-colors",
                    pathname === item.to || pathname.startsWith(`${item.to}/`)
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <CartButton />
              <SignedIn>
                <UserButton />
              </SignedIn>
            </nav>

            <div className="flex items-center gap-1 md:hidden">
              <CartButton />
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
                  <nav className="mt-8 flex flex-col gap-1">
                    {nav.map((item) => (
                      <SheetTrigger key={item.to} asChild>
                        <Link to={item.to} className="flex h-12 items-center text-base text-foreground">
                          {item.label}
                        </Link>
                      </SheetTrigger>
                    ))}
                    <SheetTrigger asChild>
                      <Link to="/cart" className="flex h-12 items-center text-base">
                        Cart
                      </Link>
                    </SheetTrigger>
                    <SignedIn>
                      <SheetTrigger asChild>
                        <Link to="/settings" className="flex h-12 items-center text-base">
                          Settings
                        </Link>
                      </SheetTrigger>
                    </SignedIn>
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        <main className={cn(overlay ? "" : "pt-16")}>
          {hydrated ? children : <ShellSkeleton overlay={overlay} />}
        </main>
        {pathname === "/login" || pathname === "/organize" ? null : <SiteFooter />}

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

function ShellSkeleton({ overlay }: { overlay: boolean }) {
  return (
    <div className={cn("px-6", overlay ? "pt-28" : "pt-10")}>
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="h-10 w-48 rounded-md bg-muted" />
        <div className="h-4 w-72 rounded-md bg-muted" />
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="aspect-[3/2] rounded-lg bg-muted" />
          <div className="aspect-[3/2] rounded-lg bg-muted" />
          <div className="aspect-[3/2] hidden rounded-lg bg-muted md:block" />
        </div>
      </div>
    </div>
  );
}
