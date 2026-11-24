// What a survivor wears and carries now, as the entries of a loadout: the admin page fills a draft from it.
// It reads and changes nothing. What a loadout may not hold is left out, so the entries pass the book's checks.

import { MOST, type Entry, type ItemEntry } from "../../shared/loadout/book.ts";
import { ARMOR_SLOTS, FLAG_BLUEPRINT, HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import type { Host } from "../host.ts";
import type { EntityRecord } from "../records.ts";

/** Everything `rec` wears and carries: worn pieces first, then the hotbar in its order, then the bag with like stacks as one. */
export function carried(host: Host, rec: EntityRecord): Entry[] {
  const reg = host.world.reg;
  const inv = host.items.inv(rec);
  const fertile = new Set<number>();
  for (const k of reg.propFertile) if (k !== 0) fertile.add(k);
  const out: Entry[] = [];
  /** Where each plain bag stack's entry is, by item and quality. */
  const stacks = new Map<number, ItemEntry>();

  const take = (slot: number, place: "wear" | "hotbar" | "bag"): void => {
    const item = inv.item[slot]!;
    if (item === 0 || inv.count[slot] === 0 || fertile.has(item)) return;
    if (reg.ballEmpty[item] !== 0) {
      // A full soul ball is the tame it keeps. One that names no kept tame is nothing to hand out.
      const tame = host.records.byPid.get(inv.refOf(slot));
      if (!tame || tame.stored === 0 || place === "wear") return;
      const level = Math.min(MOST.level, Math.max(1, tame.genome ? tame.genome.level : 1));
      out.push({ tame: reg.ids[tame.kind]!, level, saddled: tame.saddle !== 0, place });
      return;
    }
    const blueprint = (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0;
    const quality = inv.quality[slot]!;
    const count = Math.min(MOST.count, inv.count[slot]!);
    const gear = !blueprint && ((inv.loaded[slot]! > 0 && inv.ammo[slot] !== 0) || inv.attach[slot] !== 0);
    // A blueprint lies only in the bag, whatever slot it was read from.
    const at = blueprint ? "bag" : place;
    const key = item * 8 + quality;
    const like = at === "bag" && !blueprint && !gear ? stacks.get(key) : undefined;
    if (like) {
      like.count = Math.min(MOST.count, like.count + count);
      return;
    }
    const e: ItemEntry = { item: reg.ids[item]!, count, place: at };
    if (quality > 0) e.quality = quality;
    if (blueprint) e.blueprint = true;
    if (gear && inv.loaded[slot]! > 0 && inv.ammo[slot] !== 0) e.ammo = reg.ids[inv.ammo[slot]!]!;
    if (gear && inv.attach[slot] !== 0) e.attach = reg.ids[inv.attach[slot]!]!;
    if (at === "bag" && !blueprint && !gear) stacks.set(key, e);
    out.push(e);
  };

  if (inv.armor >= 0) for (let k = 0; k < ARMOR_SLOTS; k++) take(inv.armor + k, "wear");
  if (inv.hotbar >= 0) for (let k = 0; k < HOTBAR_SLOTS; k++) take(inv.hotbar + k, "hotbar");
  for (let s = 0; s < inv.bag; s++) take(s, "bag");
  return out;
}

/** What `rec` wears and carries, as many entries as a loadout holds: what is cut is from the end of the bag. */
export function captureLoadout(host: Host, rec: EntityRecord): Entry[] {
  return carried(host, rec).slice(0, MOST.entries);
}
