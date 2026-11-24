// The loadouts a world begins with. An admin edits a copy (server/loadout/store.ts).
// It is data kept out of the core content: content is hashed for every client, and this is not theirs to hold.
// The weapon and armor lists are those of the `kit` and `armor` commands (server/commands/combat.ts).

import type { Entry, ItemEntry, Loadout, LoadoutBook, Place } from "../shared/loadout/book.ts";

const PIECES = ["hat", "shirt", "gloves", "pants", "boots"] as const;
const give = (name: string, count: number, place: Place, more: Partial<ItemEntry> = {}): ItemEntry => ({ item: `core:${name}`, count, place, ...more });
/** The five pieces of an armor set, worn. */
const suit = (set: string): Entry[] => PIECES.map((p) => give(`${set}_${p}`, 1, "wear"));
const loadout = (id: string, label: string, note: string, entries: Entry[]): Loadout => ({ id, label, note, respawn: false, entries });

/** The built-in book, made anew at each call. */
export function builtinLoadouts(): LoadoutBook {
  return {
    revision: 0,
    assign: { player: "naked", admin: "naked" },
    loadouts: [
      loadout("naked", "Naked", "Nothing worn and nothing carried, as ARK's beach start is.", []),
      loadout("stone", "Stone tools", "A hatchet, a pick and a spear, in cloth.", [give("hatchet", 1, "hotbar"), give("pick", 1, "hotbar"), give("spear", 1, "hotbar"), ...suit("cloth")]),
      loadout("hunter", "Hunter", "A bow with stone, tranquilizer and flame arrows, in hide.", [
        give("bow", 1, "hotbar"),
        give("arrow_stone", 40, "bag"),
        give("arrow_tranq", 20, "bag"),
        give("arrow_flame", 20, "bag"),
        ...suit("hide"),
      ]),
      loadout("rifleman", "Rifleman", "A scoped rifle, loaded, with spare rounds and tranquilizer darts, in flak.", [
        give("rifle", 1, "hotbar", { ammo: "core:round_rifle", attach: "core:scope" }),
        give("round_rifle", 30, "bag"),
        give("dart_tranq", 20, "bag"),
        ...suit("flak"),
      ]),
      loadout("scout", "Scout", "The Meridian suit and a saddled pteranodon in a soul ball: the fast way to see the world.", [
        ...suit("meridian"),
        { tame: "core:pteranodon", level: 240, saddled: true, place: "hotbar" },
      ]),
    ],
  };
}
