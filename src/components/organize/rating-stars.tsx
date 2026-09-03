import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingStars({
  value,
  onChange,
  size = "sm",
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "size-5" : "size-3.5";
  return (
    <div className="inline-flex items-center" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const inner = (
          <Star className={cn(dim, on ? "fill-primary text-primary" : "text-muted-foreground/50")} />
        );
        if (!onChange) {
          return (
            <span key={n} className="inline-flex p-0.5">
              {inner}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            aria-label={value === n ? "Clear rating" : `${n} stars`}
            onClick={() => onChange(value === n ? 0 : n)}
            className="inline-flex min-h-8 min-w-8 items-center justify-center"
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
