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

type Needs = readonly (readonly [item: string, count: number])[];

/**
 * How one thing of the core pack is made, and the engram that unlocks it: `name` and the needs are ids without "core:". The
 * experience is `xp` where the wiki gives it, else a third of the engram's level, and at least 1. `at` names the station
 * it is made at (the unlit kind of a lit pair, without "core:"); without it, it is made in the hand.
 */
export function making(name: string, label: string, level: number, cost: number, count: number, seconds: number, needs: Needs, xp = Math.max(1, Math.round(level / 3)), at?: string): Def[] {
  const id = (n: string): string => `core:${n}`;
  return [
    crafting(id(name), { needs: needs.map(([item, n]) => ({ item: id(item), count: n })), seconds, xp, count, ...(at ? { at: id(at) } : {}) }),
    { type: "engram", id: id(`engram-${name}`), label, level, cost, item: id(name) },
  ];
}
