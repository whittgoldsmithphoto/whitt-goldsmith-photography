import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth/api-fetch";
import type { LibraryMetadataRow } from "@/lib/catalog/library-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SmartCollection } from "@/lib/catalog/smart-collections";

export function LibraryMetadataPanel({ galleryId }: { galleryId: string }) {
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionRefresh, setCollectionRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filterRating, setFilterRating] = useState("");
  const [params, setParams] = useState("");
  const [rows, setRows] = useState<LibraryMetadataRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [remove, setRemove] = useState("");
  const [rating, setRating] = useState("");
  const [label, setLabel] = useState("unchanged");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/catalog/collections", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Could not load collections");
        if (!controller.signal.aborted)
          setCollections(
            data.filter((item: SmartCollection) => item.rules.galleryId === galleryId),
          );
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [galleryId, collectionRefresh]);
  async function saveCollection() {
    setSaving(true);
    setError("");
    try {
      const rules: Record<string, unknown> = Object.fromEntries(new URLSearchParams(params));
      delete rules.after;
      rules.galleryId = galleryId;
      const current = collections.find((item) => item.id === collectionId);
      const response = await apiFetch("/api/catalog/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: collectionTitle,
          rules,
          ...(current ? { id: current.id, revision: current.revision } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Collection save failed");
      setCollectionId(data.id);
      setCollectionTitle(data.title);
      setCollectionRefresh((n) => n + 1);
      setNotice("Saved private smart collection.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Collection save failed");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    setSelected([]);
    const search = new URLSearchParams(params);
    search.set("galleryId", galleryId);
    void apiFetch(`/api/catalog/metadata?${search}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Could not load library metadata");
        if (!controller.signal.aborted) {
          setRows(body.items);
          setNext(body.next);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, galleryId, reload]);
  async function save() {
    const patch: Record<string, unknown> = {};
    const split = (text: string) =>
      text
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean);
    if (add.trim()) patch.addKeywords = split(add);
    if (remove.trim()) patch.removeKeywords = split(remove);
    if (rating !== "") patch.rating = Number(rating);
    if (label !== "unchanged") patch.label = label;
    if (!Object.keys(patch).length) {
      setError("Choose at least one change first.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/catalog/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: rows
            .filter((row) => selected.includes(row.id))
            .map(({ id, revision }) => ({ id, revision })),
          patch,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Metadata save failed");
      setNotice(`Saved metadata for ${body.changed} photographs.`);
      setAdd("");
      setRemove("");
      setRating("");
      setLabel("unchanged");
      setReload((n) => n + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Metadata save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Private library metadata">
      <div className="space-y-2 border-b border-border pb-3">
        <label className="block text-sm">
          Private smart collections
          <select
            aria-label="Private smart collection"
            className="mt-1 block w-full rounded border border-input bg-background p-2"
            value={collectionId}
            disabled={saving}
            onChange={(event) => {
              const id = event.target.value;
              setCollectionId(id);
              const item = collections.find((c) => c.id === id);
              setCollectionTitle(item?.title || "");
              if (item) {
                const p = new URLSearchParams();
                for (const [key, value] of Object.entries(item.rules))
                  if (key !== "galleryId") p.set(key, String(value));
                setParams(p.toString());
                setQuery(item.rules.q || "");
                setKeyword(item.rules.keyword || "");
                setFilterRating(item.rules.rating === undefined ? "" : String(item.rules.rating));
                setReload((n) => n + 1);
              }
            }}
          >
            <option value="">New collection</option>
            {collections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="Smart collection title"
          placeholder="Collection name"
          value={collectionTitle}
          disabled={saving}
          onChange={(event) => setCollectionTitle(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={saving || loading || !collectionTitle.trim()}
          onClick={() => void saveCollection()}
        >
          {collectionId ? "Update collection" : "Save collection"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Saves the applied filters for this gallery, not a fixed photo list. Matching photos update
          as metadata changes. Nothing is published.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Keywords, ratings and labels are private studio annotations. They do not change public
        captions or purchased files.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const search = new URLSearchParams();
          if (query) search.set("q", query);
          if (keyword) search.set("keyword", keyword);
          if (filterRating) search.set("rating", filterRating);
          setParams(search.toString());
          setReload((n) => n + 1);
        }}
      >
        <Input
          aria-label="Metadata filename or caption filter"
          placeholder="Filename or caption"
          value={query}
          disabled={saving}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Input
          aria-label="Keyword filter"
          placeholder="Exact keyword"
          value={keyword}
          disabled={saving}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <select
          aria-label="Rating filter"
          value={filterRating}
          disabled={saving}
          onChange={(event) => setFilterRating(event.target.value)}
          className="rounded border border-input bg-background p-2"
        >
          <option value="">Any rating</option>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} stars
            </option>
          ))}
        </select>
        <Button variant="outline" disabled={saving}>
          Filter
        </Button>
      </form>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="outline" disabled={saving} onClick={() => setReload((n) => n + 1)}>
            Refresh metadata
          </Button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading metadata…</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving || !rows.length}
              onClick={() => setSelected(rows.map((row) => row.id))}
            >
              Select this page
            </Button>
            <Button
              variant="outline"
              disabled={saving || !selected.length}
              onClick={() => setSelected([])}
            >
              Clear selection
            </Button>
          </div>
          <ul className="max-h-64 overflow-auto divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="py-2">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(row.id)}
                    disabled={saving}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">
                    {row.filename}
                    <span className="block text-sm text-muted-foreground">
                      {row.rating} stars · {row.label || "No label"} ·{" "}
                      {row.keywords.join(", ") || "No keywords"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {!rows.length && !error && <p>No matching photographs.</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving || !new URLSearchParams(params).has("after")}
              onClick={() => {
                const p = new URLSearchParams(params);
                p.delete("after");
                setParams(p.toString());
              }}
            >
              First page
            </Button>
            <Button
              variant="outline"
              disabled={saving || !next}
              onClick={() => {
                const p = new URLSearchParams(params);
                p.set("after", next!);
                setParams(p.toString());
              }}
            >
              Next page
            </Button>
          </div>
        </>
      )}
      <fieldset
        disabled={saving || loading || !selected.length}
        className="space-y-2 border-t border-border pt-3"
      >
        <legend className="text-sm">Edit {selected.length} selected photographs</legend>
        <Input
          aria-label="Add keywords"
          placeholder="Add keywords, separated by commas"
          value={add}
          onChange={(event) => setAdd(event.target.value)}
        />
        <Input
          aria-label="Remove keywords"
          placeholder="Remove keywords, separated by commas"
          value={remove}
          onChange={(event) => setRemove(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Set rating"
            className="rounded border border-input bg-background p-2"
            value={rating}
            onChange={(event) => setRating(event.target.value)}
          >
            <option value="">Keep ratings</option>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} stars
              </option>
            ))}
          </select>
          <select
            aria-label="Set label"
            className="rounded border border-input bg-background p-2"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          >
            <option value="unchanged">Keep labels</option>
            <option value="">Clear label</option>
            <option value="select">Select</option>
            <option value="review">Review</option>
            <option value="reject">Reject</option>
          </select>
          <Button onClick={() => void save()}>{saving ? "Saving…" : "Apply metadata"}</Button>
        </div>
      </fieldset>
    </section>
  );
}
