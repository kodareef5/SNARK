// Keeping food longer while a station burns (planning/reference/stations-plan.md, M6). A structure keeps things `keeps`
// times as long (Registry.keeps), and the two kinds of a lit pair may keep differently: the preserving bin's lit kind keeps
// 10 times as long and its unlit kind does not ("when fueled by Sparkpowder", ark.wiki.gg Preserving_Bin; 10x, Spoilage).
//
// Nothing steps spoiling (D41): a stack holds the tick its top item goes bad. So when a station lights or goes out, at the
// tick it happened (the tick its fuel ran out, worked out by the fire however long ago), its inventory is settled to that
// tick under the old multiplier and every clock rescaled to the new one (Items.rekeep). Nothing new is saved: the
// multiplier comes from the kind, and the clocks saved are already the new kind's.

import type { Items } from "./items.ts";
import type { Stations } from "./stations.ts";

export function wirePreserve(stations: Stations, items: Items): void {
  stations.onSwap((rec, t, from, to) => items.rekeep(rec, t, from, to));
}
