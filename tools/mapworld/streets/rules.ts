// The streets' rules (tools/mapworld/rules/streets.json, a city's rules.json `streets` over it): street types, each a name
// and a default section, and an ordered list of small named rules that read what a stretch's data and fit say and name
// its type, then tune its section's fields side by side. planning/workstreams/streets.md says how to add one.

import LIBRARY from "../rules/streets.json";
import { KERBS, VERGES, WALKS, type Kerb, type Verge, type Walk } from "../../../shared/world/streets.ts";

/** A width: metres, or the least and the most, chosen between by a stretch's seed. */
export type Width = number | readonly [number, number];

/** What a street is across, as rules and the overlay write it: any field may be left to the type's. */
export interface Section {
  kerb?: Kerb;
  verge?: Verge;
  vergeWidth?: Width;
  walk?: Walk;
  walkWidth?: Width;
  walkAt?: "kerb" | "drawn";
  median?: "none" | "planted" | "paved" | "barrier";
  parking?: "none" | "one" | "both";
  wear?: number;
}
export const SECTION_FIELDS: Record<keyof Section, (v: unknown) => boolean> = {
  kerb: (v) => (KERBS as readonly unknown[]).includes(v),
  verge: (v) => (VERGES as readonly unknown[]).includes(v),
  vergeWidth: (v) => width(v, 0, 20),
  walk: (v) => (WALKS as readonly unknown[]).includes(v),
  walkWidth: (v) => width(v, 0, 30),
  walkAt: (v) => v === "kerb" || v === "drawn",
  median: (v) => ["none", "planted", "paved", "barrier"].includes(v as string),
  parking: (v) => ["none", "one", "both"].includes(v as string),
  wear: (v) => typeof v === "number" && v >= 0 && v <= 1,
};
function width(v: unknown, lo: number, hi: number): boolean {
  const ok = (n: unknown): boolean => typeof n === "number" && n >= lo && n <= hi;
  return ok(v) || (Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1]) && (v[0] as number) <= (v[1] as number));
}

export interface StreetType { about: string; section: Section }

/**
 * A rule's conditions: each must hold. A list of words holds where the fact is one of them; a pair of numbers where it
 * lies between them, both ends in; a word or a truth where it is that; `name` is a regular expression. Stretch facts:
 * class (OpenStreetMap's highway, else TIGER's class), mtfcc, name, district, style, tall, lanes, width, length, angle,
 * slope, oneway, pair, room, built, green, drawn and type (the type named so far, for `set` rules). Side facts, where a
 * `set` is worked out side by side: side (left, right, inner where it faces its pair, outer), and room, built, green,
 * drawn and tagged (the data's sidewalk tag on that side: walk, none or separate) of that side alone.
 */
export type When = Record<string, unknown>;
export interface Rule { id: string; when: When; type?: string; set?: Section; sure?: number; enabled?: boolean }
export interface StreetRules { types: Record<string, StreetType>; rules: Rule[] }

/** The stretch facts a rule reads, and a side's. */
export type Facts = Record<string, string | number | boolean | null>;

/** The shared rules with a city's over them (its rules.json `streets`): its types by name, its rules first, a shared id's in place. */
export function streetRules(city?: { types?: Record<string, StreetType>; rules?: Rule[] } | null): StreetRules {
  const library = LIBRARY as unknown as StreetRules;
  const types = { ...library.types, ...(city?.types ?? {}) };
  const own = city?.rules ?? [];
  const replaced = new Map(own.filter((r) => library.rules.some((l) => l.id === r.id)).map((r) => [r.id, r]));
  const rules = [...own.filter((r) => !replaced.has(r.id)), ...library.rules.map((r) => replaced.get(r.id) ?? r)].filter((r) => r.enabled !== false);
  checkRules({ types, rules });
  return { types, rules };
}

const STRETCH_WORDS = new Set(["class", "mtfcc", "name", "district", "style", "tall", "lanes", "width", "length", "angle", "slope", "oneway", "pair", "room", "built", "green", "drawn", "type"]);
const SIDE_WORDS = new Set(["side", "room", "built", "green", "drawn", "tagged", "type"]);

/** Throws, naming the rule and the word, where a rule says what no stretch could hold. */
export function checkRules(r: StreetRules): void {
  const ids = new Set<string>();
  for (const [name, t] of Object.entries(r.types)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`streets: type "${name}" is not a name of small letters, figures and dashes`);
    checkSection(t.section, `type ${name}`);
  }
  if (Object.keys(r.types).length > 255) throw new Error("streets: a map holds at most 255 street types");
  for (const rule of r.rules) {
    if (!rule.id || ids.has(rule.id)) throw new Error(`streets: rule "${rule.id}" is not named once`);
    ids.add(rule.id);
    if (!rule.type && !rule.set) throw new Error(`streets: rule "${rule.id}" names no type and sets nothing`);
    if (rule.type && !r.types[rule.type]) throw new Error(`streets: rule "${rule.id}" names type "${rule.type}", which there is not`);
    if (rule.set) checkSection(rule.set, `rule "${rule.id}"`);
    for (const k of Object.keys(rule.when)) if (!STRETCH_WORDS.has(k) && !SIDE_WORDS.has(k)) throw new Error(`streets: rule "${rule.id}" reads "${k}", which no stretch has`);
    if (rule.type && Object.keys(rule.when).some((k) => !STRETCH_WORDS.has(k))) throw new Error(`streets: rule "${rule.id}" names a type by a side's fact; a type is the whole stretch's`);
    for (const t of (rule.when.type as string[] | undefined) ?? []) if (!r.types[t]) throw new Error(`streets: rule "${rule.id}" reads type "${t}", which there is not`);
  }
}

export function checkSection(s: Section, where: string): void {
  for (const [k, v] of Object.entries(s)) {
    const ok = SECTION_FIELDS[k as keyof Section];
    if (!ok) throw new Error(`streets: ${where} sets "${k}", which is no field of a section (${Object.keys(SECTION_FIELDS).join(", ")})`);
    if (!ok(v)) throw new Error(`streets: ${where} sets ${k} to ${JSON.stringify(v)}, which it cannot be`);
  }
}

/** Whether `when` holds for these facts. */
export function holds(when: When, facts: Facts): boolean {
  for (const [k, want] of Object.entries(when)) {
    const v = facts[k];
    if (k === "name") {
      if (typeof v !== "string" || !new RegExp(String(want)).test(v)) return false;
    } else if (Array.isArray(want) && want.length === 2 && typeof want[0] === "number") {
      if (typeof v !== "number" || v < (want[0] as number) || v > (want[1] as number)) return false;
    } else if (Array.isArray(want)) {
      if (!want.includes(v)) return false;
    } else if (k === "side") {
      if (!(v === want || (want === "outer" && facts.inner === false) || (want === "inner" && facts.inner === true))) return false;
    } else if (v !== want) return false;
  }
  return true;
}

/** The type a stretch's facts name, the rule that named it and how sure it is. */
export function typeOf(r: StreetRules, facts: Facts): { type: string; rule: string; sure: number } {
  for (const rule of r.rules) if (rule.type && holds(rule.when, facts)) return { type: rule.type, rule: rule.id, sure: rule.sure ?? 0.5 };
  throw new Error("streets: no rule names a type for every stretch; the last should hold for any");
}

/** A side's section: its type's, then each `set` rule that holds for the stretch's facts with this side's over them, in order. */
export function sideSection(r: StreetRules, type: string, facts: Facts): { section: Section; rules: string[] } {
  const section: Section = { ...r.types[type]!.section };
  const rules: string[] = [];
  for (const rule of r.rules) {
    if (!rule.set || !holds(rule.when, facts)) continue;
    Object.assign(section, rule.set);
    rules.push(rule.id);
  }
  return { section, rules };
}

/** A width for a seed's share between 0 and 1. */
export const widthOf = (w: Width | undefined, share: number, fallback = 0): number => (w === undefined ? fallback : typeof w === "number" ? w : w[0] + (w[1] - w[0]) * share);
