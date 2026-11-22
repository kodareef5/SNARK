// What things are worth, in the book's unit, so that tiers and classes can be balanced against a number
// (planning/workstreams/supply.md, "Balance has a unit"). An item is worth its recipe in raw resources, each weighted by
// how hard it is to come by; quality costs what crafting at that quality costs; a blueprint is worth a share of its
// item. None of this touches the game: it is how a book is judged, by the tools, the tests and the admin page.

import { QUALITY_RATING, blueprintCost } from "../sim/items.ts";
import type { SupplyBook } from "./book.ts";
import type { Catalog } from "./catalog.ts";

/** A blueprint of no quality: half its item if its engram is past the gate (it is ahead of its finder), a tenth if not. */
export const BLUEPRINT_AHEAD = 0.5;
export const BLUEPRINT_BEHIND = 0.1;
/** A blueprint with quality is worth this many of the item at that quality: it makes them for ever. */
export const BLUEPRINT_QUALITY = 2;

export class Worth {
  private readonly memo = new Map<string, number>();
  private readonly book: SupplyBook;
  private readonly catalog: Catalog;

  constructor(book: SupplyBook, catalog: Catalog) {
    this.book = book;
    this.catalog = catalog;
  }

  /** One of `id` at no quality. 0 for what nothing says the worth of. */
  of(id: string, depth = 0): number {
    const known = this.memo.get(id);
    if (known !== undefined) return known;
    let w = 0;
    const said = this.book.worth.items[id] ?? this.book.worth.raw[id];
    const item = this.catalog.byId.get(id);
    const future = this.book.future[id];
    if (said !== undefined) w = said;
    else if (item?.needs && depth < 12) {
      for (const [need, n] of item.needs) w += this.of(need, depth + 1) * n;
      w /= item.makes ?? 1;
    } else if (future) w = future.worth ?? (future.like !== undefined && depth < 12 ? this.of(future.like, depth + 1) * (future.scale ?? 1) : 0);
    this.memo.set(id, w);
    return w;
  }

  /** One of `id` at quality tier `q`: what crafting it at that quality takes, where quality changes what it does. */
  at(id: string, q: number): number {
    const item = this.catalog.byId.get(id);
    if (q <= 0 || !item?.quality) return this.of(id);
    if (!item.needs || this.book.worth.items[id] !== undefined) return this.of(id) * blueprintCost(1000, q) / 1000;
    let w = 0;
    for (const [need, n] of item.needs) w += this.of(need) * blueprintCost(n, q);
    return w / (item.makes ?? 1);
  }

  /** A blueprint of `id` at quality tier `q`, found behind a gate of level `gate`. */
  blueprint(id: string, q: number, gate: number): number {
    if (q > 0 && this.catalog.byId.get(id)?.quality) return BLUEPRINT_QUALITY * this.at(id, q);
    const level = this.catalog.byId.get(id)?.level ?? this.book.future[id]?.level ?? 0;
    return (level > gate ? BLUEPRINT_AHEAD : BLUEPRINT_BEHIND) * this.of(id);
  }

  /** What a roll gave of one thing. */
  drop(id: string, count: number, q: number, blueprint: boolean, gate: number): number {
    return blueprint ? this.blueprint(id, q, gate) : this.at(id, q) * count;
  }
}

/**
 * The share of ratings drawn evenly from `lo` to `hi` that fall in each quality tier: a rating's tier is the highest
 * whose threshold it reaches (shared/sim/items.ts qualityOfRating), and anything under the second is primitive.
 */
export function tierMix(lo: number, hi: number): number[] {
  const n = QUALITY_RATING.length;
  const out = new Array<number>(n).fill(0);
  if (!(hi > lo)) {
    let t = 0;
    for (let k = 1; k < n; k++) if (lo >= QUALITY_RATING[k]!) t = k;
    out[t] = 1;
    return out;
  }
  for (let t = 0; t < n; t++) {
    const from = t === 0 ? -Infinity : QUALITY_RATING[t]!;
    const to = t === n - 1 ? Infinity : QUALITY_RATING[t + 1]!;
    out[t] = Math.max(0, Math.min(hi, to) - Math.max(lo, from)) / (hi - lo);
  }
  return out;
}
