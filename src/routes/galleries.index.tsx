import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { GalleryCard } from "@/components/gallery/gallery-card";
import { GalleryForm } from "@/components/gallery/gallery-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { publicGalleries, useStudioStore } from "@/lib/store";
import { folderHasPublicContent } from "@/lib/tree";
import { SignedIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/galleries/")({ component: GalleriesPage });

function GalleriesPage() {
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = useStudioStore((s) => s.photos);
  const createGallery = useStudioStore((s) => s.createGallery);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const visible = publicGalleries(galleries).filter((g) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      g.title.toLowerCase().includes(q) ||
      g.category.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q)
    );
  });

  const rootFolders = folders
    .filter((f) => f.parentId === null && folderHasPublicContent(f.id, folders, galleries))
    .slice()
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const loose = visible.filter((g) => !g.parentId);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Studio
          </p>
          <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">Galleries</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Public collections, grouped the way the Organizer files them. Private rooms stay off this wall.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search galleries"
            className="sm:w-56"
            aria-label="Search galleries"
          />
          <SignedIn>
            <Button onClick={() => setOpen(true)}>
              <Plus /> New gallery
            </Button>
          </SignedIn>
        </div>
      </div>

      <SignedIn>
        <p className="mt-6 text-sm text-muted-foreground">
          File originals, folders, and privacy in the{" "}
          <Link to="/organize" className="text-foreground underline-offset-4 hover:underline">
            Organizer
          </Link>
          .
        </p>
      </SignedIn>

      {visible.length === 0 && loose.length === 0 && rootFolders.length === 0 ? (
        <div className="mt-16 rounded-xl bg-card px-6 py-16 text-center shadow-[var(--shadow-border)]">
          <p className="font-display text-2xl">No public galleries yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Collections appear here when they are published.
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-14">
          {loose.length > 0 && (
            <section>
              <h2 className="font-display text-2xl tracking-tight">On the homepage</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {loose.map((g) => (
                  <GalleryCard key={g.id} gallery={g} photos={photos} />
                ))}
              </div>
            </section>
          )}
          {rootFolders.map((folder) => {
            const inFolder = visible.filter((g) => g.parentId === folder.id);
            const nested = folders.filter(
              (f) => f.parentId === folder.id && folderHasPublicContent(f.id, folders, galleries),
            );
            if (!inFolder.length && !nested.length) return null;
            return (
              <section key={folder.id}>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Folder
                    </p>
                    <h2 className="font-display text-2xl tracking-tight">{folder.title}</h2>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/folders/$folderId" params={{ folderId: folder.id }}>
                      Open folder
                    </Link>
                  </Button>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {nested.map((child) => (
                    <Link
                      key={child.id}
                      to="/folders/$folderId"
                      params={{ folderId: child.id }}
                      className="rounded-xl bg-card px-5 py-6 shadow-[var(--shadow-border)]"
                    >
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Folder</p>
                      <p className="font-display mt-1 text-2xl">{child.title}</p>
                    </Link>
                  ))}
                  {inFolder.map((g) => (
                    <GalleryCard key={g.id} gallery={g} photos={photos} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <GalleryForm
        open={open}
        onOpenChange={setOpen}
        onSubmit={(input) => {
          const id = createGallery(input);
          toast("Gallery created");
          void navigate({ to: "/galleries/$galleryId", params: { galleryId: id } });
        }}
      />
    </div>
  );
}
