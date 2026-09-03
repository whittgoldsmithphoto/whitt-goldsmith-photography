import { Link } from "@tanstack/react-router";
import { Mark } from "@/components/mark";
import { useStudioStore } from "@/lib/store";

export function SiteFooter() {
  const studio = useStudioStore((s) => s.studio);
  return (
    <footer className="mt-auto border-t border-border/60 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {studio.name}
          {studio.location ? ` · ${studio.location}` : ""}
        </p>
        <Link
          to="/login"
          className="text-muted-foreground/25 transition-colors hover:text-muted-foreground/70"
          aria-label="Studio"
          title="Studio"
        >
          <Mark className="size-4" />
        </Link>
      </div>
    </footer>
  );
}
