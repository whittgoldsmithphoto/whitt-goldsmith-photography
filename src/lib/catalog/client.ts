import { useCallback, useEffect, useState } from "react";

export class CatalogRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function catalogFetch<T>(query: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/catalog?${query}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new CatalogRequestError(result.error || "Catalog request failed", response.status);
  return result;
}
export function useCatalog<T>(query: string) {
  const [state, setState] = useState<{ data?: T; error?: CatalogRequestError; loading: boolean }>({
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    catalogFetch<T>(query)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false });
      })
      .catch((error) => {
        if (!cancelled) setState({ error, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [query, revision]);
  return { ...state, reload };
}
