import { useState } from "react";
import { catalogFetch, useCatalog } from "@/lib/catalog/client";
import type { FolderTree, ManagedFolder } from "@/lib/catalog/folders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FolderManager({ onSaved }: { onSaved?: () => void }) {
  const state = useCatalog<FolderTree>("op=folder-tree");
  const [editing, setEditing] = useState<ManagedFolder | null>(null);
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const folders = state.data?.folders ?? [];
  function choose(folder: ManagedFolder | null) {
    setEditing(folder);
    setTitle(folder?.title ?? "");
    setParentId(folder?.parentId ?? "");
    setMessage("");
  }
  function isDescendant(folder: ManagedFolder) {
    const seen = new Set<string>();
    let current: ManagedFolder | undefined = folder;
    while (current && !seen.has(current.id)) {
      if (current.id === editing?.id) return true;
      seen.add(current.id);
      current = folders.find((candidate) => candidate.id === current?.parentId);
    }
    return false;
  }
  return (
    <section className="space-y-4 rounded border border-border p-4" aria-label="Folder manager">
      <h2 className="font-display text-2xl">Folder hierarchy</h2>
      <p className="text-sm text-muted-foreground">
        Rename or move folders without deleting galleries or photographs. Moving a folder carries
        its subfolders with it. Maximum nesting: 8 levels.
      </p>
      {state.loading && <p role="status">Loading shared folders…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error.message}</p>
          <Button variant="outline" onClick={state.reload}>
            Retry folders
          </Button>
        </div>
      )}
      {state.data && (
        <>
          <label className="block space-y-1">
            Folder to edit
            <select
              aria-label="Folder to edit"
              className="block w-full max-w-full rounded border border-border bg-background p-2"
              value={editing?.id ?? ""}
              disabled={busy}
              onChange={(event) =>
                choose(folders.find((folder) => folder.id === event.target.value) ?? null)
              }
            >
              <option value="">Create a new folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.path.join(" / ")}
                </option>
              ))}
            </select>
          </label>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setMessage("");
              try {
                await catalogFetch("op=folder-save", {
                  ...(editing ? { id: editing.id, revision: editing.revision } : {}),
                  title,
                  parentId: parentId || null,
                });
                setEditing(null);
                setTitle("");
                setParentId("");
                state.reload();
                onSaved?.();
                setMessage("Folder saved to the shared catalog.");
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? `${error.message}. Your edits remain here.`
                    : "Could not save folder. Your edits remain here.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block">
              Folder title
              <Input
                required
                maxLength={180}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block space-y-1">
              Parent folder
              <select
                aria-label="Parent folder"
                className="block w-full max-w-full rounded border border-border bg-background p-2"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                disabled={busy}
              >
                <option value="">Top level</option>
                {folders
                  .filter((folder) => !isDescendant(folder))
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.path.join(" / ")}
                    </option>
                  ))}
              </select>
            </label>
            {editing && (
              <p className="text-xs text-muted-foreground">
                Editing saved version {editing.revision}. A conflicting change from another tab will
                be rejected.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy || !title.trim()} type="submit">
                {busy ? "Saving…" : editing ? "Save folder changes" : "Create folder"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    (title !== (editing?.title ?? "") || parentId !== (editing?.parentId ?? "")) &&
                    !window.confirm("Discard unsaved folder edits and reload?")
                  )
                    return;
                  choose(null);
                  state.reload();
                }}
              >
                Reload saved folders
              </Button>
            </div>
          </form>
          {!folders.length && (
            <p>No folders yet. Create one here, then assign galleries from the organizer.</p>
          )}
        </>
      )}
      <p role="status" className="break-words">
        {message}
      </p>
    </section>
  );
}
