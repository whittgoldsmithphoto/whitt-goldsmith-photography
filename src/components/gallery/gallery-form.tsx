import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStudioStore } from "@/lib/store";
import type { Gallery, GalleryLayout, Privacy } from "@/lib/types";
import { PRIVACY_OPTIONS } from "@/lib/types";

const LAYOUTS: { id: GalleryLayout; label: string }[] = [
  { id: "justified", label: "Justified" },
  { id: "masonry", label: "Masonry" },
  { id: "grid", label: "Grid" },
  { id: "filmstrip", label: "Filmstrip" },
];

export function GalleryForm({
  open,
  onOpenChange,
  gallery,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gallery?: Gallery;
  onSubmit: (input: {
    title: string;
    description: string;
    category: string;
    layout: GalleryLayout;
    parentId: string | null;
    privacy: Privacy;
    password?: string | null;
    forSale: boolean;
    priceListId: string | null;
  }) => void;
}) {
  const folders = useStudioStore((s) => s.folders);
  const priceLists = useStudioStore((s) => s.priceLists);
  const [title, setTitle] = useState(gallery?.title ?? "");
  const [description, setDescription] = useState(gallery?.description ?? "");
  const [category, setCategory] = useState(gallery?.category ?? "General");
  const [layout, setLayout] = useState<GalleryLayout>(gallery?.layout ?? "justified");
  const [parent, setParent] = useState(gallery?.parentId ?? "");
  const [privacy, setPrivacy] = useState<Privacy>(gallery?.privacy ?? "public");
  const [password, setPassword] = useState(gallery?.password ?? "");
  const [forSale, setForSale] = useState(gallery?.forSale ?? false);
  const [priceListId, setPriceListId] = useState(gallery?.priceListId ?? "");

  useEffect(() => {
    if (!open) return;
    setTitle(gallery?.title ?? "");
    setDescription(gallery?.description ?? "");
    setCategory(gallery?.category ?? "General");
    setLayout(gallery?.layout ?? "justified");
    setParent(gallery?.parentId ?? "");
    setPrivacy(gallery?.privacy ?? "public");
    setPassword(gallery?.password ?? "");
    setForSale(gallery?.forSale ?? false);
    setPriceListId(gallery?.priceListId ?? "");
  }, [open, gallery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{gallery ? "Edit gallery" : "New gallery"}</DialogTitle>
          <DialogDescription>
            Galleries hold originals. Attach a price list to sell prints from the wall.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              title: title.trim() || "Untitled gallery",
              description: description.trim(),
              category: category.trim() || "General",
              layout,
              parentId: parent || null,
              privacy,
              password: password.trim() || null,
              forSale,
              priceListId: priceListId || null,
            });
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="gal-title">Title</Label>
            <Input
              id="gal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="CCES Football @ St. Joes"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gal-folder">Folder</Label>
            <select
              id="gal-folder"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <option value="">Site homepage</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gal-priv">Privacy</Label>
            <select
              id="gal-priv"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as Privacy)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {PRIVACY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {(privacy === "unlisted" || privacy === "private") && (
            <div className="grid gap-1.5">
              <Label htmlFor="gal-pass">Gallery password</Label>
              <Input
                id="gal-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Optional. Pair with Unlisted like SmugMug."
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="gal-cat">Category</Label>
            <Input
              id="gal-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Landscape"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gal-desc">Description</Label>
            <Textarea
              id="gal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gal-layout">Layout</Label>
            <select
              id="gal-layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as GalleryLayout)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forSale}
              onChange={(e) => setForSale(e.target.checked)}
              className="size-4 accent-primary"
            />
            Sell prints from this gallery
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="gal-list">Price list</Label>
            <select
              id="gal-list"
              value={priceListId}
              onChange={(e) => setPriceListId(e.target.value)}
              className="flex h-10 w-full rounded-md bg-secondary px-3 text-sm shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <option value="">None</option>
              {priceLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{gallery ? "Save" : "Create gallery"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
