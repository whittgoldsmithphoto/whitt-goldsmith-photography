import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

// A bypassable convenience deterrent, not access control or screenshot prevention.
// Only public customer photo pixels use this component; no document-level handlers.
export function ProtectedPhoto(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [notice, setNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <>
      <img
        {...props}
        draggable={false}
        style={{ ...props.style, userSelect: "none", WebkitTouchCallout: "none" }}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          // Repeated attempts during the notice do not re-announce or stack messages.
          if (timer.current) return;
          setNotice(true);
          timer.current = setTimeout(() => {
            setNotice(false);
            timer.current = null;
          }, 4000);
        }}
      />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={
          notice
            ? "pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-md border border-border bg-background p-3 text-center text-sm text-foreground shadow-lg"
            : "sr-only"
        }
      >
        {notice ? "Protected preview. Original downloads require permission." : ""}
      </span>
    </>
  );
}
