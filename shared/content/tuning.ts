// Server settings that change content become one piece of data, the tuning. applyTuning applies it to the definitions,
// which then compile as usual (D90). The server sends its tuning in the welcome and the client derives the same registry.

import type { CraftFacet, Def, EngramDef, ItemDef, LevelsDef, NodeDef, SpeciesDef } from "./defs.ts";
import { MAX_BURN_SECONDS, MAX_LEVELS, MAX_NODE_HITS, MAX_SPOIL_HOURS, STAMINA_DEFAULT, compileContent, type Registry } from "./registry.ts";

export interface Tuning {
  /** Multiplies every stack larger than one. */
  readonly stack?: number;
  /** One item's stack. `plain` leaves the multiplier out. */
  readonly stacks?: Readonly<Record<string, { readonly n: number; readonly plain?: boolean }>>;
  /** Ingredients by the item made, in place of its own. */
  readonly costs?: Readonly<Record<string, readonly { readonly item: string; readonly count: number }[]>>;
  /** Per engram: its level and cost, whether it is hidden, and the level at which it is learned automatically. */
  readonly engrams?: Readonly<Record<string, { readonly level?: number; readonly cost?: number; readonly hidden?: boolean; readonly auto?: number }>>;
  /** Every engram is learned when its level is reached, regardless of `engrams`. */
  readonly autoAll?: boolean;
  /** Only the engrams named in `engrams` are offered. */
  readonly onlyNamed?: boolean;
  /** Survivors: the experience each level takes (the first is level 1, at 0), the most they may have, and the engram points each level gives. */
  readonly xp?: readonly number[];
  readonly most?: number;
  readonly points?: readonly number[];
  /** Tames: the experience each level takes, and the most they may have. */
  readonly tameXp?: readonly number[];
  readonly tameMost?: number;
  /** Multiplies the stamina cost of sprinting and jumping. `staminaOf` gives one species its own multiplier instead. */
  readonly stamina?: number;
  readonly staminaOf?: Readonly<Record<string, number>>;
  /**
   * Multipliers on a species' stat curves, by stat name: the base, the worth of a wild level, and the worth of a level
   * given by its owner (or, for a survivor, by itself). `gains` is for every species and `gainsOf` replaces it for one.
   */
  readonly gains?: Gains;
  readonly gainsOf?: Readonly<Record<string, Gains>>;
  /** Multipliers on spoil time and on fuel burn time. */
  readonly spoil?: number;
  readonly fuel?: number;
  /** Multiplies the hits a node takes. */
  readonly nodeHits?: number;
}

export interface Gains {
  readonly base?: Readonly<Record<string, number>>;
  readonly wild?: Readonly<Record<string, number>>;
  readonly tamed?: Readonly<Record<string, number>>;
}

const MULTIPLIERS: readonly (keyof Tuning)[] = ["stack", "stamina", "spoil", "fuel", "nodeHits"];

/** Key-sorted JSON, so the same tuning gives the same text regardless of property order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/**
 * The text sent to a client, which also identifies a tuning. Entries that change nothing (a multiplier of 1, an empty
 * table, a switch that is off) are left out, and a tuning that changes nothing is "".
 */
export function tuningText(t: Tuning): string {
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (v === undefined || v === null || v === false) continue;
    if ((MULTIPLIERS as readonly string[]).includes(k) && v === 1) continue;
    if ((k === "most" || k === "tameMost") && !(v > 0)) continue;
    if (typeof v === "object" && Object.keys(v).length === 0) continue;
    // Gains with no stat in any part change nothing.
    if (k === "gains" && Object.values(v as Gains).every((of) => of === undefined || Object.keys(of).length === 0)) continue;
    kept[k] = v;
  }
  return Object.keys(kept).length === 0 ? "" : canonical(kept);
}

/** Returns null if the text is not a tuning. "" is the tuning that changes nothing. */
export function parseTuning(text: string): Tuning | null {
  if (text === "") return {};
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Tuning) : null;
  } catch {
    return null;
  }
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A multiplier. Anything but a number of 0 or more becomes 1. */
const factor = (v: unknown): number => (isNumber(v) && v >= 0 ? v : 1);
const whole = (v: number, least: number, most: number): number => Math.min(most, Math.max(least, Math.round(v)));
const within = (v: number, least: number, most: number): number => Math.min(most, Math.max(least, v));

/** A level table begins at 0, rises, and has 2 to MAX_LEVELS entries. Returns null for anything else. */
function levelTable(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_LEVELS || v[0] !== 0) return null;
  for (let i = 1; i < v.length; i++) if (!isNumber(v[i]) || !(v[i] > v[i - 1])) return null;
  return v as number[];
}

/**
 * Never fails. It clamps a number out of range and skips an unknown name (server/settings/tune.ts reports those).
 * Definitions it leaves alone are returned as the same objects.
 */
export function applyTuning(defs: readonly Def[], t: Tuning): Def[] {
  const items = new Set(defs.flatMap((d) => (d.type === "item" ? [d.id] : [])));
  const stack = factor(t.stack);
  const spoil = factor(t.spoil);
  const fuel = factor(t.fuel);
  const nodeHits = factor(t.nodeHits);
  const stamina = factor(t.stamina);
  const record = <T>(v: unknown): Readonly<Record<string, T>> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {});
  const stacks = record<{ n?: unknown; plain?: unknown }>(t.stacks);
  const costs = record<unknown>(t.costs);
  const engrams = record<{ level?: unknown; cost?: unknown; hidden?: unknown; auto?: unknown }>(t.engrams);
  const staminaOf = record<unknown>(t.staminaOf);
  const gains = record<unknown>(t.gains);
  const gainsOf = record<unknown>(t.gainsOf);
  /** A base multiplier below 1e-6 is ignored, because no body can have a stat base of 0. */
  const curved = (curve: readonly [number, number, number], stat: string, g: Readonly<Record<string, unknown>>): readonly [number, number, number] => {
    const of = (part: string, least: number): number => {
      const v = record<unknown>(g[part])[stat];
      return isNumber(v) && v >= least ? v : 1;
    };
    const base = of("base", 1e-6);
    const wild = of("wild", 0);
    const tamed = of("tamed", 0);
    return base === 1 && wild === 1 && tamed === 1 ? curve : [curve[0] * base, curve[1] * wild, curve[2] * tamed];
  };
  const xp = levelTable(t.xp);
  const tameXp = levelTable(t.tameXp);

  return defs.map((d): Def => {
    if (d.type === "item") {
      // An item that cannot stack because it wears out or holds rounds stays so. A stack above 1 never tunes down to 1.
      const single = (d.weapon !== undefined || d.wear !== undefined || d.tool !== undefined) && d.weapon?.kind !== "thrown";
      const own = Object.hasOwn(stacks, d.id) ? stacks[d.id] : undefined;
      let n = d.stack;
      if (single) n = d.stack;
      else if (own && isNumber(own.n) && own.n >= 1) n = whole(own.n * (own.plain === true ? 1 : stack), d.stack > 1 ? 2 : 1, 65535);
      else if (d.stack > 1) n = whole(d.stack * stack, 2, 65535);
      const out: { -readonly [K in keyof ItemDef]: ItemDef[K] } = { ...d, stack: n };
      // The floors keep the tuned values above 0, which compileContent requires.
      if (d.spoilHours !== undefined) out.spoilHours = within(d.spoilHours * spoil, 1e-4, MAX_SPOIL_HOURS);
      if (d.fuel !== undefined) out.fuel = within(d.fuel * fuel, 0.05, MAX_BURN_SECONDS);
      // What it is made of, where the server says otherwise.
      const list = d.craft && Object.hasOwn(costs, d.id) ? costs[d.id] : undefined;
      if (Array.isArray(list)) {
        const needs: CraftFacet["needs"][number][] = [];
        for (const need of list as { item?: unknown; count?: unknown }[]) {
          if (need === null || typeof need !== "object" || typeof need.item !== "string" || !items.has(need.item) || !isNumber(need.count) || !(need.count > 0)) continue;
          if (!needs.some((have) => have.item === need.item)) needs.push({ item: need.item, count: whole(need.count, 1, 65535) });
        }
        if (needs.length > 0) out.craft = { ...d.craft!, needs };
      }
      return out.stack === d.stack && out.spoilHours === d.spoilHours && out.fuel === d.fuel && out.craft === d.craft ? d : out;
    }
    if (d.type === "engram") {
      const out: { -readonly [K in keyof EngramDef]: EngramDef[K] } = { ...d };
      if (t.autoAll === true) out.auto = d.level;
      else {
        const own = Object.hasOwn(engrams, d.id) ? engrams[d.id] : undefined;
        if (own && isNumber(own.level)) out.level = whole(own.level, 1, 1000);
        if (own && isNumber(own.cost)) out.cost = whole(own.cost, 0, 65535);
        if (own?.hidden === true || (t.onlyNamed === true && !own)) out.hidden = true;
        if (own && isNumber(own.auto)) out.auto = whole(own.auto, 0, 1000);
      }
      return out.level === d.level && out.cost === d.cost && out.hidden === d.hidden && out.auto === d.auto ? d : out;
    }
    if (d.type === "levels") {
      if (!xp && !tameXp && !(isNumber(t.most) && t.most > 0) && !(isNumber(t.tameMost) && t.tameMost > 0) && !Array.isArray(t.points)) return d;
      const table = xp ?? d.xp;
      const points = Array.isArray(t.points) ? t.points : [];
      const out: { -readonly [K in keyof LevelsDef]: LevelsDef[K] } = {
        ...d,
        xp: table,
        // A level beyond the content's table gives what its last level gives.
        engramPoints: table.map((_, i) => (isNumber(points[i]) && points[i] >= 0 ? whole(points[i], 0, 65535) : (d.engramPoints[i] ?? d.engramPoints[d.engramPoints.length - 1] ?? 0))),
      };
      if (isNumber(t.most) && t.most > 0) out.most = t.most;
      // Once either table is set, tames get their own, so a survivors' table does not change tame levels.
      const tameMost = isNumber(t.tameMost) && t.tameMost > 0 ? t.tameMost : d.tame?.most;
      if (tameXp || xp || tameMost !== undefined) out.tame = { xp: tameXp ?? d.tame?.xp ?? d.xp, ...(tameMost !== undefined ? { most: tameMost } : {}) };
      return out;
    }
    if (d.type === "species") {
      const own = Object.hasOwn(staminaOf, d.id) ? staminaOf[d.id] : undefined;
      const m = isNumber(own) && own >= 0 ? own : stamina;
      const g = record<unknown>(Object.hasOwn(gainsOf, d.id) ? gainsOf[d.id] : gains);
      let stats = d.stats;
      if (stats) {
        const next: Record<string, readonly [number, number, number]> = {};
        let changed = false;
        for (const [stat, curve] of Object.entries(stats)) {
          next[stat] = curved(curve, stat, g);
          if (next[stat] !== curve) changed = true;
        }
        if (changed) stats = next as NonNullable<SpeciesDef["stats"]>;
      }
      if (m === 1 && stats === d.stats) return d;
      const s = d.stamina ?? STAMINA_DEFAULT;
      const out: SpeciesDef = { ...d, ...(stats ? { stats } : {}), ...(m !== 1 ? { stamina: { ...s, sprint: s.sprint * m, jump: s.jump * m } } : {}) };
      return out;
    }
    if (d.type === "node") {
      const hits = whole(d.hits * nodeHits, 1, MAX_NODE_HITS);
      const out: NodeDef = hits === d.hits ? d : { ...d, hits };
      return out;
    }
    return d;
  });
}

/**
 * Tunes the untuned definitions `reg` came from, so a derived registry is never tuned twice. The tuning `reg` already has
 * returns `reg` itself, and an empty tuning returns the untuned registry.
 */
export function deriveRegistry(reg: Registry, tuning: Tuning): Registry {
  const base = reg.source ?? reg;
  const text = tuningText(tuning);
  if (text === reg.tuning) return reg;
  if (text === "") return base;
  const made = compileContent([...applyTuning(base.defs.filter((d): d is Def => d !== null), tuning), ...base.renames]);
  if (!made.registry) throw new Error("content does not compile as tuned:\n" + made.errors.join("\n"));
  return { ...made.registry, baseHash: base.hash, tuning: text, source: base };
}
