import { Link, createFileRoute } from "@tanstack/react-router";
import { keywordIndex } from "@/lib/commerce";
import { livePhotos, useStudioStore } from "@/lib/store";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/keywords/")({ component: KeywordsPage });

function KeywordsPage() {
  const photos = livePhotos(useStudioStore((s) => s.photos));
  const keywords = keywordIndex(photos);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Organize
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Keywords</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Smart rooms. Every keyword gathers the photographs that wear it, across galleries.
      </p>

      {keywords.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">No keywords yet. Tag photographs to collect them.</p>
      ) : (
        <ul className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {keywords.map((k) => (
            <li key={k.tag}>
              <Link
                to="/keywords/$tag"
                params={{ tag: k.tag }}
                className="flex items-baseline justify-between rounded-xl bg-card px-5 py-4 shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]"
              >
                <span className="font-display text-2xl tracking-tight">{k.tag}</span>
                <span className="text-sm text-muted-foreground">
                  {formatCount(k.count, "photograph")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
