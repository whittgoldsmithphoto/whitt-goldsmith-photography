import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

export function UploadDropzone({
  galleryId,
  compact,
}: {
  galleryId: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addPhotosFromFiles = useStudioStore((s) => s.addPhotosFromFiles);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ingest(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      toast("Drop image files to add photographs");
      return;
    }
    setBusy(true);
    try {
      const n = await addPhotosFromFiles(galleryId, list);
      toast(n === 1 ? "1 photograph added" : `${n} photographs added`);
    } catch {
      toast("Could not add those files");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) void ingest(e.dataTransfer.files);
      }}
      className={cn(
        "rounded-xl border border-dashed border-border transition-[background-color,box-shadow] duration-150",
        over && "bg-accent shadow-[var(--shadow-border-hover)]",
        compact ? "inline-flex" : "w-full",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.zip,application/zip"
        multiple
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) void ingest(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground",
          compact ? "h-10 px-4" : "min-h-40 flex-col px-6 py-10",
        )}
      >
        <Upload className="size-4" />
        {busy ? "Adding photographs…" : compact ? "Upload" : "Drop photographs, a folder, or a zip"}
      </button>
    </div>
  );
}
