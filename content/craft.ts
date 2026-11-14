// How a thing is made is written beside the engram that unlocks it, and put onto its item when the pack is assembled.

import type { CraftFacet, Def } from "../shared/content/defs.ts";

const CRAFTS = new Map<string, CraftFacet>();

/**
 * Says how `item` is made. Returns the rename of the recipe id ("core:make-spear") that said it before recipes were
 * folded into items, so a save with a crafting job under that id still reads.
 */
export function crafting(item: string, craft: CraftFacet): Def {
  CRAFTS.set(item, craft);
  return { type: "rename", id: item.replace(":", ":make-"), to: [item] };
}

/** `defs` with each item given the way it is made. */
export function crafted(defs: readonly Def[]): Def[] {
  return defs.map((d) => (d.type === "item" && CRAFTS.has(d.id) ? { ...d, craft: CRAFTS.get(d.id)! } : d));
}
