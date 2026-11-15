// A loot roll: what a set of item sets (LootDef) gives, drawn from a seeded generator, so one seed gives the same items on every
// engine. It reads as ARK's crate item sets do (ark.wiki.gg Server_configuration, ConfigOverrideSupplyCrateItems, and
// Item_Quality, 2026-11-15): a number of sets from MinItemSets to MaxItemSets drawn by SetWeight, from each set a number of
// entries from MinNumItems to MaxNumItems drawn by EntryWeight, and from each entry one of its items by ItemsWeights, a
// quantity from MinQuantity to MaxQuantity, a quality from MinQuality to MaxQuality (an item rating, whose tier is the
// highest threshold it reaches), and with ChanceToBeBlueprintOverride a blueprint in place of the item. Sets and entries are
// drawn without putting back, as ARK's bSetsRandomWithoutReplacement and bItemsRandomWithoutReplacement ask: chosen, as the
// wiki gives those no default. What is drawn is put nowhere: the caller mints it.

import type { LootDef, LootEntry } from "../content/defs.ts";
import type { Rng } from "../rng.ts";
import { QUALITY_RATING, qualityOfRating } from "./items.ts";

/** One thing a roll gives. A blueprint comes one at a time. */
export interface LootDrop {
  /** Content index. */
  readonly item: number;
  readonly count: number;
  readonly quality: number;
  readonly blueprint: boolean;
}

/** The most a range may ask for, so that a mistaken definition cannot mint without end. */
export const MOST_LOOT = 10000;

/** A whole number from `min` to `max`, both included. */
function between(rng: Rng, min: number, max: number): number {
  return max <= min ? min : min + rng.int(max - min + 1);
}

/** Draws an index of `weights` in proportion to them, skipping those `taken`. -1 if none is left with any weight. */
function pick(rng: Rng, weights: readonly number[], taken: Uint8Array | null): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) if (!taken || taken[i] === 0) sum += weights[i]!;
  if (!(sum > 0)) return -1;
  let at = rng.float() * sum;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    if (taken && taken[i] !== 0) continue;
    if (!(weights[i]! > 0)) continue;
    last = i;
    if (at < weights[i]!) return i;
    at -= weights[i]!;
  }
  return last;
}

/**
 * Rolls `def`. `index` turns an item id into its content index (0 for none), and `blueprints` says which items may be
 * blueprints (Registry.blueprints): an entry's blueprint chance gives the item itself where it may not.
 */
export function rollLoot(def: LootDef, rng: Rng, index: (id: string) => number, blueprints: Uint8Array): LootDrop[] {
  const out: LootDrop[] = [];
  const sets = def.from;
  const setWeights = sets.map((s) => s.weight ?? 1);
  const setsTaken = new Uint8Array(sets.length);
  const nSets = Math.min(sets.length, between(rng, def.sets?.min ?? 1, def.sets?.max ?? 1));
  for (let k = 0; k < nSets; k++) {
    const si = pick(rng, setWeights, setsTaken);
    if (si < 0) break;
    setsTaken[si] = 1;
    const set = sets[si]!;
    const weights = set.entries.map((e) => e.weight ?? 1);
    const taken = new Uint8Array(set.entries.length);
    const nItems = Math.min(set.entries.length, between(rng, set.min, set.max));
    for (let j = 0; j < nItems; j++) {
      const ei = pick(rng, weights, taken);
      if (ei < 0) break;
      taken[ei] = 1;
      const drop = entryDrop(set.entries[ei]!, rng, index, blueprints);
      if (drop) out.push(drop);
    }
  }
  return out;
}

/** What one entry gives. Every draw is made whatever it gives, so the stream after it does not depend on the content. */
function entryDrop(e: LootEntry, rng: Rng, index: (id: string) => number, blueprints: Uint8Array): LootDrop | null {
  const which = pick(rng, e.weights ?? e.items.map(() => 1), null);
  const count = between(rng, e.min, e.max);
  const [lo, hi] = e.quality ?? [0, 0];
  const rating = hi > lo ? lo + (hi - lo) * rng.float() : lo;
  const chance = e.blueprint ?? 0;
  const roll = rng.float();
  const item = which < 0 ? 0 : index(e.items[which]!);
  if (item === 0 || count <= 0) return null;
  const blueprint = roll < chance && blueprints[item] !== 0;
  return { item, count: blueprint ? 1 : count, quality: qualityOfRating(rating), blueprint };
}

/** What is wrong with a loot definition's numbers, one line each. */
export function lootFaults(def: LootDef): string[] {
  const out: string[] = [];
  const range = (what: string, min: number, max: number): void => {
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max <= MOST_LOOT)) out.push(`${def.id}: ${what} is a whole range from 0 to ${MOST_LOOT}, its least first`);
  };
  if (def.sets) range("sets", def.sets.min, def.sets.max);
  if (def.from.length === 0) out.push(`${def.id}: from needs at least one set`);
  for (const set of def.from) {
    if (set.weight !== undefined && !(set.weight >= 0)) out.push(`${def.id}: a set's weight must not be negative`);
    range("a set's min and max", set.min, set.max);
    for (const e of set.entries) {
      if (e.items.length === 0) out.push(`${def.id}: an entry names at least one item`);
      if (e.weights !== undefined && (e.weights.length !== e.items.length || e.weights.some((w) => !(w >= 0)))) out.push(`${def.id}: an entry's weights are one for each of its items, none negative`);
      if (e.weight !== undefined && !(e.weight >= 0)) out.push(`${def.id}: an entry's weight must not be negative`);
      range("an entry's min and max", e.min, e.max);
      if (e.quality !== undefined && !(e.quality.length === 2 && e.quality[0] >= 0 && e.quality[1] >= e.quality[0] && e.quality[1] <= QUALITY_RATING[QUALITY_RATING.length - 1]! * 10)) out.push(`${def.id}: an entry's quality is [least, most] item rating, from 0`);
      if (e.blueprint !== undefined && !(e.blueprint >= 0 && e.blueprint <= 1)) out.push(`${def.id}: an entry's blueprint chance is from 0 to 1`);
    }
  }
  return out;
}
