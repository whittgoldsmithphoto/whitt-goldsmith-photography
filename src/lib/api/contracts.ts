export type Page<T> = { data: T[]; page: { nextCursor: string | null; hasMore: boolean } };
export type ApiError = {
  error: { code: string; message: string; requestId: string; fields?: Record<string, string> };
};
