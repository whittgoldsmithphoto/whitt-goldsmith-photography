import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("text-foreground", className)}
      fill="none"
      aria-hidden
    >
      <circle cx="16" cy="16" r="13.25" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M16 8.2 22.9 12.2 22.9 19.8 16 23.8 9.1 19.8 9.1 12.2Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.15" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}
