// Loot: sets of items with weights, counts, qualities and blueprint chances. A seeded roll draws from one (shared/sim/loot.ts).

import { lootFaults } from "../../sim/loot.ts";
import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

export interface LootEntry {
  /** One of these is drawn, by `weights` if given. */
  readonly items: readonly string[];
  readonly weights?: readonly number[];
  readonly weight?: number;
  readonly min: number;
  readonly max: number;
  /**
   * Lowest and highest quality as ARK's item rating (MinQuality, MaxQuality): the tier is the highest whose threshold the
   * rating drawn reaches (QUALITY_RATING, shared/sim/items.ts). Omitted, primitive.
   */
  readonly quality?: readonly [number, number];
  /** Chance, 0 to 1, that it comes as a single blueprint, for an item that may be one (ChanceToBeBlueprintOverride). */
  readonly blueprint?: number;
  /** It always comes as a blueprint, where the item may be one (bForceBlueprint). */
  readonly forceBlueprint?: boolean;
  /** Chance, 0 to 1, that it gives anything once it is drawn. Omitted, it always does. */
  readonly chance?: number;
}

/**
 * How many are drawn of a loot table's sets, or of a set's entries: from `min` to `max`. `power` skews the count as ARK's
 * NumItemSetsPower and NumItemsPower do: the count is min + floor(u^power * (max - min + 1)) for u drawn evenly, so a
 * power above 1 leans to the least and one below 1 to the most. It is a multiple of 1/16 from 1/16 to 16, so that it is
 * worked out with square roots and products alone and every engine gets the same count (shared/sim/loot.ts). `replace`
 * lets one be drawn more than once (bSetsRandomWithoutReplacement and bItemsRandomWithoutReplacement off).
 */
export interface LootCount {
  readonly min: number;
  readonly max: number;
  readonly power?: number;
  readonly replace?: boolean;
}

/**
 * Sets of items to draw from: what a crate holds, what a body leaves (shared/sim/loot.ts rolls one, and the console's `loot`
 * mints a roll). Nothing in the world opens one yet: crates and fishing wait for map zones.
 */
export interface LootDef extends Named {
  readonly type: "loot";
  readonly id: string;
  /** How many of the sets are drawn. One, where not given. */
  readonly sets?: LootCount;
  readonly from: readonly LootSet[];
}

/** One set of a loot table: its weight among the sets, how many of its entries are drawn, and the entries. */
export interface LootSet extends LootCount {
  readonly weight?: number;
  readonly entries: readonly LootEntry[];
}

const FIELDS = {
  sets: f("facet", "MinItemSets, MaxItemSets"),
  from: f("list", "ItemSets", { refs: { "[].entries[].items[]": "item" }, open: true }),
} satisfies Fields<LootDef>;

export const loot: Kind<LootDef> = {
  type: "loot",
  fields: FIELDS,
  rows: [
    row("loot", "loot", FIELDS, { ark: "a crate's item sets, a death inventory template", status: "partial", waits: "loot", shelf: "loot", must: ["from"], may: ["sets"], doc: "Sets of items with weights, counts, qualities and blueprint chances. A seeded roll draws from it (shared/sim/loot.ts) and the console's loot mints one; what opens a crate or leaves a body waits for map zones." }),
  ],
  check(d, { errors }) {
    errors.push(...lootFaults(d));
  },
};
