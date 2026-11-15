// The inventory pictures a build drew (shared/pack/icons.ts), as the interface shows them. Each sheet is one image of
// the frame's image table, named by its file: the page's browser fetches it the first time a node shows a picture of
// it, and keeps it, as its name is its hash. Which picture an item has is its `#icon` slot's, filled as every slot is
// (shared/content/slots.ts); an item without one keeps its swatch.

import type { Def } from "../../../shared/content/defs.ts";
import { fillSlot, slotsOf } from "../../../shared/content/slots.ts";
import { iconAt, type ManifestIcons } from "../../../shared/pack/icons.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { UiFrame, UiIcons, UiImage, UiNode } from "../ui/nodes.ts";

/** The first index of the sheets in the frame's image table, clear of the minimap's, the map's and the hearts'. */
export const IMAGE_ICONS = 64;

export class Icons implements UiIcons {
  /** One a sheet. In a browser `data` is empty and `url` names the file; a tool fills `data` with the pixels. */
  readonly images: UiImage[];
  private readonly icons: ManifestIcons | null;
  /** By the id of the definition that owns an `#icon` slot, the cell of its picture. */
  private readonly owned = new Map<string, number>();

  /**
   * `defs` are the content whose slots are filled, and `folder` where the manifest's files are served. `pixels`, for a
   * tool, gives a sheet's RGBA by its index.
   */
  constructor(manifest: Pick<Manifest, "files" | "icons">, defs: readonly (Def | null)[], folder = "assets", pixels?: (sheet: number) => Uint8ClampedArray) {
    const icons = (this.icons = manifest.icons ?? null);
    this.images = (icons?.sheets ?? []).map((s, k) => ({ width: s.columns * icons!.size, height: s.rows * icons!.size, data: pixels?.(k) ?? new Uint8ClampedArray(0), version: 1, url: `${folder}/${manifest.files[s.file]!.name}` }));
    if (!icons) return;
    const has = (asset: string, id: string): boolean => asset === "icon" && id in icons.cells;
    for (const u of slotsOf(defs.filter((d): d is Def => d !== null))) {
      if (u.slot !== "icon" || u.key !== "") continue;
      const { id } = fillSlot(u, has);
      if (id !== "") this.owned.set(u.owner, icons.cells[id]!);
    }
  }

  /** Whether there is a picture of this id: what an `#icon` slot names (`core:pick/icon`). */
  has(id: string): boolean {
    return this.icons !== null && id in this.icons.cells;
  }

  /** Puts the sheets in the frame's image table, and the pictures where its screens look for them. */
  install(f: UiFrame): void {
    this.images.forEach((image, k) => (f.images[IMAGE_ICONS + k] = image));
    f.icons = this;
  }

  place(n: UiNode, owner: string): boolean {
    const cell = this.owned.get(owner);
    if (cell === undefined) return false;
    const size = this.icons!.size;
    const at = iconAt(cell, size);
    n.image = IMAGE_ICONS + at.sheet;
    n.sx = at.x;
    n.sy = at.y;
    n.sw = size;
    n.sh = size;
    return true;
  }
}
