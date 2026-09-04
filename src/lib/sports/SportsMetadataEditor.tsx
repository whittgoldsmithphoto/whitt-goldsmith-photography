import { useEffect, useState } from "react";
import type { SportsMetadata } from "./repository";
import {
  applyRememberedEvent,
  eventDetails,
  forgetRememberedEvent,
  readRememberedEvent,
  rememberSavedEvent,
  type EventDetails,
} from "./event-reuse";

async function call<T>(op: string, photoId: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/sports?op=${op}&photoId=${encodeURIComponent(photoId)}`, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Metadata request failed");
  return data;
}

/** Mount with key={photoId} so changing the selected photo discards unsaved drafts. */
export function SportsMetadataEditor({ photoId }: { photoId: string }) {
  const [draft, setDraft] = useState<SportsMetadata | null>(null);
  const [history, setHistory] = useState<SportsMetadata[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [remembered, setRemembered] = useState<EventDetails | null>(null);
  useEffect(() => {
    let active = true;
    setDraft(null);
    setError("");
    setMessage("");
    setHistory([]);
    try {
      setRemembered(readRememberedEvent(window.sessionStorage));
    } catch {
      setRemembered(null);
    }
    call<SportsMetadata>("read", photoId)
      .then((value) => {
        if (active) setDraft(value);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [photoId, reload]);
  async function save(restoreRevision?: number) {
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await call<SportsMetadata>(
        restoreRevision ? "restore" : "save",
        photoId,
        restoreRevision ? { photoId, revision: draft.revision, restoreRevision } : draft,
      );
      setDraft(value);
      setHistory([]);
      if (!restoreRevision) {
        try {
          if (rememberSavedEvent(window.sessionStorage, value)) setRemembered(eventDetails(value));
        } catch {
          /* Browser storage is optional; the server save already succeeded. */
        }
      }
      setMessage(
        restoreRevision
          ? "Restored as a new draft. Review and approve before public search."
          : "Metadata saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Sports metadata">
      <h3 className="font-medium">Sports and event details</h3>
      <p className="text-xs text-muted-foreground">
        Only approved details on public, published, unprotected galleries appear in search.
        Photographer notes always stay private. No facial recognition is used.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
            Reload saved details
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!draft ? (
        <p className="text-sm">{error ? "Metadata could not be loaded." : "Loading metadata…"}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-3">
            {remembered && (
              <div className="space-y-2 rounded border border-border p-3 text-sm">
                <p>
                  Last saved event in this tab:{" "}
                  {[
                    remembered.team,
                    remembered.sport,
                    remembered.opponent,
                    remembered.venue,
                    remembered.eventDate,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Empty event fields"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reuse replaces team, sport, opponent, venue and date in this unsaved draft only.
                  Jersey, subject and private notes stay unchanged. Review and Save metadata to keep
                  it.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setDraft(applyRememberedEvent(draft, remembered));
                      setError("");
                      setMessage(
                        "Event details copied to an unapproved draft. Review and save to keep them.",
                      );
                    }}
                  >
                    Reuse last saved event details
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      try {
                        forgetRememberedEvent(window.sessionStorage);
                      } catch {
                        /* Optional local cache. */
                      }
                      setRemembered(null);
                    }}
                  >
                    Forget saved event details
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["team", "Team"],
                  ["sport", "Sport"],
                  ["opponent", "Opponent"],
                  ["venue", "Venue"],
                  ["jerseyNumber", "Jersey number"],
                  ["subject", "Owner-reviewed subject"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="grid gap-1 text-sm">
                  {label}
                  <input
                    className="rounded border border-border bg-background p-2"
                    value={draft[field]}
                    maxLength={field === "jerseyNumber" ? 12 : 160}
                    onChange={(event) =>
                      setDraft({ ...draft, [field]: event.target.value, approved: false })
                    }
                  />
                </label>
              ))}
              <label className="grid gap-1 text-sm">
                Event date
                <input
                  type="date"
                  className="rounded border border-border bg-background p-2"
                  value={draft.eventDate || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, eventDate: event.target.value || null, approved: false })
                  }
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              Private photographer notes
              <textarea
                className="rounded border border-border bg-background p-2"
                maxLength={4000}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.approved}
                onChange={(event) => setDraft({ ...draft, approved: event.target.checked })}
              />
              I reviewed these details and approve them for public search when gallery access
              permits.
            </label>
            <div className="flex flex-wrap gap-3">
              <button className="rounded border border-border px-3 py-2 text-sm" type="submit">
                {busy ? "Saving…" : "Save metadata"}
              </button>
              <button
                className="text-sm underline"
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    setHistory(await call<SportsMetadata[]>("history", photoId));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "History unavailable");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Load saved revisions
              </button>
            </div>
            {history.length > 0 && (
              <ul className="space-y-2 text-sm">
                {history.map((version) => (
                  <li key={version.revision}>
                    Revision {version.revision}: {version.team || "No team"} /{" "}
                    {version.sport || "No sport"}
                    {version.revision !== draft.revision && (
                      <button
                        type="button"
                        className="ml-3 underline"
                        onClick={() => void save(version.revision)}
                      >
                        Restore as draft
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
}
