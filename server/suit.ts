// The Meridian set every survivor comes to life in, as ARK's Genesis: Part 2 puts each survivor in a Tek suit at every spawn
// (bDisableDefaultMapItemSets, D957). Its pieces are issued (FLAG_ISSUED): new, at full durability, in the wear slots. They
// never leave their survivor, which may take them off and put them on as any piece; server/items.ts refuses every move of
// one to another record, and nothing spends one. They are burned when the survivor dies, travels from a bed or leaves for
// another server, and a new set is issued as it next comes to life. So a survivor holds one set at most, and none is ever
// left lying for anyone to take.

import type { Registry } from "../shared/content/registry.ts";
import { ARMOR_SLOTS } from "../shared/sim/items.ts";
import type { Items } from "./items.ts";
import type { EntityRecord } from "./records.ts";
import type { Rules } from "./settings/rules.ts";

/** The set's name in content (WearFacet.set). */
export const SUIT_SET = "meridian";

/** For each armor slot, head first, the first piece of the set worn there, or 0 where the set has none. */
export function suitPieces(reg: Registry): number[] {
  const out = new Array<number>(ARMOR_SLOTS).fill(0);
  for (let k = 1; k < reg.defs.length; k++) {
    const d = reg.defs[k];
    const slot = reg.wearSlot[k]!;
    if (d?.type === "item" && d.wear?.set === SUIT_SET && slot >= 0 && out[slot] === 0) out[slot] = k;
  }
  return out;
}

/**
 * Dresses `rec`, a survivor coming to life, in a new set, unless the rules say not to. An issued piece it still holds is
 * burned first, so it never has two. Anything else worn where a piece goes is moved to the bag; with no room there, it stays
 * on and that piece is not issued. Returns how many pieces were issued.
 */
export function issueSuit(items: Items, reg: Registry, rules: Rules, rec: EntityRecord): number {
  if (rules.on("bDisableDefaultMapItemSets")) return 0;
  const inv = items.inv(rec);
  if (inv.armor < 0) return 0;
  items.burnIssued(rec);
  const pieces = suitPieces(reg);
  let n = 0;
  for (let k = 0; k < ARMOR_SLOTS; k++) {
    const slot = inv.armor + k;
    if (pieces[k] === 0) continue;
    if (inv.item[slot] !== 0) {
      const to = inv.free();
      if (to < 0 || items.move(rec, slot, rec, to, 0) === 0) continue;
    }
    if (items.issue(rec, slot, pieces[k]!)) n++;
  }
  return n;
}
