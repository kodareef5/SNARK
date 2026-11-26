import type { WearFacet } from "../../shared/content/kinds/items.ts";

// The skin zones each armor set's pieces cover (WearFacet.covers), by the set's meshes and the slot. A zone is listed only
// where `bun tools/art/cloth-fit.ts` finds the piece over or under every point of it in every pose of the motion set, so
// hiding it never opens a hole. On today's bodies none qualifies: every cuff, collar, waistband and boot top covers only
// the end of the zone beside it, and the zones are cut at joints and halfway along limbs, not at hems.

type Slot = WearFacet["slot"];

export const ARMOR_COVERS: Readonly<Record<string, Readonly<Record<Slot, readonly number[]>>>> = {
  cloth: { head: [], torso: [], hands: [], legs: [], feet: [] },
  hide: { head: [], torso: [], hands: [], legs: [], feet: [] },
  meridian: { head: [], torso: [], hands: [], legs: [], feet: [] },
};

/** What the piece of mesh set `set` worn in `slot` covers; a set not listed covers nothing. */
export function armorCovers(set: string, slot: Slot): readonly number[] {
  return ARMOR_COVERS[set]?.[slot] ?? [];
}
