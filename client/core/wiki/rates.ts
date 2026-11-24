// What a world's settings do to the wiki's figures. A figure a public setting changes is written with its kind and its
// inputs, and worked out here: by the build at the defaults, and on the page again from what the world the visitor came
// from says it runs (its settings.json, beside its links.json), so the two agree by construction.

import { difficulty, drainAt, torporAt, wildLevel } from "../../../shared/content/wild.ts";
import { narcoticsNeeded, piecesNeeded, tameSeconds, type TameParams } from "../../../shared/sim/taming.ts";
import { num, time } from "./format.ts";
import type { ServerSaid } from "./world.ts";

export const AT_DEFAULTS: ServerSaid = { name: "", map: "", settings: {} };

/** The settings the wiki's figures are worked out from, each at the default the catalogue gives it (a test holds them to it). */
export const RATE_DEFAULTS: Readonly<Record<string, number>> = {
  XPMultiplier: 1, KillXPMultiplier: 1, HarvestXPMultiplier: 1, CraftXPMultiplier: 1, TamingSpeedMultiplier: 1,
  HarvestAmountMultiplier: 1, HarvestHealthMultiplier: 1, ResourcesRespawnPeriodMultiplier: 1, EggHatchSpeedMultiplier: 1,
  BabyMatureSpeedMultiplier: 1, GlobalSpoilingTimeMultiplier: 1, ItemStackSizeMultiplier: 1, DifficultyOffset: 1,
  OverrideOfficialDifficulty: 0,
};

const value = (s: ServerSaid, name: string): number => {
  const v = s.settings[name];
  return typeof v === "number" ? v : RATE_DEFAULTS[name]!;
};
const whole = (v: number, least: number, most: number): number => Math.min(most, Math.max(least, Math.round(v)));
/** A speed below this is taken as this, as the server's breeding does. */
const slowest = (v: number): number => (v > 0.001 ? v : 0.001);
const range = (a: number, b: number): string => (a === b ? num(a) : `${num(a)} to ${num(b)}`);
/** "min max", or several such joined by commas: each end is the sum of what `each` makes of every pair's. */
const pairs = (v: string, each: (n: number) => number): [number, number] =>
  v.split(",").reduce<[number, number]>(([lo, hi], p) => {
    const [a, b] = p.split(" ").map(Number);
    return [lo + each(a!), hi + each(b ?? a!)];
  }, [0, 0]);

/** Each kind of figure: the settings it reads, and the figure from its inputs as written. */
const RATES: Readonly<Record<string, { by: readonly string[]; write: (v: string, s: ServerSaid) => string }>> = {
  spoil: { by: ["GlobalSpoilingTimeMultiplier"], write: (v, s) => time(Number(v) * value(s, "GlobalSpoilingTimeMultiplier")) },
  respawn: { by: ["ResourcesRespawnPeriodMultiplier"], write: (v, s) => time(Number(v) * value(s, "ResourcesRespawnPeriodMultiplier")) },
  hatch: { by: ["EggHatchSpeedMultiplier"], write: (v, s) => time(Number(v) / slowest(value(s, "EggHatchSpeedMultiplier"))) },
  mature: { by: ["BabyMatureSpeedMultiplier"], write: (v, s) => time(Number(v) / slowest(value(s, "BabyMatureSpeedMultiplier"))) },
  killxp: { by: ["XPMultiplier", "KillXPMultiplier"], write: (v, s) => num(Number(v) * value(s, "XPMultiplier") * value(s, "KillXPMultiplier")) },
  craftxp: { by: ["XPMultiplier", "CraftXPMultiplier"], write: (v, s) => num(Number(v) * value(s, "XPMultiplier") * value(s, "CraftXPMultiplier")) },
  harvestxp: { by: ["XPMultiplier", "HarvestXPMultiplier"], write: (v, s) => num(Number(v) * value(s, "XPMultiplier") * value(s, "HarvestXPMultiplier")) },
  // A stack of more than one is never tuned below two; a thing that wears out is never given a stack.
  stack: { by: ["ItemStackSizeMultiplier"], write: (v, s) => num(whole(Number(v) * value(s, "ItemStackSizeMultiplier"), 2, 65535)) },
  hits: { by: ["HarvestHealthMultiplier"], write: (v, s) => num(whole(Number(v) * value(s, "HarvestHealthMultiplier"), 1, 10000)) },
  health: { by: ["HarvestHealthMultiplier"], write: (v, s) => num(Number(v) * value(s, "HarvestHealthMultiplier")) },
  // A hit on a node gives each of its rolls rounded; a body's roll keeps its fraction as a chance of one more.
  node: { by: ["HarvestAmountMultiplier"], write: (v, s) => range(...pairs(v, (n) => Math.round(n * value(s, "HarvestAmountMultiplier")))) },
  body: { by: ["HarvestAmountMultiplier"], write: (v, s) => range(...pairs(v, (n) => n * value(s, "HarvestAmountMultiplier"))) },
};

/** The figure of `kind` from its inputs `v` on a server that says `s`. */
export function rated(kind: string, v: string, s: ServerSaid = AT_DEFAULTS): string {
  const r = RATES[kind];
  if (!r) throw new Error(`the wiki has no figure of kind "${kind}"`);
  return r.write(v, s);
}

/** The settings figures of these kinds read that differ from their defaults on a server that says `s`, with their values. */
export function changed(kinds: Iterable<string>, s: ServerSaid): [name: string, value: number, def: number][] {
  const names = new Set([...kinds].flatMap((k) => (k === "taming" ? ["TamingSpeedMultiplier", "DifficultyOffset", "OverrideOfficialDifficulty"] : (RATES[k]?.by ?? []))));
  return [...names].filter((n) => value(s, n) !== RATE_DEFAULTS[n]).map((n) => [n, value(s, n), RATE_DEFAULTS[n]!]);
}

/** Settings as `changed` gives them, each with its default once: "TamingSpeedMultiplier 50 (default 1)". */
export function settingsLine(list: readonly [name: string, value: number, def: number][]): string {
  return list.map(([name, v, def]) => `${name} ${num(v)} (default ${num(def)})`).join(", ");
}

/** A setting's value as the settings page writes a default. */
export const settingText = (v: number | boolean | string): string => (typeof v === "boolean" ? (v ? "True" : "False") : String(v));

/** A species' taming, as its table is worked out: its numbers, its torpor curve, what it eats and the doses that keep it down. */
export interface TamingInput {
  readonly p: TameParams;
  /** The torpidity curve's base and gain a wild level, and the torpor it loses a second at level 1. */
  readonly torpor: readonly [base: number, gain: number, drain: number];
  readonly eats: readonly (readonly [affinity: number, food: number])[];
  readonly doses: readonly (readonly [torpor: number, seconds: number])[];
}

const wildDifficulty = (s: ServerSaid): number => difficulty(value(s, "DifficultyOffset"), value(s, "OverrideOfficialDifficulty"));

export function tamingMaximum(s: ServerSaid = AT_DEFAULTS): number {
  return wildLevel(30, wildDifficulty(s));
}

/** The levels a taming table is given at: 1 and each fifth of the way to the most a wild creature is on the server. */
export function tamingLevels(s: ServerSaid = AT_DEFAULTS): number[] {
  const d = wildDifficulty(s);
  return [...new Set([1, 6, 12, 18, 24, 30].map((step, k) => (k === 0 ? 1 : wildLevel(step, d))))];
}

/** Torpor, time until waking, the pieces and time for each food, and each dose that keeps it down. */
export function tamingRow(t: TamingInput, level: number, s: ServerSaid = AT_DEFAULTS): string[] {
  const speed = value(s, "TamingSpeedMultiplier");
  const most = torporAt(t.torpor[0], t.torpor[1], level - 1);
  const drain = drainAt(t.torpor[2], level - 1);
  const eats = t.eats.map(([affinity, food]) => {
    const pieces = piecesNeeded(t.p, level, affinity, speed);
    return { pieces, seconds: tameSeconds(t.p, pieces, food) };
  });
  const longest = Math.max(...eats.map((e) => e.seconds));
  const kept = t.doses.map(([torpor, seconds]) => String(narcoticsNeeded(most, drain, longest, torpor, seconds)));
  return [String(level), num(most, 0), time(most / drain), ...eats.map((e) => `${e.pieces} in ${time(e.seconds)}`), ...kept];
}

export function tamingRows(t: TamingInput, s: ServerSaid = AT_DEFAULTS): string[][] {
  return tamingLevels(s).map((level) => tamingRow(t, level, s));
}
