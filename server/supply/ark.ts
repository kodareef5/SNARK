// ARK's own way of saying what a supply drop holds: ConfigOverrideSupplyCrateItems, one entry a crate, as an operator
// who brings a Game.ini from an ARK server has it. An entry is read into a loot table (shared/content/defs.ts LootDef,
// whose fields were ARK's to begin with) for the tier its crate is, and that table wins over the drop book's for every
// class of the tier, as ARK's replaces the crate's own. What it names that this build lacks is told, never an error.
//
//   ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level03_C",MinItemSets=1,MaxItemSets=2,
//     NumItemSetsPower=1.0,bSetsRandomWithoutReplacement=true,ItemSets=((MinNumItems=1,MaxNumItems=2,NumItemsPower=1.0,
//     SetWeight=1.0,bItemsRandomWithoutReplacement=true,ItemEntries=((EntryWeight=1.0,ItemClassStrings=("core:bow"),
//     ItemsWeights=(1.0),MinQuantity=1,MaxQuantity=1,MinQuality=1.0,MaxQuality=2.0,bForceBlueprint=false,
//     ChanceToBeBlueprintOverride=0.25)))))

import type { LootCount, LootDef, LootEntry, LootSet } from "../../shared/content/defs.ts";
import { MOST_LOOT, POWER_MOST, POWER_STEPS, lootFaults } from "../../shared/sim/loot.ts";
import type { ClassDoc, SetDoc, SlotDoc, TableDoc, TierDoc } from "../../shared/supply/book.ts";
import { field, isList, toNumber, toSwitch, unquote, type IniList, type IniNode } from "../settings/ini.ts";

export const SETTING = "ConfigOverrideSupplyCrateItems";

/** A tier's tables as ARK's override gives them: for a plain drop, for a ringed one (ARK's `_Double` crate), or both. */
export interface ArkTables {
  plain?: LootDef;
  ringed?: LootDef;
}

export interface ArkCrates {
  /** By tier key. */
  readonly tables: Map<string, ArkTables>;
  /** What was asked that could not be done, a line each. */
  readonly passed: string[];
}

const words = (n: IniNode | undefined): string => (typeof n === "string" ? unquote(n) : "");
const number = (n: IniNode | undefined): number => (typeof n === "string" ? toNumber(n) : NaN);
const flag = (n: IniNode | undefined): boolean | null => (typeof n === "string" ? toSwitch(n) : null);
const items = (n: IniNode | undefined): readonly IniNode[] => (isList(n) ? n.items.map((i) => i.value) : []);

/**
 * The tier a crate of ARK's is here: the highest whose level its own reaches (`SupplyCrate_Level25_C` is the tier that
 * opens at 25, and Scorched Earth's `Level30` is too), and whether it is ARK's ringed crate. Null for a crate that is
 * no supply drop: a cave's, the deep sea's, a boss's.
 */
export function crateTier(name: string, tiers: readonly TierDoc[]): { tier: TierDoc; ringed: boolean } | null {
  const m = /^SupplyCrate_Level(\d+)(?:_[A-Za-z0-9]+)*?(_Double)?(?:_[A-Za-z0-9]+)*?(?:_C)?$/i.exec(name.trim());
  if (!m) return null;
  const level = Number(m[1]);
  let best: TierDoc | null = null;
  for (const t of tiers) if (t.level <= level && (!best || t.level > best.level)) best = t;
  // A crate below every tier is the lowest tier's.
  if (!best) for (const t of tiers) if (!best || t.level < best.level) best = t;
  return best ? { tier: best, ringed: /_Double(_|$)/i.test(name) } : null;
}

/** ARK's power as the roll takes it: a multiple of one sixteenth, from one sixteenth to sixteen. */
const power = (n: IniNode | undefined): number | undefined => {
  const v = number(n);
  if (!(v > 0) || v === 1) return undefined;
  return Math.max(1 / POWER_STEPS, Math.min(POWER_MOST, Math.round(v * POWER_STEPS) / POWER_STEPS));
};

function countOf(list: IniList, min: string, max: string, pow: string, without: string, most: number): LootCount {
  const lo = Math.max(0, Math.min(most, Math.floor(number(field(list, min)) || 0)));
  const hi = Math.max(lo, Math.min(most, Math.floor(number(field(list, max)) || lo)));
  const p = power(field(list, pow));
  // ARK draws without replacement where it is told to, and with where it is not told.
  const replace = flag(field(list, without)) !== true;
  return { min: lo, max: hi, ...(p === undefined ? {} : { power: p }), ...(replace ? { replace: true } : {}) };
}

/**
 * Reads the setting's entries. `ids` gives the content ids an ARK class string or a content id means here (none for
 * one this build lacks; Lists.ids records those), and `may` whether an id is something loot may hold.
 */
export function arkCrates(entries: readonly IniNode[], tiers: readonly TierDoc[], ids: (name: string) => readonly string[], may: (id: string) => boolean): ArkCrates {
  const tables = new Map<string, ArkTables>();
  const passed: string[] = [];
  for (const entry of entries) {
    if (!isList(entry)) continue;
    const name = words(field(entry, "SupplyCrateClassString"));
    const crate = crateTier(name, tiers);
    if (!crate) {
      passed.push(`${SETTING}: "${name}" is no supply drop's crate here (a tier's is SupplyCrate_Level<its level>_C, and _Double for a ringed one)`);
      continue;
    }
    const sets: LootSet[] = [];
    let lacked = 0;
    for (const one of items(field(entry, "ItemSets"))) {
      if (!isList(one)) continue;
      const lines: LootEntry[] = [];
      for (const e of items(field(one, "ItemEntries"))) {
        if (!isList(e)) continue;
        const names = items(field(e, "ItemClassStrings")).map(words);
        const given = items(field(e, "ItemsWeights")).map(number);
        const kept: string[] = [];
        const weights: number[] = [];
        names.forEach((n, i) => {
          const found = ids(n).filter(may);
          if (found.length === 0) lacked++;
          // A name that became several things here shares its weight among them.
          for (const id of found) {
            kept.push(id);
            weights.push((given[i]! >= 0 ? given[i]! : 1) / found.length);
          }
        });
        if (kept.length === 0) continue;
        const lo = Math.max(1, Math.min(MOST_LOOT, Math.floor(number(field(e, "MinQuantity")) || 1)));
        const hi = Math.max(lo, Math.min(MOST_LOOT, Math.floor(number(field(e, "MaxQuantity")) || lo)));
        const qLo = number(field(e, "MinQuality"));
        const qHi = number(field(e, "MaxQuality"));
        const chance = number(field(e, "ChanceToBeBlueprintOverride"));
        const weight = number(field(e, "EntryWeight"));
        lines.push({
          items: kept,
          ...(weights.some((w) => w !== weights[0]) ? { weights } : {}),
          ...(weight >= 0 && weight !== 1 ? { weight } : {}),
          min: lo,
          max: hi,
          ...(qLo >= 0 && qHi >= qLo ? { quality: [qLo, qHi] as const } : {}),
          ...(flag(field(e, "bForceBlueprint")) === true ? { forceBlueprint: true } : chance > 0 ? { blueprint: Math.min(1, chance) } : {}),
        });
      }
      if (lines.length === 0) continue;
      const weight = number(field(one, "SetWeight"));
      sets.push({ ...countOf(one, "MinNumItems", "MaxNumItems", "NumItemsPower", "bItemsRandomWithoutReplacement", lines.length), ...(weight >= 0 && weight !== 1 ? { weight } : {}), entries: lines });
    }
    const which = crate.ringed ? "ringed" : "plain";
    const what = `${crate.ringed ? "ringed " : ""}${crate.tier.key}`;
    if (lacked > 0) passed.push(`${SETTING}: ${lacked} of the things "${name}" names are not in this build, and are left out of the ${what} drops`);
    if (sets.length === 0) {
      passed.push(`${SETTING}: "${name}" names nothing this build has, so the ${what} drops are the drop book's`);
      continue;
    }
    const def: LootDef = { type: "loot", id: `ark:${crate.tier.key}${crate.ringed ? "#ringed" : ""}`, sets: countOf(entry, "MinItemSets", "MaxItemSets", "NumItemSetsPower", "bSetsRandomWithoutReplacement", sets.length), from: sets };
    const faults = lootFaults(def);
    if (faults.length > 0) {
      passed.push(`${SETTING}: "${name}" cannot be rolled (${faults[0]}), so the ${what} drops are the drop book's`);
      continue;
    }
    const of = tables.get(crate.tier.key) ?? {};
    if (of[which]) passed.push(`${SETTING}: "${name}" is given twice, and the last is used`);
    of[which] = def;
    tables.set(crate.tier.key, of);
  }
  return { tables, passed };
}

/** What a pasted override would make of a book: the sets and tables to put in it, and the tiers they are for. */
export interface ArkDocs {
  sets: Record<string, SetDoc>;
  tables: Record<string, TableDoc>;
  /** A tier's sets of ARK's for each kind of drop: none where the override is silent, and the book's own are kept. */
  tiers: { tier: string; plain: number; ringed: number }[];
}

/** A slot as only one kind of drop has it, or null where that kind never had it. */
function only(slot: SlotDoc, which: "plain" | "ringed"): SlotDoc | null {
  const plain = slot.chance ?? 1;
  const ringed = slot.ringed ?? plain;
  if (which === "plain") return plain > 0 ? { ...slot, ringed: 0 } : null;
  return ringed > 0 ? { ...slot, chance: 0, ringed } : null;
}

/**
 * ARK's tables as the book's own documents, so that an override can be made the book's and edited: a set for each of
 * a crate's item sets, and for every class of the crate's tier a table with a slot that picks among them as ARK's
 * crate does. ARK has no classes, so every class of the tier gets the same.
 *
 * A crate and its `_Double` are two crates to ARK, and an override of one says nothing of the other: the server's own
 * setting leaves the other kind of drop to the book (server/supply.ts land), and so does this. Where the override has
 * a tier's ringed crate alone, a plain drop keeps the slots `book` gives it in each class, and the other way about. A
 * table with nothing for a plain drop would be dormant, and no circuit would call its tier at all.
 */
export function arkDocs(tables: ReadonlyMap<string, ArkTables>, classes: readonly ClassDoc[], book: Readonly<Record<string, TableDoc>> = {}): ArkDocs {
  const out: ArkDocs = { sets: {}, tables: {}, tiers: [] };
  for (const [tier, t] of tables) {
    const ark: { plain?: SlotDoc; ringed?: SlotDoc } = {};
    for (const which of ["plain", "ringed"] as const) {
      const def = t[which];
      if (!def) continue;
      const from = def.from.map((set, n) => {
        const key = `ark.${tier}.${which}.${n + 1}`;
        out.sets[key] = {
          name: `ARK's ${which === "ringed" ? "ringed " : ""}${tier} set ${n + 1}`,
          min: set.min,
          max: set.max,
          ...(set.power !== undefined ? { power: set.power } : {}),
          ...(set.replace ? { replace: true } : {}),
          entries: set.entries.map((e) => ({
            items: [...e.items],
            ...(e.weights ? { weights: [...e.weights] } : {}),
            ...(e.weight !== undefined ? { weight: e.weight } : {}),
            min: e.min,
            max: e.max,
            ...(e.quality ? { quality: [e.quality[0], e.quality[1]] as [number, number] } : {}),
            ...(e.forceBlueprint ? { forceBlueprint: true } : e.blueprint !== undefined ? { blueprint: e.blueprint } : {}),
          })),
        };
        return { set: key, ...(set.weight !== undefined ? { weight: set.weight } : {}) };
      });
      const pick = { min: def.sets?.min ?? 1, max: def.sets?.max ?? 1, ...(def.sets?.power !== undefined ? { power: def.sets.power } : {}), ...(def.sets?.replace ? { replace: true } : {}) };
      ark[which] = which === "ringed" ? { name: "ARK's ringed crate", chance: 0, ringed: 1, pick, from } : { name: "ARK's crate", ringed: 0, pick, from };
    }
    if (!ark.plain && !ark.ringed) continue;
    for (const cls of classes) {
      const key = `${tier}/${cls.key}`;
      const kept = (which: "plain" | "ringed"): SlotDoc[] => (book[key]?.slots ?? []).flatMap((slot) => only(slot, which) ?? []);
      const slots = [...(ark.plain ? [ark.plain] : kept("plain")), ...(ark.ringed ? [ark.ringed] : kept("ringed"))];
      const whose = ark.plain && ark.ringed ? "" : ` ${ark.plain ? "Ringed" : "Plain"} drops are the book's own, as they were.`;
      out.tables[key] = { tier, cls: cls.key, slots: JSON.parse(JSON.stringify(slots)) as SlotDoc[], note: `From ConfigOverrideSupplyCrateItems, as pasted.${whose}` };
    }
    out.tiers.push({ tier, plain: t.plain?.from.length ?? 0, ringed: t.ringed?.from.length ?? 0 });
  }
  return out;
}
