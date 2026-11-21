// The drop book (planning/workstreams/supply.md): what a map's server gives in its supply drops, where and how often.
// It is a document an admin writes, not content: content is hashed and every client must hold the same, and this is
// edited while the world runs. It names items by id and is never wrong for naming one the game does not have
// (shared/supply/compile.ts leaves those out and lists them). Everything here is plain data and pure, so the server,
// the tools and the admin page read a book the same way.

import type { LootCount } from "../content/defs.ts";
import { MOST_LOOT, POWER_MOST, POWER_STEPS } from "../sim/loot.ts";

export const BOOK_FORMAT = 1;
/** A key of a tier, class, set, table, circuit or site: what a path in a fault or a URL can carry unescaped. */
export const KEY = /^[a-z0-9][a-z0-9_.\/-]{0,47}$/;
/** The most of each a book may hold, so that a mistaken or hostile document costs a bounded amount to check and roll. */
export const MOST = { tiers: 16, classes: 32, sets: 2000, entries: 64, items: 64, tables: 1024, slots: 16, from: 64, circuits: 64, sites: 4096, future: 4000, bytes: 2 * 1024 * 1024 } as const;
/** Slots of the capsule a drop lands as (content/supply/capsule.ts gives the prop this many). */
export const CAPSULE_SLOTS = 60;

/** How a drop is told of besides its shaft. */
export type Announce = "none" | "compass" | "map" | "chat";

export interface BookRules {
  /** Seconds from the call to the landing at the least; the cast leaves at its sender's next full ignition after it. */
  noticeSeconds: number;
  /** Seconds the cast is in the air, and seconds of braking on its jets, both within the notice. */
  flightSeconds: number;
  brakeSeconds: number;
  /** Seconds a landed capsule stays if nobody empties it. */
  lifeSeconds: number;
  /** Metres from a tribe's structures within which no drop is called. */
  baseExclusion: number;
  /** The most drops that may be live on the map at once, whatever the circuits ask. */
  maxLive: number;
  /** Survivors that must be in the world for a circuit to call one. */
  minPlayers: number;
  announce: Announce;
  /** Chance that a drop is ringed, where its circuit does not say. */
  ringedChance: number;
  /** What a ringed drop multiplies every quality band by. */
  ringedQuality: number;
  /** The share of its tier's worth a cell must reach of its own to be called, and that no roll may fall under. */
  floorShare: number;
  /** "shared": one set of loot, first come. "instanced" is reserved for a roll to each survivor. */
  loot: "shared";
}

/** What things are worth, in the book's unit (shared/supply/worth.ts). */
export interface WorthDoc {
  /** A raw resource's worth: how hard it is to come by. */
  raw: Record<string, number>;
  /** An item's worth said outright, in place of its recipe's. */
  items: Record<string, number>;
}

export interface TierDoc {
  key: string;
  name: string;
  /** The shaft's and the lantern's colour, 0xRRGGBB. */
  rgb: number;
  /** The level a survivor must have to open it. */
  level: number;
  /** The worth a drop of this tier is balanced to. */
  target: number;
  /** The item rating its quality entries draw from (QUALITY_RATING, shared/sim/items.ts). */
  quality: [number, number];
  /** The set every table of the tier ends with, and the set a roll that gave nothing is given. */
  staple: string;
  floor: string;
}

export interface ClassDoc {
  key: string;
  name: string;
  /** Which of the top-marks it wears (shared/sim/supply.ts MARKS). */
  mark: number;
  /** The set of its own materials a thin table is topped up from. */
  fill: string;
  /** How often it is drawn at each tier, by tier key; 1 where not given. */
  weights?: Record<string, number>;
}

export interface EntryDoc {
  name?: string;
  items: string[];
  weights?: number[];
  weight?: number;
  min: number;
  max: number;
  /** An item rating range, or "tier" for the band of the set's tier (or of the table's, where the set names none). */
  quality?: [number, number] | "tier";
  blueprint?: number;
  forceBlueprint?: boolean;
  chance?: number;
  /** The line of a table the fit tool scales to bring it to its target. */
  ballast?: boolean;
  /** A prize far above the tier's worth, kept apart from the balance figures. */
  jackpot?: boolean;
}

export interface SetDoc {
  name?: string;
  /** The tier whose quality band its "tier" entries take. */
  tier?: string;
  /** Every entry is given (a kit). Otherwise `min` to `max` of them are drawn. */
  all?: boolean;
  min?: number;
  max?: number;
  power?: number;
  replace?: boolean;
  entries: EntryDoc[];
}

/** One part of a table: with `chance`, `pick` of its sets are drawn by weight and rolled. */
export interface SlotDoc {
  name?: string;
  /** 1 where not given. */
  chance?: number;
  /** Its chance in a ringed drop, where that differs: 1 on a slot a plain drop has at 0 adds it to ringed drops only. */
  ringed?: number;
  /** One set, where not given. */
  pick?: LootCount;
  from: { set: string; weight?: number }[];
}

export interface TableDoc {
  /** The tier and class it is the table of. A table with neither is rolled only by name (a body's, a cave's, later). */
  tier?: string;
  cls?: string;
  slots: SlotDoc[];
  note?: string;
}

/** An item the book wants that the game does not have yet: what it is in ARK and what it is guessed to be worth. */
export interface FutureDoc {
  ark: string;
  page?: string;
  level: number;
  cls?: string;
  /** Its worth, or the id of an item it is like and what to multiply that item's worth by. */
  worth?: number;
  like?: string;
  scale?: number;
  /** Whether quality will change what it does, and whether it will have a blueprint. */
  quality?: boolean;
  blueprint?: boolean;
}

export interface CircuitDoc {
  key: string;
  name?: string;
  on: boolean;
  /** Site keys. With none, and with RandomSupplyCratePoints, open ground within `area` is drawn at random. */
  sites: string[];
  area?: { at: [number, number]; radius: number };
  maxLive: number;
  /** Seconds before its first drop and between drops, each drawn evenly from its range. */
  firstDelay: [number, number];
  interval: [number, number];
  /** How often each tier and class is drawn, by key; a tier not named is not drawn, a class not named has weight 1. */
  tierWeights: Record<string, number>;
  classWeights?: Record<string, number>;
  ringedChance?: number;
}

export interface SiteDoc {
  key: string;
  name?: string;
  x: number;
  z: number;
  weight?: number;
}

export interface SupplyBook {
  format: typeof BOOK_FORMAT;
  /** The map it was written for. A server on another map passes the book over. "" is any map (the starter). */
  map: string;
  /** Raised by every save; a save names the revision it changed. */
  revision: number;
  rules: BookRules;
  worth: WorthDoc;
  tiers: TierDoc[];
  classes: ClassDoc[];
  sets: Record<string, SetDoc>;
  tables: Record<string, TableDoc>;
  future: Record<string, FutureDoc>;
  circuits: CircuitDoc[];
  sites: SiteDoc[];
}

/** The key of the table of a tier and a class. */
export const tableKey = (tier: string, cls: string): string => `${tier}/${cls}`;

/** Something wrong with a book, at a path into it. A warning does not stop it from being saved. */
export interface BookFault {
  path: string;
  message: string;
  warn?: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * What is wrong with a book's shape and numbers. It reads `book` as untrusted, since an admin page or a file may hand
 * it anything, and never throws. What it says nothing of is items: an id the game lacks is not a fault
 * (shared/supply/compile.ts).
 */
export function bookFaults(book: unknown): BookFault[] {
  const out: BookFault[] = [];
  const bad = (path: string, message: string): void => void out.push({ path, message });
  if (!isObject(book)) return [{ path: "", message: "a book is an object" }];
  const b = book as Partial<SupplyBook> & Record<string, unknown>;
  if (b.format !== BOOK_FORMAT) bad("format", `this build reads format ${BOOK_FORMAT}`);
  if (typeof b.map !== "string") bad("map", "the map's id, or an empty string for any map");
  if (!(Number.isInteger(b.revision) && (b.revision as number) >= 0)) bad("revision", "a whole number, not negative");

  const key = (path: string, k: unknown): boolean => {
    if (typeof k === "string" && KEY.test(k)) return true;
    bad(path, "a key is 1 to 48 of a to z, 0 to 9 and _ . / -, beginning with a letter or a digit");
    return false;
  };
  const num = (path: string, v: unknown, min: number, max: number, what: string): boolean => {
    if (finite(v) && v >= min && v <= max) return true;
    bad(path, `${what}: a number from ${min} to ${max}`);
    return false;
  };
  const share = (path: string, v: unknown): boolean => v === undefined || num(path, v, 0, 1, "a chance");
  const weightOf = (path: string, v: unknown): boolean => v === undefined || num(path, v, 0, 1e6, "a weight");
  const count = (path: string, c: unknown): void => {
    if (!isObject(c)) return bad(path, "a count is { min, max }");
    const { min, max, power } = c as unknown as LootCount;
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max <= MOST_LOOT)) bad(path, `a whole range from 0 to ${MOST_LOOT}, its least first`);
    if (power !== undefined && !(finite(power) && power > 0 && power <= POWER_MOST && Number.isInteger(power * POWER_STEPS))) bad(`${path}.power`, `a whole number of sixteenths from 1/16 to ${POWER_MOST}`);
  };
  const band = (path: string, q: unknown): boolean => {
    if (Array.isArray(q) && q.length === 2 && finite(q[0]) && finite(q[1]) && q[0] >= 0 && q[1] >= q[0] && q[1] <= 100) return true;
    bad(path, "a quality band is [least, most] of the item rating, from 0 to 100");
    return false;
  };

  // Rules.
  const r = b.rules as Partial<BookRules> | undefined;
  if (!isObject(r)) bad("rules", "the rules are an object");
  else {
    num("rules.noticeSeconds", r.noticeSeconds, 10, 3600, "seconds of notice");
    num("rules.flightSeconds", r.flightSeconds, 3, 120, "seconds of flight");
    num("rules.brakeSeconds", r.brakeSeconds, 2, 30, "seconds of braking");
    if (finite(r.noticeSeconds) && finite(r.flightSeconds) && finite(r.brakeSeconds) && r.flightSeconds + r.brakeSeconds > r.noticeSeconds) bad("rules.noticeSeconds", "the notice holds the flight and the braking");
    num("rules.lifeSeconds", r.lifeSeconds, 30, 86400, "seconds a landed capsule stays");
    num("rules.baseExclusion", r.baseExclusion, 0, 1000, "metres");
    num("rules.maxLive", r.maxLive, 0, 32, "drops live at once");
    num("rules.minPlayers", r.minPlayers, 0, 255, "survivors");
    if (!["none", "compass", "map", "chat"].includes(r.announce as string)) bad("rules.announce", "one of none, compass, map, chat");
    num("rules.ringedChance", r.ringedChance, 0, 1, "a chance");
    num("rules.ringedQuality", r.ringedQuality, 1, 5, "a multiple");
    num("rules.floorShare", r.floorShare, 0, 1, "a share");
    if (r.loot !== "shared") bad("rules.loot", "\"shared\" is the only way loot is given yet");
  }

  // Worth.
  const w = b.worth as Partial<WorthDoc> | undefined;
  if (!isObject(w) || !isObject(w.raw) || !isObject(w.items)) bad("worth", "worth is { raw, items }, each a record of id to number");
  else for (const part of ["raw", "items"] as const) for (const [id, v] of Object.entries(w[part]!)) num(`worth.${part}.${id}`, v, 0, 1e9, "a worth");

  // Sets, which tiers, classes and tables name.
  const sets = isObject(b.sets) ? (b.sets as Record<string, unknown>) : null;
  if (!sets) bad("sets", "the sets are a record by key");
  else {
    const names = Object.keys(sets);
    if (names.length > MOST.sets) bad("sets", `at most ${MOST.sets} sets`);
    for (const k of names.slice(0, MOST.sets)) {
      const path = `sets.${k}`;
      key(path, k);
      const s = sets[k] as Partial<SetDoc>;
      if (!isObject(s) || !Array.isArray(s.entries)) {
        bad(path, "a set is { entries }, with all or min and max");
        continue;
      }
      if (s.entries.length === 0) bad(`${path}.entries`, "a set has at least one entry");
      if (s.entries.length > MOST.entries) bad(`${path}.entries`, `at most ${MOST.entries} entries`);
      if (s.all !== true) count(path, { min: s.min, max: s.max, power: s.power });
      s.entries.slice(0, MOST.entries).forEach((e, i) => {
        const at = `${path}.entries.${i}`;
        if (!isObject(e) || !Array.isArray(e.items)) return bad(at, "an entry is { items, min, max }");
        if (e.items.length === 0 || e.items.length > MOST.items || e.items.some((id) => typeof id !== "string" || id.length === 0 || id.length > 96)) bad(`${at}.items`, `1 to ${MOST.items} item ids`);
        if (e.weights !== undefined && !(Array.isArray(e.weights) && e.weights.length === e.items.length && e.weights.every((v) => finite(v) && v >= 0))) bad(`${at}.weights`, "one weight for each item, none negative");
        weightOf(`${at}.weight`, e.weight);
        if (!(Number.isInteger(e.min) && Number.isInteger(e.max) && e.min >= 0 && e.max >= e.min && e.max <= MOST_LOOT)) bad(at, `a whole quantity from 0 to ${MOST_LOOT}, its least first`);
        if (e.quality !== undefined && e.quality !== "tier") band(`${at}.quality`, e.quality);
        share(`${at}.blueprint`, e.blueprint);
        share(`${at}.chance`, e.chance);
      });
    }
  }
  const setNamed = (path: string, k: unknown): void => {
    if (typeof k !== "string" || !sets || !Object.hasOwn(sets, k)) bad(path, "names a set of the book");
  };

  // Tiers and classes.
  const tierKeys = new Set<string>();
  if (!Array.isArray(b.tiers) || b.tiers.length === 0 || b.tiers.length > MOST.tiers) bad("tiers", `1 to ${MOST.tiers} tiers`);
  else {
    b.tiers.forEach((t, i) => {
      const path = `tiers.${i}`;
      if (!isObject(t)) return bad(path, "a tier is an object");
      if (key(`${path}.key`, t.key)) {
        if (tierKeys.has(t.key) || t.key.includes("/")) bad(`${path}.key`, "a tier's key is its own, with no /");
        tierKeys.add(t.key);
      }
      if (typeof t.name !== "string" || t.name.length === 0 || t.name.length > 24) bad(`${path}.name`, "a name of 1 to 24 characters");
      if (!(Number.isInteger(t.rgb) && t.rgb >= 0 && t.rgb <= 0xffffff)) bad(`${path}.rgb`, "a colour, 0xRRGGBB");
      if (!(Number.isInteger(t.level) && t.level >= 0 && t.level <= 1000)) bad(`${path}.level`, "a level from 0 to 1000");
      num(`${path}.target`, t.target, 1, 1e9, "a worth");
      band(`${path}.quality`, t.quality);
      setNamed(`${path}.staple`, t.staple);
      setNamed(`${path}.floor`, t.floor);
    });
  }
  const classKeys = new Set<string>();
  if (!Array.isArray(b.classes) || b.classes.length === 0 || b.classes.length > MOST.classes) bad("classes", `1 to ${MOST.classes} classes`);
  else {
    b.classes.forEach((c, i) => {
      const path = `classes.${i}`;
      if (!isObject(c)) return bad(path, "a class is an object");
      if (key(`${path}.key`, c.key)) {
        if (classKeys.has(c.key) || c.key.includes("/")) bad(`${path}.key`, "a class's key is its own, with no /");
        classKeys.add(c.key);
      }
      if (typeof c.name !== "string" || c.name.length === 0 || c.name.length > 24) bad(`${path}.name`, "a name of 1 to 24 characters");
      if (!(Number.isInteger(c.mark) && c.mark >= 0 && c.mark <= 255)) bad(`${path}.mark`, "a top-mark, 0 to 255");
      setNamed(`${path}.fill`, c.fill);
      if (c.weights !== undefined) {
        if (!isObject(c.weights)) bad(`${path}.weights`, "weights by tier key");
        else for (const [t, v] of Object.entries(c.weights)) weightOf(`${path}.weights.${t}`, v);
      }
    });
  }
  // A set's tier is one of the book's.
  if (sets) for (const [k, s] of Object.entries(sets)) if (isObject(s) && s.tier !== undefined && !tierKeys.has(s.tier as string)) bad(`sets.${k}.tier`, "names a tier of the book");

  // Tables.
  if (!isObject(b.tables)) bad("tables", "the tables are a record by key");
  else {
    const names = Object.keys(b.tables);
    if (names.length > MOST.tables) bad("tables", `at most ${MOST.tables} tables`);
    for (const k of names.slice(0, MOST.tables)) {
      const path = `tables.${k}`;
      key(path, k);
      const t = (b.tables as Record<string, unknown>)[k] as Partial<TableDoc>;
      if (!isObject(t) || !Array.isArray(t.slots)) {
        bad(path, "a table is { slots }");
        continue;
      }
      if (t.tier !== undefined && !tierKeys.has(t.tier)) bad(`${path}.tier`, "names a tier of the book");
      if (t.cls !== undefined && !classKeys.has(t.cls)) bad(`${path}.cls`, "names a class of the book");
      if ((t.tier === undefined) !== (t.cls === undefined)) bad(path, "a table names both a tier and a class, or neither");
      if (t.tier !== undefined && t.cls !== undefined && k !== tableKey(t.tier, t.cls)) bad(path, `the table of ${t.tier} and ${t.cls} has the key ${tableKey(t.tier, t.cls)}`);
      if (t.slots.length === 0 || t.slots.length > MOST.slots) bad(`${path}.slots`, `1 to ${MOST.slots} slots`);
      t.slots.slice(0, MOST.slots).forEach((slot, i) => {
        const at = `${path}.slots.${i}`;
        if (!isObject(slot) || !Array.isArray(slot.from)) return bad(at, "a slot is { from }");
        share(`${at}.chance`, slot.chance);
        share(`${at}.ringed`, slot.ringed);
        if (slot.pick !== undefined) count(`${at}.pick`, slot.pick);
        if (slot.from.length === 0 || slot.from.length > MOST.from) bad(`${at}.from`, `1 to ${MOST.from} sets`);
        slot.from.slice(0, MOST.from).forEach((f, j) => {
          if (!isObject(f)) return bad(`${at}.from.${j}`, "{ set, weight }");
          setNamed(`${at}.from.${j}.set`, f.set);
          weightOf(`${at}.from.${j}.weight`, f.weight);
        });
      });
    }
  }

  // The items it waits for.
  if (!isObject(b.future)) bad("future", "the future items are a record by id");
  else {
    const ids = Object.keys(b.future);
    if (ids.length > MOST.future) bad("future", `at most ${MOST.future}`);
    for (const id of ids.slice(0, MOST.future)) {
      const f = (b.future as Record<string, unknown>)[id] as Partial<FutureDoc>;
      const path = `future.${id}`;
      if (!isObject(f) || typeof f.ark !== "string" || f.ark.length === 0) {
        bad(path, "a future item says its name in ARK");
        continue;
      }
      if (!(Number.isInteger(f.level) && (f.level as number) >= 0 && (f.level as number) <= 1000)) bad(`${path}.level`, "a level from 0 to 1000");
      if (f.worth === undefined && f.like === undefined) bad(path, "says its worth, or an item it is like");
      if (f.worth !== undefined) num(`${path}.worth`, f.worth, 0, 1e9, "a worth");
      if (f.scale !== undefined) num(`${path}.scale`, f.scale, 0, 1000, "a multiple");
    }
  }

  // Sites and circuits.
  const siteKeys = new Set<string>();
  if (!Array.isArray(b.sites) || b.sites.length > MOST.sites) bad("sites", `at most ${MOST.sites} sites`);
  else {
    b.sites.forEach((s, i) => {
      const path = `sites.${i}`;
      if (!isObject(s)) return bad(path, "a site is { key, x, z }");
      if (key(`${path}.key`, s.key)) {
        if (siteKeys.has(s.key)) bad(`${path}.key`, "a site's key is its own");
        siteKeys.add(s.key);
      }
      if (!finite(s.x) || !finite(s.z)) bad(path, "a site has a place, x and z in metres");
      weightOf(`${path}.weight`, s.weight);
    });
  }
  const circuitKeys = new Set<string>();
  if (!Array.isArray(b.circuits) || b.circuits.length > MOST.circuits) bad("circuits", `at most ${MOST.circuits} circuits`);
  else {
    b.circuits.forEach((c, i) => {
      const path = `circuits.${i}`;
      if (!isObject(c)) return bad(path, "a circuit is an object");
      if (key(`${path}.key`, c.key)) {
        if (circuitKeys.has(c.key)) bad(`${path}.key`, "a circuit's key is its own");
        circuitKeys.add(c.key);
      }
      if (typeof c.on !== "boolean") bad(`${path}.on`, "true or false");
      if (!Array.isArray(c.sites)) bad(`${path}.sites`, "a list of site keys");
      else c.sites.forEach((s, j) => void (siteKeys.has(s) || bad(`${path}.sites.${j}`, "names a site of the book")));
      if (c.area !== undefined && !(isObject(c.area) && Array.isArray(c.area.at) && c.area.at.length === 2 && c.area.at.every(finite) && finite(c.area.radius) && c.area.radius > 0)) bad(`${path}.area`, "an area is { at: [x, z], radius }");
      num(`${path}.maxLive`, c.maxLive, 0, 32, "drops live at once");
      for (const part of ["firstDelay", "interval"] as const) {
        const v = c[part];
        if (!(Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && v[0] >= 1 && v[1] >= v[0] && v[1] <= 7 * 86400)) bad(`${path}.${part}`, "[least, most] seconds, from 1 to a week");
      }
      if (!isObject(c.tierWeights)) bad(`${path}.tierWeights`, "weights by tier key");
      else for (const [t, v] of Object.entries(c.tierWeights)) (tierKeys.has(t) || bad(`${path}.tierWeights.${t}`, "names a tier of the book"), weightOf(`${path}.tierWeights.${t}`, v));
      if (c.classWeights !== undefined) {
        if (!isObject(c.classWeights)) bad(`${path}.classWeights`, "weights by class key");
        else for (const [k, v] of Object.entries(c.classWeights)) (classKeys.has(k) || bad(`${path}.classWeights.${k}`, "names a class of the book"), weightOf(`${path}.classWeights.${k}`, v));
      }
      share(`${path}.ringedChance`, c.ringedChance);
    });
  }
  return out;
}
