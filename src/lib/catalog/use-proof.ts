import { useState } from "react";
import { catalogFetch, useCatalog } from "./client";
import type { ProofSelection } from "./types";

export function useProofSelection(galleryId: string) {
  const remote = useCatalog<ProofSelection>(`op=proof&id=${encodeURIComponent(galleryId)}`);
  const [draft, setDraft] = useState<ProofSelection | null>(null);
  const [saved, setSaved] = useState<ProofSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base =
    saved?.galleryId === galleryId
      ? saved
      : remote.data?.galleryId === galleryId
        ? remote.data
        : undefined;
  const currentDraft = draft?.galleryId === galleryId ? draft : null;
  const selection = currentDraft || base;
  const reload = () => {
    setDraft(null);
    setSaved(null);
    setMessage("");
    remote.reload();
  };
  return {
    selection,
    busy,
    message,
    loading: remote.loading,
    error: remote.error,
    dirty: Boolean(currentDraft),
    reload,
    toggle(id: string) {
      if (!selection || busy) return;
      const photoIds = selection.photoIds.includes(id)
        ? selection.photoIds.filter((p) => p !== id)
        : [...selection.photoIds, id];
      if (photoIds.length > 500) {
        setMessage("A selection can contain up to 500 photographs.");
        return;
      }
      setDraft({ ...selection, photoIds });
      setMessage("");
    },
    note(note: string) {
      if (selection && !busy) {
        setDraft({ ...selection, note });
        setMessage("");
      }
    },
    async save() {
      if (!selection || busy) return;
      setBusy(true);
      setMessage("");
      try {
        const result = await catalogFetch<ProofSelection>("op=proof", {
          galleryId,
          photoIds: selection.photoIds,
          note: selection.note,
          revision: selection.revision,
        });
        setSaved(result);
        setDraft(null);
        setMessage("Saved to your account and sent to the owner’s proof inbox.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not save. Your unsaved draft remains here.",
        );
      } finally {
        setBusy(false);
      }
    },
  };
}
export type ProofController = ReturnType<typeof useProofSelection>;
