import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth/api-fetch";
import { CatalogRequestError } from "./client";
import type { Page } from "../api/contracts";
import type { CatalogGallery } from "./types";
type ResourcePage<T> = Page<T> & { gallery?: CatalogGallery };
async function request<T>(path: string, signal?: AbortSignal): Promise<ResourcePage<T>> {
  const response = await apiFetch(path, { credentials: "same-origin", cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok)
    throw new CatalogRequestError(
      result.error?.message || "Catalog request failed",
      response.status,
    );
  return result;
}
export function useResourcePage<T extends { id: string }>(
  url: string,
  retainWhileSearching = false,
) {
  const [data, setData] = useState<ResourcePage<T>>();
  const [error, setError] = useState<CatalogRequestError>();
  const [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0),
    busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current,
      abort = new AbortController();
    setLoading(true);
    setLoadingMore(false);
    setError(undefined);
    busy.current = false;
    if (!retainWhileSearching) setData(undefined);
    request<T>(url, abort.signal)
      .then((result) => {
        if (current === generation.current) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (current === generation.current && !abort.signal.aborted) {
          setData(undefined);
          setError(error);
          setLoading(false);
        }
      });
    return () => {
      generation.current = current + 1;
      abort.abort();
    };
  }, [url, revision, retainWhileSearching]);
  async function loadMore() {
    if (loading || busy.current || !data?.page.nextCursor) return;
    const current = generation.current;
    busy.current = true;
    setLoadingMore(true);
    setError(undefined);
    try {
      const result = await request<T>(
        `${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(data.page.nextCursor)}`,
      );
      if (current === generation.current)
        setData((previous) => {
          const known = new Set(previous?.data.map((item) => item.id));
          return {
            ...result,
            data: [...(previous?.data || []), ...result.data.filter((item) => !known.has(item.id))],
          };
        });
    } catch (error) {
      if (current === generation.current) {
        setError(error as CatalogRequestError);
        if (error instanceof CatalogRequestError && [401, 403, 404].includes(error.status))
          setData(undefined);
      }
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }
  return { data, error, loading, loadingMore, loadMore, reload: () => setRevision((n) => n + 1) };
}
