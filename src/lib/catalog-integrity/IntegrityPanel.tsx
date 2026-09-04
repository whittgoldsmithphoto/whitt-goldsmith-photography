import { useState } from "react";
import type { IntegrityResult } from "./service";
/** Mount key={photoId} outside other forms. A check never writes or repairs files. */
export function IntegrityPanel({ photoId }: { photoId: string }) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<IntegrityResult | null>(null),
    [error, setError] = useState("");
  async function verify() {
    setBusy(true);
    setError("");
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch("/api/catalog-integrity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Integrity check unavailable");
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        body.photoId !== photoId ||
        !["verified", "mismatch", "missing"].includes(body.status) ||
        typeof body.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(body.checkedAt)) ||
        !Number.isInteger(body.expectedBytes) ||
        body.expectedBytes < 1 ||
        body.expectedBytes > 20 * 1024 * 1024 ||
        typeof body.message !== "string" ||
        body.message.length < 1 ||
        body.message.length > 1000
      )
        throw new Error(
          "The server returned an invalid integrity result. No verification was recorded; retry the check.",
        );
      setResult(body);
    } catch (err) {
      setError(
        controller.signal.aborted
          ? "Integrity check timed out. No verification was recorded; retry the check."
          : err instanceof Error
            ? err.message
            : "Integrity check unavailable",
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Original integrity check"
      className="my-4 space-y-2 rounded border border-border p-4 text-sm"
    >
      <h3 className="font-medium">Verify private original</h3>
      <p className="text-muted-foreground">
        Read this one original and compare its byte count and SHA-256 with the catalog. This does
        not edit, repair or publish it, and is not a backup or visual-quality check.
      </p>
      <button
        type="button"
        disabled={busy}
        className="rounded border border-border px-3 py-2"
        onClick={() => void verify()}
      >
        {busy ? "Checking original…" : "Check original integrity"}
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p className={result.status === "verified" ? "" : "text-destructive"}>
            {result.status.toUpperCase()}: {result.message}
          </p>
          <p className="text-xs text-muted-foreground">
            Checked {new Date(result.checkedAt).toLocaleString()} · Expected{" "}
            {result.expectedBytes.toLocaleString()} bytes
          </p>
        </div>
      )}
    </section>
  );
}
