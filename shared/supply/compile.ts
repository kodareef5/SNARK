// A drop book made ready to roll against the items the game has, forgivingly (planning/workstreams/supply.md): an id
// the game lacks leaves its entry and is listed as waiting, an entry with no item leaves its set, a set with no entry
// leaves its slot, and a table left too thin of its own goes dormant, to be topped up from its class's materials when
// an admin opens it anyway. Nothing here throws on a book that passed bookFaults, and a roll never comes back empty
// while the tier's floor holds anything.

import type { LootDef, LootEntry, LootSet } from "../content/defs.ts";
import type { Rng } from "../rng.ts";
import { MOST_LOOT, rollLoot, type LootDrop } from "../sim/loot.ts";
import { TIER_MARK, tableKey, type BookFault, type CircuitDoc, type EntryDoc, type SetDoc, type SourceDoc, type SourceKind, type SourceTable, type SupplyBook, type TableDoc } from "./book.ts";
import type { Catalog, CatalogItem } from "./catalog.ts";
import { Worth, tierMix } from "./worth.ts";

/** One part of a table, ready: its chance, and the loot definition its sets make of what the game has. */
export interface CompiledSlot {
  readonly name: string;
  readonly chance: number;
  readonly def: LootDef;
  /** What it is expected to give, its chance counted and jackpots apart. */
  readonly worth: number;
}

export interface CompiledTable {
  readonly key: string;
  /** Indices into the book's tiers and classes, -1 for a table of neither. */
  readonly tier: number;
  readonly cls: number;
  readonly plain: readonly CompiledSlot[];
  readonly ringed: readonly CompiledSlot[];
  /** The tier's floor, given when a roll gave nothing. */
  readonly floor: LootDef | null;
  /** The class's own materials, in the measure that brings a thin table to the floor share. */
  readonly fill: LootDef | null;
  /** What a plain and a ringed roll are expected to be worth with the items the game has, jackpots apart. */
  readonly worth: number;
  readonly ringedWorth: number;
  readonly jackpot: number;
  /** Its own worth is under the floor share of its tier's target: circuits pass it over. Never, for a table held to no floor. */
  readonly dormant: boolean;
  /** Content indices of its jackpot items. */
  readonly jackpots: readonly number[];
}

/** An id a book names that the game cannot give. */
export interface Waiting {
  readonly id: string;
  /** "future": the book says what it will be. "unknown": it says nothing of it. "renamed": the game calls it something else now. "never": loot may not mint it. */
  readonly why: "future" | "unknown" | "renamed" | "never";
  readonly to?: readonly string[];
  /** The sets that name it. */
  readonly sets: readonly string[];
}

export interface CompileReport {
  readonly waiting: readonly Waiting[];
  /** Sets with nothing the game has, and slots left with no set. */
  readonly emptySets: readonly string[];
  readonly emptySlots: readonly string[];
  readonly dormant: readonly string[];
  /** Things a book may be saved with but should hear of. */
  readonly lints: readonly BookFault[];
}

export interface Compiled {
  readonly book: SupplyBook;
  readonly catalog: Catalog;
  readonly worth: Worth;
  readonly tables: ReadonlyMap<string, CompiledTable>;
  readonly report: CompileReport;
}

export interface CompileOptions {
  /** What every quality band is multiplied by: ARK's SupplyCrateLootQualityMultiplier, and difficulty where it is cited. */
  readonly quality?: number;
}

/** Compiles `book` against `catalog`. The book has passed bookFaults. */
export function compileBook(book: SupplyBook, catalog: Catalog, opts: CompileOptions = {}): Compiled {
  const worth = new Worth(book, catalog);
  const waiting = new Map<string, { why: Waiting["why"]; to?: string[]; sets: Set<string> }>();
  const lints: BookFault[] = [];
  const emptySets = new Set<string>();
  const emptySlots: string[] = [];
  const tierIndex = new Map(book.tiers.map((t, i) => [t.key, i]));
  const classIndex = new Map(book.classes.map((c, i) => [c.key, i]));
  const server = opts.quality ?? 1;

  /** The item an id means now, or null with the reason noted. */
  const resolve = (id: string, set: string): CatalogItem | null => {
    const note = (why: Waiting["why"], to?: string[]): null => {
      const w = waiting.get(id) ?? { why, ...(to ? { to } : {}), sets: new Set<string>() };
      w.sets.add(set);
      waiting.set(id, w);
      return null;
    };
    const item = catalog.byId.get(id);
    if (item) return item.never ? note("never") : item;
    const now = catalog.renamed.get(id);
    if (now) {
      const only = now.length === 1 ? catalog.byId.get(now[0]!) : undefined;
      note("renamed", now);
      return only && !only.never ? only : null;
    }
    return note(Object.hasOwn(book.future, id) ? "future" : "unknown");
  };

  /** An entry with what of it the game has, its quality band settled. Null with nothing. */
  const entryOf = (e: EntryDoc, set: string, at: number, band: readonly [number, number] | null, mult: number): LootEntry | null => {
    const items: string[] = [];
    const weights: number[] = [];
    let plain = 0;
    let unprintable = 0;
    e.items.forEach((id, i) => {
      const item = resolve(id, set);
      if (!item) return;
      items.push(item.id);
      weights.push(e.weights ? e.weights[i]! : 1);
      if (!item.quality) plain++;
      if (!item.blueprint) unprintable++;
    });
    if (items.length === 0) return null;
    const path = `sets.${set}.entries.${at}`;
    if (e.quality !== undefined && plain > 0) lints.push({ path, warn: true, message: `quality does nothing for ${plain === items.length ? "these items" : "some of these items"}: it is left off them` });
    if (((e.blueprint ?? 0) > 0 || e.forceBlueprint) && unprintable > 0 && !e.jackpot) lints.push({ path, warn: true, message: "an item here has no blueprint: it comes as itself" });
    const q = e.quality === "tier" ? band : (e.quality ?? null);
    return {
      items,
      ...(e.weights ? { weights } : {}),
      ...(e.weight !== undefined ? { weight: e.weight } : {}),
      min: e.min,
      max: e.max,
      ...(q && plain < items.length ? { quality: [q[0] * mult, q[1] * mult] as const } : {}),
      ...(e.blueprint !== undefined ? { blueprint: e.blueprint } : {}),
      ...(e.forceBlueprint ? { forceBlueprint: true } : {}),
      ...(e.chance !== undefined ? { chance: e.chance } : {}),
    };
  };

  /** A set with what of it the game has, for a table of tier `tier`. Null with nothing. */
  const setOf = (key: string, tier: number, mult: number, scale = 1): { set: LootSet; doc: SetDoc; entries: EntryDoc[] } | null => {
    const doc = book.sets[key];
    if (!doc) return null;
    const own = doc.tier !== undefined ? (tierIndex.get(doc.tier) ?? tier) : tier;
    const band = own >= 0 ? book.tiers[own]!.quality : null;
    const entries: LootEntry[] = [];
    const docs: EntryDoc[] = [];
    doc.entries.forEach((e, i) => {
      const made = entryOf(e, key, i, band, mult);
      if (!made) return;
      entries.push(scale === 1 ? made : { ...made, min: Math.min(MOST_LOOT, Math.ceil(made.min * scale)), max: Math.min(MOST_LOOT, Math.ceil(made.max * scale)) });
      docs.push(e);
    });
    if (entries.length === 0) {
      emptySets.add(key);
      return null;
    }
    const n = entries.length;
    const count = doc.all ? { min: n, max: n } : { min: Math.min(doc.min ?? 1, n), max: doc.replace ? (doc.max ?? 1) : Math.min(doc.max ?? 1, n), ...(doc.power !== undefined ? { power: doc.power } : {}), ...(doc.replace ? { replace: true } : {}) };
    return { set: { ...count, entries }, doc, entries: docs };
  };

  /** What an entry is expected to be worth, and what of that is a jackpot's. */
  const entryWorth = (e: LootEntry, doc: EntryDoc, gate: number, jackpots: Set<number>): [number, number] => {
    const total = (e.weights ?? e.items.map(() => 1)).reduce((a, b) => a + b, 0);
    if (!(total > 0)) return [0, 0];
    const mix = e.quality ? tierMix(e.quality[0], e.quality[1]) : [1];
    const count = (e.min + e.max) / 2;
    let w = 0;
    e.items.forEach((id, i) => {
      const item = catalog.byId.get(id)!;
      const share = (e.weights ? e.weights[i]! : 1) / total;
      const bp = item.blueprint ? (e.forceBlueprint ? 1 : (e.blueprint ?? 0)) : 0;
      let each = 0;
      mix.forEach((p, q) => {
        if (p === 0) return;
        const tier = item.quality ? q : 0;
        each += p * ((1 - bp) * count * worth.at(id, tier) + bp * worth.blueprint(id, tier, gate));
      });
      w += share * each;
      if (doc.jackpot) jackpots.add(item.index);
    });
    w *= e.chance ?? 1;
    return doc.jackpot ? [0, w] : [w, 0];
  };
  const setWorth = (s: { set: LootSet; entries: EntryDoc[] }, gate: number, jackpots: Set<number>): [number, number] => {
    let sum = 0;
    let jack = 0;
    let weights = 0;
    s.set.entries.forEach((e, i) => {
      const [w, j] = entryWorth(e, s.entries[i]!, gate, jackpots);
      const weight = s.set.min === s.set.entries.length && s.set.max === s.set.entries.length ? 1 : (e.weight ?? 1);
      sum += w * weight;
      jack += j * weight;
      weights += weight;
    });
    const n = s.set.entries.length;
    if (s.set.min === n && s.set.max === n) return [sum, jack];
    const drawn = Math.min((s.set.min + s.set.max) / 2, s.set.replace ? Infinity : n);
    return weights > 0 ? [(sum / weights) * drawn, (jack / weights) * drawn] : [0, 0];
  };

  /** The least a set can give, at no quality: its fewest entries, each at its least count of its cheapest item. */
  const setLeast = (set: LootSet): number => {
    const least = set.entries.map((e) => (e.chance !== undefined && e.chance < 1 ? 0 : e.min * Math.min(...e.items.map((id) => worth.of(id))))).sort((a, b) => a - b);
    let sum = 0;
    for (let k = 0; k < Math.min(set.min, least.length); k++) sum += least[k]!;
    return sum;
  };

  const tables = new Map<string, CompiledTable>();
  const dormant: string[] = [];
  for (const [key, t] of Object.entries(book.tables) as [string, TableDoc][]) {
    const tier = t.tier !== undefined ? (tierIndex.get(t.tier) ?? -1) : -1;
    const cls = t.cls !== undefined ? (classIndex.get(t.cls) ?? -1) : -1;
    const gate = tier >= 0 ? book.tiers[tier]!.level : 0;
    const jackpots = new Set<number>();
    const variant = (ringed: boolean): [CompiledSlot[], number, number] => {
      const slots: CompiledSlot[] = [];
      let total = 0;
      let jack = 0;
      t.slots.forEach((slot, i) => {
        const chance = ringed ? (slot.ringed ?? slot.chance ?? 1) : (slot.chance ?? 1);
        if (!(chance > 0)) return;
        const from: LootSet[] = [];
        let sum = 0;
        let jsum = 0;
        let weights = 0;
        for (const f of slot.from) {
          const made = setOf(f.set, tier, server * (ringed ? (slot.ringedQuality ?? book.rules.ringedQuality) : 1));
          if (!made) continue;
          const weight = f.weight ?? 1;
          from.push({ ...made.set, weight });
          const [w, j] = setWorth(made, gate, jackpots);
          sum += w * weight;
          jsum += j * weight;
          weights += weight;
        }
        if (from.length === 0) {
          if (!ringed) emptySlots.push(`tables.${key}.slots.${i}`);
          return;
        }
        const pick = slot.pick ?? { min: 1, max: 1 };
        const drawn = Math.min((pick.min + pick.max) / 2, pick.replace ? Infinity : from.length);
        const own = weights > 0 ? chance * drawn * (sum / weights) : 0;
        total += own;
        if (weights > 0) jack += chance * drawn * (jsum / weights);
        slots.push({ name: slot.name ?? `slot ${i + 1}`, chance, def: { type: "loot", id: `${key}#${i}`, sets: pick, from }, worth: own });
      });
      return [slots, total, jack];
    };
    const [plain, own, jackpot] = variant(false);
    const [ringed, ringedWorth] = variant(true);
    const tierDoc = tier >= 0 ? book.tiers[tier]! : null;
    const floorSet = tierDoc ? setOf(tierDoc.floor, tier, server) : null;
    const want = tierDoc ? tierDoc.target * book.rules.floorShare : 0;
    // A table held to no floor (ARK's own, as pasted) is what it is: never dormant, and so never topped up.
    const isDormant = tierDoc !== null && t.noFloor !== true && own < want;
    let fill: LootDef | null = null;
    if (isDormant && cls >= 0) {
      // Sized by the least the fill can give, so that the poorest roll of a topped-up table reaches the floor share.
      const base = setOf(book.classes[cls]!.fill, tier, server);
      const each = base ? setLeast(base.set) : 0;
      if (base && each > 0) {
        const scaled = setOf(book.classes[cls]!.fill, tier, server, Math.max(1, want / each))!;
        fill = { type: "loot", id: `${key}#fill`, from: [scaled.set] };
      }
      dormant.push(key);
    }
    tables.set(key, { key, tier, cls, plain, ringed, floor: floorSet ? { type: "loot", id: `${key}#floor`, from: [floorSet.set] } : null, fill, worth: own, ringedWorth, jackpot, dormant: isDormant, jackpots: [...jackpots] });
  }
  const report: CompileReport = {
    waiting: [...waiting].map(([id, w]) => ({ id, why: w.why, ...(w.to ? { to: w.to } : {}), sets: [...w.sets].sort() })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    emptySets: [...emptySets].sort(),
    emptySlots,
    dormant,
    lints: lints.filter((l, i) => lints.findIndex((o) => o.path === l.path && o.message === l.message) === i),
  };
  return { book, catalog, worth, tables, report };
}

/**
 * Rolls a table: each slot by its chance, in order. `fill` adds the class's top-up, as an admin's test of a dormant
 * table does. A roll that gave nothing is given the tier's floor. Quality is left off what it does nothing for.
 */
export function rollTable(t: CompiledTable, ringed: boolean, rng: Rng, catalog: Catalog, fill = false): LootDrop[] {
  const index = (id: string): number => catalog.byId.get(id)?.index ?? 0;
  const out: LootDrop[] = [];
  const take = (def: LootDef): void => {
    for (const d of rollLoot(def, rng, index, catalog.blueprints)) out.push(catalog.byIndex[d.item]?.quality ? d : { ...d, quality: 0, rating: 0 });
  };
  for (const slot of ringed ? t.ringed : t.plain) {
    // A sure slot is not drawn for, so making one sure does not move the rolls of the slots after it.
    if (slot.chance < 1 && !(rng.float() < slot.chance)) continue;
    take(slot.def);
  }
  if (fill && t.fill) take(t.fill);
  if (out.length === 0 && t.floor) take(t.floor);
  return out;
}

/** A thing loot may lie in, as a source's filter reads it. */
export interface Thing {
  readonly kind: SourceKind;
  readonly species?: string;
  readonly size?: string;
  readonly level?: number;
}

/** Whether `source` is the loot of `thing`, switched on or not. */
export function matches(source: SourceDoc, thing: Thing): boolean {
  if (source.kind !== thing.kind) return false;
  const w = source.when;
  if (!w) return true;
  if (w.species && !(thing.species !== undefined && w.species.includes(thing.species))) return false;
  if (w.size && !(thing.size !== undefined && w.size.includes(thing.size))) return false;
  if (w.level && !(thing.level !== undefined && thing.level >= w.level[0] && thing.level <= w.level[1])) return false;
  return true;
}

/** The key of the tier `source` rolls at for a thing of `level`: the last step of its ladder reached, or its own. "" for none. */
export function tierOf(source: SourceDoc, level = 0): string {
  let tier = source.tier ?? "";
  for (const step of source.ladder ?? []) if (level >= step.level) tier = step.tier;
  return tier;
}

/** The slots of `ref` at `tier` that the game can roll. None for a table the book has not, or a slot it does not name. */
function slotsOf(compiled: Compiled, ref: SourceTable, tier: string): readonly CompiledSlot[] {
  const table = compiled.tables.get(ref.table.replace(TIER_MARK, tier));
  if (!table) return [];
  return ref.slots ? table.plain.filter((s) => ref.slots!.includes(s.name)) : table.plain;
}

/**
 * Rolls `source` at `tier` for one thing: by its chance, its count of rolls, each a table drawn by weight and that
 * table's slots in order. Nothing is a fair answer. `chance` multiplies the source's own (a server's setting).
 */
export function rollSource(compiled: Compiled, source: SourceDoc, tier: string, rng: Rng, chance = 1): LootDrop[] {
  const { catalog } = compiled;
  const out: LootDrop[] = [];
  const p = (source.chance ?? 1) * chance;
  if (p < 1 && !(rng.float() < p)) return out;
  const refs = source.tables.map((ref) => ({ slots: slotsOf(compiled, ref, tier), weight: ref.weight ?? 1 })).filter((r) => r.slots.length > 0 && r.weight > 0);
  const total = refs.reduce((sum, r) => sum + r.weight, 0);
  if (!(total > 0)) return out;
  const [least, most] = source.rolls ?? [1, 1];
  const index = (id: string): number => catalog.byId.get(id)?.index ?? 0;
  for (let n = least + (most > least ? rng.int(most - least + 1) : 0); n > 0; n--) {
    let at = rng.float() * total;
    const ref = refs.find((r) => (at -= r.weight) < 0) ?? refs[refs.length - 1]!;
    for (const slot of ref.slots) {
      if (slot.chance < 1 && !(rng.float() < slot.chance)) continue;
      for (const d of rollLoot(slot.def, rng, index, catalog.blueprints)) out.push(catalog.byIndex[d.item]?.quality ? d : { ...d, quality: 0, rating: 0 });
    }
  }
  return out;
}

/** What `source` is expected to give one thing at `tier`, those that get nothing counted and jackpots apart. */
export function sourceWorth(compiled: Compiled, source: SourceDoc, tier: string): number {
  const refs = source.tables.map((ref) => ({ slots: slotsOf(compiled, ref, tier), weight: ref.weight ?? 1 })).filter((r) => r.slots.length > 0 && r.weight > 0);
  const total = refs.reduce((sum, r) => sum + r.weight, 0);
  if (!(total > 0)) return 0;
  const [least, most] = source.rolls ?? [1, 1];
  const each = refs.reduce((sum, r) => sum + r.weight * r.slots.reduce((w, s) => w + s.worth, 0), 0) / total;
  return (source.chance ?? 1) * ((least + most) / 2) * each;
}

/** What `source` is balanced to give at `tier`: its share of the tier's target, or its own target. Null where it says neither. */
export function sourceTarget(book: SupplyBook, source: SourceDoc, tier: string): number | null {
  if (source.share !== undefined) {
    const t = book.tiers.find((v) => v.key === tier);
    return t ? t.target * source.share : null;
  }
  return source.target ?? null;
}

/**
 * The tiers and classes a circuit may call now, each with its weight: the circuit's tier weight times its class weight
 * times the class's own weight at that tier, over the tables that are not dormant.
 */
export function cellsOf(compiled: Compiled, circuit: CircuitDoc): { table: CompiledTable; weight: number }[] {
  const out: { table: CompiledTable; weight: number }[] = [];
  const { book } = compiled;
  for (const tier of book.tiers) {
    const tw = circuit.tierWeights[tier.key] ?? 0;
    if (!(tw > 0)) continue;
    for (const cls of book.classes) {
      const weight = tw * (circuit.classWeights?.[cls.key] ?? 1) * (cls.weights?.[tier.key] ?? 1);
      const table = compiled.tables.get(tableKey(tier.key, cls.key));
      if (table && !table.dormant && weight > 0) out.push({ table, weight });
    }
  }
  return out;
}
