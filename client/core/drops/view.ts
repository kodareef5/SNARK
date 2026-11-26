// What the drop book's admin page shows of a book (planning/workstreams/supply.md, "The admin page"), worked out with
// the code the server rolls with (shared/supply): the tier by class matrix, a table opened to its slots, sets and
// entries, the list of what the book waits for, and a simulation's figures. Nothing here touches a page: client/drops
// draws what these give.

import { QUALITY_NAMES } from "../../../shared/sim/items.ts";
import { TIER_MARK, tableKey, type EntryDoc, type SupplyBook } from "../../../shared/supply/book.ts";
import { catalogFrom, withFuture, type Catalog, type CatalogItem } from "../../../shared/supply/catalog.ts";
import { compileBook, sourceTarget, sourceWorth, type Compiled } from "../../../shared/supply/compile.ts";
import { measure, type Cell } from "../../../shared/supply/measure.ts";
import { simulate, type SimStats } from "../../../shared/supply/simulate.ts";

/** The catalogue as the server sends it (server/admin/supply-routes.ts, catalog.json). */
export interface CatalogWire {
  items: CatalogItem[];
  renamed: [string, string[]][];
}

/** Rolls a table is measured by for the matrix: few, since forty-nine tables are measured three ways at once. */
export const MATRIX_ROLLS = 400;
/** How far from its target a table's mean may be before the matrix says so. */
export const OFF_TARGET = 0.15;

export interface Loaded {
  readonly book: SupplyBook;
  readonly catalog: Catalog;
  readonly cells: readonly Cell[];
  /** The book against what the game has, and against that and what it waits for. */
  readonly today: Compiled;
  readonly designed: Compiled;
  /**
   * This world's SupplyCrateLootQualityMultiplier, and the book compiled as its server compiles it (server/supply.ts
   * compiled). The matrix holds tables to their targets by the book alone; the simulator rolls what this world gives.
   */
  readonly quality: number;
  readonly world: { readonly today: Compiled; readonly designed: Compiled };
}

export function catalogOfWire(wire: CatalogWire): Catalog {
  return catalogFrom(wire.items, wire.renamed);
}

/** A book compiled and measured against a catalogue, for a world of the given quality multiplier. The book has no faults (bookFaults). */
export function load(book: SupplyBook, catalog: Catalog, rolls = MATRIX_ROLLS, quality = 1): Loaded {
  const measured = measure(book, catalog, rolls);
  const world = quality === 1 ? { today: measured.today, designed: measured.designed } : { today: compileBook(book, catalog, { quality }), designed: compileBook(book, withFuture(catalog, book), { quality }) };
  return { book, catalog, ...measured, quality, world };
}

/** A thing's name to show: the game's label, else ARK's name from the book's future list, else its id without its pack. */
export function nameOf(l: Pick<Loaded, "book" | "catalog">, id: string): string {
  return l.catalog.byId.get(id)?.label ?? l.book.future[id]?.ark ?? id.slice(id.indexOf(":") + 1).replace(/_/g, " ");
}

export type Health = "ok" | "lean" | "rich" | "dormant";

export interface MatrixCell {
  key: string;
  tier: string;
  cls: string;
  target: number;
  /** Mean worth as designed and today, the poorest roll as designed, and a ringed drop's mean over a plain one's. */
  designed: number;
  today: number;
  least: number;
  ringed: number;
  health: Health;
  /** Ids its sets name that the game cannot give. */
  waiting: number;
  stacks: number;
  jackpot: number;
}

/** The sets a table draws from, by key. */
export function setsOf(book: SupplyBook, key: string): string[] {
  const out = new Set<string>();
  for (const slot of book.tables[key]?.slots ?? []) for (const f of slot.from) out.add(f.set);
  return [...out];
}

/** The matrix: a row for each tier, a cell for each class, in the book's order. A pair with no table has no cell. */
export function matrix(l: Loaded): (MatrixCell | null)[][] {
  const byKey = new Map(l.cells.map((c) => [c.key, c]));
  return l.book.tiers.map((tier) =>
    l.book.classes.map((cls): MatrixCell | null => {
      const key = tableKey(tier.key, cls.key);
      const c = byKey.get(key);
      if (!c) return null;
      const sets = new Set(setsOf(l.book, key));
      const waiting = l.today.report.waiting.filter((w) => w.sets.some((s) => sets.has(s))).length;
      const off = c.designed.mean / c.target - 1;
      const health: Health = c.dormant ? "dormant" : off > OFF_TARGET ? "rich" : off < -OFF_TARGET ? "lean" : "ok";
      return { key, tier: tier.key, cls: cls.key, target: c.target, designed: c.designed.mean, today: c.today.mean, least: c.designed.min, ringed: c.designed.mean > 0 ? c.ringed.mean / c.designed.mean : 0, health, waiting, stacks: c.designed.stacksMost, jackpot: c.designed.jackpotShare };
    }),
  );
}

export interface EntryView {
  /** Its things: each one's id and name, and whether the game has it. */
  items: { id: string; name: string; has: boolean }[];
  min: number;
  max: number;
  /** "", "tier's quality", "quality 1.2 to 3", and "", "always a blueprint", "a blueprint 1 time in 5". */
  quality: string;
  blueprint: string;
  /** Its share of its set's draws, 0 to 1; 1 in a set that gives every entry. */
  share: number;
  /** One of its first thing at no quality, in the book's unit. */
  each: number;
  ballast: boolean;
  jackpot: boolean;
  /** None of its things is in the game: it has left the set. */
  gone: boolean;
}

export interface SetView {
  key: string;
  name: string;
  /** Its share of its slot's picks. */
  share: number;
  /** "every line", or "1 of 6", "1 to 2 of 9". */
  gives: string;
  entries: EntryView[];
}

export interface SlotView {
  name: string;
  chance: number;
  ringed: number;
  /** What a ringed drop multiplies its qualities by: the book's rule, or the slot's own where it has one. */
  ringedQuality: number;
  /** Whether that is the slot's own: said beside it, as it is not what the rest of the book does. */
  ownQuality: boolean;
  sets: SetView[];
}

const range = (min: number, max: number): string => (min === max ? String(min) : `${min} to ${max}`);

function entryView(l: Loaded, e: EntryDoc, total: number, all: boolean): EntryView {
  const items = e.items.map((id) => ({ id, name: nameOf(l, id), has: l.catalog.byId.has(id) && l.catalog.byId.get(id)!.never !== true }));
  const quality = e.quality === undefined ? "" : e.quality === "tier" ? "the tier's quality" : `quality ${range(e.quality[0], e.quality[1])}`;
  const blueprint = e.forceBlueprint ? "always a blueprint" : e.blueprint ? `a blueprint ${Math.round(e.blueprint * 100)} in 100` : "";
  return { items, min: e.min, max: e.max, quality, blueprint, share: all ? 1 : (e.weight ?? 1) / total, each: l.designed.worth.of(e.items[0]!), ballast: e.ballast === true, jackpot: e.jackpot === true, gone: items.every((i) => !i.has) };
}

/** A table opened: its slots in order, each slot's sets, each set's entries. */
export function tableDetail(l: Loaded, key: string): SlotView[] {
  const table = l.book.tables[key];
  if (!table) return [];
  return table.slots.map((slot, k): SlotView => {
    const weights = slot.from.reduce((n, f) => n + (f.weight ?? 1), 0);
    return {
      name: slot.name ?? `slot ${k + 1}`,
      chance: slot.chance ?? 1,
      ringed: slot.ringed ?? slot.chance ?? 1,
      ringedQuality: slot.ringedQuality ?? l.book.rules.ringedQuality,
      ownQuality: slot.ringedQuality !== undefined,
      sets: slot.from.map((f): SetView => {
        const set = l.book.sets[f.set];
        const entries = set?.entries ?? [];
        const total = entries.reduce((n, e) => n + (e.weight ?? 1), 0);
        const gives = !set ? "no such set" : set.all ? "every line" : `${range(set.min ?? 1, set.max ?? set.min ?? 1)} of ${entries.length}`;
        return { key: f.set, name: set?.name ?? f.set, share: (f.weight ?? 1) / weights, gives, entries: entries.map((e) => entryView(l, e, total, set?.all === true)) };
      }),
    };
  });
}

export interface WaitingRow {
  id: string;
  name: string;
  /** Why it waits, as compile says: the book's future list has it, nothing knows it, it was renamed, or loot may not hold it. */
  why: string;
  level: number;
  page: string;
  to: string[];
  sets: string[];
  /** The tables that would give it, and in the one that gives it oftenest, in how many drops of a hundred. */
  cells: string[];
  most: { key: string; share: number } | null;
}

/** What the book names that the game cannot give, each with where it would drop and how often as designed. */
export function waitingRows(l: Loaded): WaitingRow[] {
  const keys = Object.keys(l.book.tables);
  return l.today.report.waiting.map((w): WaitingRow => {
    const sets = new Set(w.sets);
    const cells = keys.filter((key) => setsOf(l.book, key).some((s) => sets.has(s)));
    let most: WaitingRow["most"] = null;
    for (const c of l.cells) {
      const got = c.designed.items.find((i) => i.id === w.id);
      const share = got ? got.rolls / c.designed.n : 0;
      if (share > (most?.share ?? 0)) most = { key: c.key, share };
    }
    const f = l.book.future[w.id];
    return { id: w.id, name: nameOf(l, w.id), why: w.why, level: f?.level ?? 0, page: f?.page ?? "", to: [...(w.to ?? [])], sets: [...w.sets], cells, most };
  });
}

export interface SimItemView {
  id: string;
  name: string;
  /** The share of rolls it came in, how many of it a roll that had it held, and the share of those rolls that gave a blueprint. */
  share: number;
  each: number;
  blueprint: number;
}

export interface SimView {
  target: number;
  stats: SimStats;
  /** Each figure over the target. */
  mean: number;
  least: number;
  most: number;
  items: SimItemView[];
  /** A quality tier's name and its share of what was drawn from a band, for the tiers that came. */
  quality: { name: string; share: number }[];
  /** The histogram's bars as shares of the tallest, and what the first and last bar stand at. */
  bars: number[];
  from: number;
  to: number;
}

/**
 * A table rolled `n` times as this world's server rolls it: `designed` counts what the book waits for, `fill` is a
 * dormant table opened by an admin, and `world` false leaves out the world's quality multiplier, for the book alone.
 */
export function simulation(l: Loaded, key: string, ringed: boolean, n: number, seed: number, designed = false, fill = false, world = true): SimView | null {
  const from = world ? l.world : l;
  const compiled = designed ? from.designed : from.today;
  const table = compiled.tables.get(key);
  if (!table) return null;
  const stats = simulate(compiled, table, ringed, Math.max(1, Math.min(200000, Math.floor(n))), seed, fill);
  const target = l.book.tiers[table.tier]?.target ?? 0;
  const tallest = Math.max(1, ...stats.histogram);
  return {
    target,
    stats,
    mean: target > 0 ? stats.mean / target : 0,
    least: target > 0 ? stats.min / target : 0,
    most: target > 0 ? stats.max / target : 0,
    items: [...stats.items].sort((a, b) => b.rolls - a.rolls || (a.id < b.id ? -1 : 1)).map((i) => ({ id: i.id, name: nameOf(l, i.id), share: i.rolls / stats.n, each: i.rolls > 0 ? i.count / i.rolls : 0, blueprint: i.rolls > 0 ? i.blueprints / i.rolls : 0 })),
    quality: stats.quality.map((share, k) => ({ name: QUALITY_NAMES[k] ?? String(k), share })).filter((q) => q.share > 0),
    bars: stats.histogram.map((b) => b / tallest),
    from: stats.min,
    to: stats.max,
  };
}

/** A whole number with a thin space at each thousand, as the page writes worths. */
export function num(v: number): string {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A share as hundredths: "42%", and "under 1%" for what is there and would round to none. */
export function pct(share: number): string {
  if (share > 0 && share < 0.005) return "under 1%";
  return `${Math.round(share * 100)}%`;
}

/** A tier's colour as CSS. */
export function css(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}

export interface SourceTier {
  readonly key: string;
  readonly name: string;
  readonly rgb: number;
  /** What one such thing gets on average, those that get nothing counted, and what the source is balanced to. */
  readonly worth: number;
  readonly target: number | null;
  readonly health: Health;
}

export interface SourceRow {
  readonly key: string;
  readonly on: boolean;
  /** "any body", "a large body", "the body of a rex, level 100 to 150". */
  readonly what: string;
  /** "arms prize, armour prize" or "body/scraps". */
  readonly tables: string;
  /** Every tier it rolls at, lowest first; one with no name for a source of no tier. */
  readonly tiers: readonly SourceTier[];
}

/** How far a source's worth may be from its target at one tier and still be sound: tables differ more by tier than a whole drop does. */
export const SOURCE_OFF_TARGET = 0.35;

/** Each source of the book: what it is the loot of, what it rolls, and its worth against its target at every tier it rolls at. */
export function sourceRows(l: Loaded): SourceRow[] {
  const { book } = l;
  return (book.sources ?? []).map((s) => {
    const w = s.when ?? {};
    const of = w.species?.length ? `of a ${w.species.map((id) => nameOf(l, id)).join(" or a ")}` : "";
    const size = w.size?.length ? `${w.size.join(" or ")} ` : "";
    const level = w.level ? `, level ${w.level[0]} to ${w.level[1]}` : "";
    const what = w.species?.length ? `the ${size}body ${of}${level}` : `${size === "" ? "any" : /^[aeiou]/.test(size) ? `an ${size.trim()}` : `a ${size.trim()}`} body${level}`;
    const tables = s.tables.map((t) => `${t.table.replace(`${TIER_MARK}/`, "")}${t.slots ? ` ${t.slots.join(" and ")}` : ""}`).join(", ");
    const keys = s.tier !== undefined ? [...new Set([s.tier, ...(s.ladder ?? []).map((step) => step.tier)])] : [""];
    const tiers = keys.map((key): SourceTier => {
      const tier = book.tiers.find((t) => t.key === key);
      const worth = sourceWorth(l.designed, s, key);
      const target = sourceTarget(book, s, key);
      const health: Health = target === null || target === 0 ? "ok" : worth < target * (1 - SOURCE_OFF_TARGET) ? "lean" : worth > target * (1 + SOURCE_OFF_TARGET) ? "rich" : "ok";
      return { key, name: tier?.name ?? "", rgb: tier?.rgb ?? 0x888888, worth, target, health };
    });
    return { key: s.key, on: s.on, what, tables, tiers };
  });
}
