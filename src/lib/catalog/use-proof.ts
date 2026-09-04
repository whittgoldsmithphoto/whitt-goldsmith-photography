import { useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { catalogFetch, useCatalog } from "./client";
import type { ProofSelection } from "./types";

export function useProofSelection(galleryId: string) {
  const remote = useCatalog<ProofSelection>(`op=proof&id=${encodeURIComponent(galleryId)}`);
  const [draft, setDraft] = useState<ProofSelection | null>(null);
  const [saved, setSaved] = useState<ProofSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const base =
    saved?.galleryId === galleryId
      ? saved
      : remote.data?.galleryId === galleryId
        ? remote.data
        : undefined;
  const currentDraft = draft?.galleryId === galleryId ? draft : null;
  const selection = currentDraft || base;
  useBlocker({
    disabled: !currentDraft,
    enableBeforeUnload: Boolean(currentDraft),
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !window.confirm("Your proof selection has unsaved changes. Leave without saving?"),
  });
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
      if (!selection || saving.current) return;
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
      if (selection && !saving.current) {
        setDraft({ ...selection, note });
        setMessage("");
      }
    },
    async save() {
      if (!selection || saving.current) return;
      saving.current = true;
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
            ? `${error.message} Your draft is still here; retry saving, or reload the saved version if it changed.`
            : "Could not save. Your unsaved draft remains here.",
        );
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
  };
}
export type ProofController = ReturnType<typeof useProofSelection>;
