import { createFileRoute, Link } from "@tanstack/react-router";
import { GalleryCard } from "@/components/gallery/gallery-card";
import { Button } from "@/components/ui/button";
import { asTree, breadcrumbs, childrenOf, folderPhotoCount } from "@/lib/tree";
import { coverFor, livePhotos, useStudioStore } from "@/lib/store";
import { PhotoImage } from "@/components/photo-image";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/folders/$folderId")({ component: FolderPage });

function FolderPage() {
  const { folderId } = Route.useParams();
  const folders = useStudioStore((s) => s.folders);
  const galleries = useStudioStore((s) => s.galleries);
  const photos = livePhotos(useStudioStore((s) => s.photos));
  const folder = folders.find((f) => f.id === folderId);
  const tree = asTree(folders, galleries);
  const kids = childrenOf(tree, folderId);
  const trail = breadcrumbs(folders, galleries, folderId);

  if (!folder) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-4xl">Folder not found</h1>
        <Button asChild className="mt-8">
          <Link to="/galleries">Back to galleries</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-sm text-muted-foreground">
        <Link to="/galleries" className="hover:text-foreground">
          Galleries
        </Link>
        {trail.map((c) => (
          <span key={c.id}>
            {" / "}
            {c.kind === "folder" ? (
              <Link to="/folders/$folderId" params={{ folderId: c.id }} className="hover:text-foreground">
                {c.title}
              </Link>
            ) : (
              c.title
            )}
          </span>
        ))}
      </p>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Folder
      </p>
      <h1 className="font-display mt-2 text-4xl tracking-tight sm:text-5xl">{folder.title}</h1>
      {folder.description ? (
        <p className="mt-3 max-w-2xl text-muted-foreground">{folder.description}</p>
      ) : null}
      <p className="mt-2 text-sm text-muted-foreground">
        {formatCount(folderPhotoCount(folder.id, folders, galleries, photos), "photograph")}
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kids.map((n) => {
          if (n.kind === "gallery") {
            const gallery = galleries.find((g) => g.id === n.id);
            if (!gallery || gallery.privacy !== "public") return null;
            return <GalleryCard key={n.id} gallery={gallery} photos={photos} />;
          }
          const child = folders.find((f) => f.id === n.id);
          if (!child) return null;
          const coverGallery = galleries.find(
            (g) => g.parentId === child.id && g.privacy === "public",
          );
          const cover = coverGallery ? coverFor(coverGallery, photos) : undefined;
          return (
            <Link
              key={child.id}
              to="/folders/$folderId"
              params={{ folderId: child.id }}
              className="group relative block overflow-hidden rounded-xl bg-card"
            >
              <div className="aspect-[4/3]">
                {cover ? (
                  <PhotoImage
                    photo={cover}
                    alt=""
                    variant="thumb"
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-muted text-sm text-muted-foreground">
                    Folder
                  </div>
                )}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent p-5 pt-16">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Folder</p>
                <h3 className="font-display mt-1 text-2xl leading-tight">{child.title}</h3>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
