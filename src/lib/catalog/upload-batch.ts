import { apiFetch } from "../auth/api-fetch.ts";
export type UploadFile = Pick<File, "name" | "size" | "type" | "arrayBuffer">;
export type UploadState =
  "queued" | "hashing" | "uploading" | "ready" | "review" | "duplicate" | "failed" | "cancelled";
export type UploadItem = {
  index: number;
  filename: string;
  state: UploadState;
  error?: string;
  photoId?: string;
};
export function reconcileProcessing(items: UploadItem[], result: { id: string; status: string }) {
  if (!["ready", "needs_review"].includes(result.status)) return items;
  return items.map((item): UploadItem =>
    item.photoId === result.id
      ? { ...item, state: result.status === "ready" ? "ready" : "review", error: undefined }
      : item,
  );
}
type Reservation = { id: string; status: string; duplicate: boolean };
type Transport = (query: string, body: unknown, raw?: boolean) => Promise<unknown>;

export async function uploadRequest(query: string, body: unknown, raw = false): Promise<unknown> {
  const controller = new AbortController();
  // A timed-out response may have committed remotely. Retry re-reserves by checksum;
  // it never assumes that a missing response means the original was not stored.
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await apiFetch(`/api/catalog?${query}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": raw ? "application/octet-stream" : "application/json" },
      body: raw ? (body as ArrayBuffer) : JSON.stringify(body),
      signal: controller.signal,
    });
    let result: { error?: string };
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "The server returned an unreadable response. Retry this file to check its saved state.",
      );
    }
    if (!response.ok) throw new Error(result.error || "Upload request failed. Retry this file.");
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "The request timed out. The original may already be stored; retry this file to check safely.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Sequential, bounded-memory batch. Files remain on the device; server jobs are durable.
 * A failed file does not discard the rest of the batch. Cancellation waits for the
 * active file, avoiding an ambiguous abort while the server is saving an original.
 */
export async function uploadBatch(options: {
  galleryId: string;
  files: UploadFile[];
  transport?: Transport;
  onItem: (item: UploadItem) => void;
  shouldStop?: () => boolean;
}): Promise<UploadItem[]> {
  const { galleryId, files, onItem, shouldStop } = options;
  const transport = options.transport || uploadRequest;
  const results: UploadItem[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    let photoId: string | undefined;
    const emit = (state: UploadState, error?: string) => {
      const item = {
        index,
        filename: file.name,
        state,
        ...(photoId ? { photoId } : {}),
        ...(error ? { error } : {}),
      };
      results[index] = item;
      onItem(item);
    };
    if (shouldStop?.()) {
      emit("cancelled");
      continue;
    }
    try {
      if (
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size <= 0 ||
        file.size > 20 * 1024 * 1024
      )
        throw new Error("Use a nonempty JPEG or PNG up to 20 MiB. RAW/TIFF are not supported yet.");
      emit("hashing");
      const bytes = await file.arrayBuffer();
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const reservation = (await transport("op=reserve", {
        galleryId,
        filename: file.name,
        mime: file.type,
        bytes: file.size,
        checksum,
      })) as Reservation;
      if (!reservation.id || typeof reservation.status !== "string")
        throw new Error("Invalid reservation response. Retry this file.");
      photoId = reservation.id;
      if (reservation.status === "ready") {
        emit("duplicate");
        continue;
      }
      if (["uploaded", "needs_review", "processing"].includes(reservation.status)) {
        emit("review");
        continue;
      }
      if (!["reserved", "failed", "uploading"].includes(reservation.status))
        throw new Error("The server returned an unknown upload state. Reload upload history.");
      emit("uploading");
      const result = (await transport(
        `op=upload&id=${encodeURIComponent(reservation.id)}`,
        bytes,
        true,
      )) as { status?: string };
      if (result.status === "ready") emit("ready");
      else if (["uploaded", "processing", "needs_review"].includes(result.status || ""))
        emit("review");
      else
        throw new Error(
          "Upload completion was not confirmed. Retry this file to check its saved state.",
        );
    } catch (error) {
      emit("failed", error instanceof Error ? error.message : "Upload failed. Retry this file.");
    }
  }
  return results;
}
