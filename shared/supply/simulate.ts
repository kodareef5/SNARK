// Many seeded rolls of one table, and what they came to: the figures the balance tests hold the starter book to, the
// `bun run supply` report prints and the admin page's simulator shows, all from this one function.

import { Rng } from "../rng.ts";
import { QUALITY_RATING } from "../sim/items.ts";
import type { LootDrop } from "../sim/loot.ts";
import { CAPSULE_SLOTS } from "./book.ts";
import { rollTable, type Compiled, type CompiledTable } from "./compile.ts";

export interface SimItem {
  readonly id: string;
  /** Rolls it came in, how many of it in all, and how many of those rolls gave it as a blueprint. */
  readonly rolls: number;
  readonly count: number;
  readonly blueprints: number;
}

export interface SimStats {
  readonly n: number;
  /** Worth of a roll, jackpots apart: its mean, its least, its 5th, 50th and 95th hundredths and its most. */
  readonly mean: number;
  readonly min: number;
  readonly p5: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  /** Mean worth of the jackpots, and the share of rolls that held one. */
  readonly jackpotMean: number;
  readonly jackpotShare: number;
  /** Twenty bars from the least to the most. */
  readonly histogram: readonly number[];
  readonly items: readonly SimItem[];
  /** Of things drawn from a quality band, the share at each tier; and the share of all things that were blueprints. */
  readonly quality: readonly number[];
  readonly blueprintShare: number;
  /** The most stacks one roll needed, against the capsule's slots. */
  readonly stacksMost: number;
  readonly empty: number;
}

/** How many slots `drops` take: a blueprint lies alone, and a thing takes a stack for each `stack` of it. */
export function stacksOf(drops: readonly LootDrop[], compiled: Compiled): number {
  const whole = new Map<string, number>();
  let n = 0;
  for (const d of drops) {
    if (d.blueprint) n++;
    else whole.set(`${d.item}/${d.quality}`, (whole.get(`${d.item}/${d.quality}`) ?? 0) + d.count);
  }
  for (const [key, count] of whole) n += Math.ceil(count / (compiled.catalog.byIndex[Number(key.slice(0, key.indexOf("/")))]?.stack ?? 1));
  return n;
}

/** Rolls `table` `n` times from `seed` and measures what came. */
export function simulate(compiled: Compiled, table: CompiledTable, ringed: boolean, n: number, seed: number, fill = false): SimStats {
  const { catalog, worth, book } = compiled;
  const gate = table.tier >= 0 ? book.tiers[table.tier]!.level : 0;
  const jackpots = new Set(table.jackpots);
  const worths = new Float64Array(n);
  const items = new Map<number, { rolls: number; count: number; blueprints: number }>();
  const quality = new Array<number>(QUALITY_RATING.length).fill(0);
  let qualified = 0;
  let things = 0;
  let blueprints = 0;
  let jackpotSum = 0;
  let jackpotRolls = 0;
  let stacksMost = 0;
  let empty = 0;
  for (let k = 0; k < n; k++) {
    // Each roll has a generator of its own, as each drop has a seed of its own.
    const drops = rollTable(table, ringed, new Rng((seed + Math.imul(k, 0x9e3779b1)) >>> 0), catalog, fill);
    if (drops.length === 0) empty++;
    let w = 0;
    let jack = 0;
    const seen = new Set<number>();
    for (const d of drops) {
      const item = catalog.byIndex[d.item]!;
      const each = worth.drop(item.id, d.count, d.quality, d.blueprint, gate);
      if (jackpots.has(d.item)) jack += each;
      else w += each;
      const tally = items.get(d.item) ?? { rolls: 0, count: 0, blueprints: 0 };
      if (!seen.has(d.item)) tally.rolls++;
      seen.add(d.item);
      tally.count += d.count;
      if (d.blueprint) tally.blueprints++;
      items.set(d.item, tally);
      things++;
      if (d.blueprint) blueprints++;
      // A thing drawn with a quality band carries the rating drawn, whatever tier that came to.
      if (item.quality && d.rating > 0) {
        quality[d.quality] = quality[d.quality]! + 1;
        qualified++;
      }
    }
    worths[k] = w;
    if (jack > 0) {
      jackpotSum += jack;
      jackpotRolls++;
    }
    const stacks = stacksOf(drops, compiled);
    if (stacks > stacksMost) stacksMost = stacks;
  }
  const sorted = Float64Array.from(worths).sort();
  const at = (share: number): number => (n === 0 ? 0 : sorted[Math.min(n - 1, Math.floor(share * n))]!);
  let sum = 0;
  for (const w of worths) sum += w;
  const lo = n === 0 ? 0 : sorted[0]!;
  const hi = n === 0 ? 0 : sorted[n - 1]!;
  const histogram = new Array<number>(20).fill(0);
  for (const w of worths) histogram[hi > lo ? Math.min(19, Math.floor(((w - lo) / (hi - lo)) * 20)) : 0]!++;
  return {
    n,
    mean: n === 0 ? 0 : sum / n,
    min: lo,
    p5: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    max: hi,
    jackpotMean: n === 0 ? 0 : jackpotSum / n,
    jackpotShare: n === 0 ? 0 : jackpotRolls / n,
    histogram,
    items: [...items].map(([index, t]) => ({ id: catalog.byIndex[index]!.id, ...t })).sort((a, b) => b.rolls - a.rolls || (a.id < b.id ? -1 : 1)),
    quality: quality.map((q) => (qualified === 0 ? 0 : q / qualified)),
    blueprintShare: things === 0 ? 0 : blueprints / things,
    stacksMost,
    empty,
  };
}

/** Whether a roll's stacks fit the capsule. */
export const fitsCapsule = (stats: SimStats): boolean => stats.stacksMost <= CAPSULE_SLOTS;
