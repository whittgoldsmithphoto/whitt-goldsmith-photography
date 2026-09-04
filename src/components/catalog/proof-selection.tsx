import { Link } from "@tanstack/react-router";
import type { ProofController } from "@/lib/catalog/use-proof";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ProofPanel({ proof, galleryId }: { proof: ProofController; galleryId: string }) {
  if (proof.error?.status === 401)
    return (
      <div className="my-6 rounded border border-border p-4">
        <p>Sign in to save favorites and notes, then return to them on another device.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/login" search={{ gallery: galleryId }}>
              Sign in to select photos
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/login" search={{ gallery: galleryId, setup: "1" }}>
              Create customer account
            </Link>
          </Button>
        </div>
      </div>
    );
  if (!proof.selection)
    return (
      <div className="my-6" role="status">
        <p>
          {proof.loading
            ? "Loading your selection…"
            : proof.error?.message || "Selection unavailable"}
        </p>
        {!proof.loading && (
          <Button variant="outline" onClick={proof.reload}>
            Retry selection
          </Button>
        )}
      </div>
    );
  const selection = proof.selection;
  return (
    <section
      className="my-6 space-y-3 rounded border border-border p-4"
      aria-label="Your proof selection"
    >
      <h2 className="font-display text-2xl">
        Your selection · {selection.photoIds.length} photographs
      </h2>
      <p className="text-sm text-muted-foreground">
        Choose favorites below, add a note, then save. Selections are not purchases and do not grant
        downloads.
      </p>
      {selection.unavailableCount > 0 && (
        <p>
          {selection.unavailableCount} previously selected photographs are no longer available.
          Saving updates the list to the available photographs shown here.
        </p>
      )}
      <label className="block">
        Note to Whitt
        <Textarea
          maxLength={2000}
          value={selection.note}
          disabled={proof.busy}
          onChange={(e) => proof.note(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <Button disabled={proof.busy || !proof.dirty} onClick={() => void proof.save()}>
          {proof.busy ? "Saving…" : "Save selection"}
        </Button>
        <Button
          variant="outline"
          disabled={proof.busy}
          onClick={() => {
            if (
              !proof.dirty ||
              window.confirm("Discard unsaved selection changes and reload the saved version?")
            )
              proof.reload();
          }}
        >
          Reload saved selection
        </Button>
        {selection.id && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selection.id!);
              } catch {
                window.prompt("Copy selection reference", selection.id!);
              }
            }}
          >
            Copy reference ID
          </Button>
        )}
      </div>
      <p role="status">
        {proof.message ||
          (proof.dirty
            ? "Unsaved changes — save before leaving this page."
            : selection.updatedAt
              ? `Saved ${new Date(selection.updatedAt).toLocaleString()}`
              : "No saved selection yet.")}
      </p>
      {selection.id && (
        <p className="break-all text-xs text-muted-foreground">
          Reference: {selection.id}. Share this with Whitt; it does not give other visitors access
          to your gallery or notes.
        </p>
      )}
    </section>
  );
}
