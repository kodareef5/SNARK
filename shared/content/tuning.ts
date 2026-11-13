// Content as a server's settings have it.
//
// Some settings change what content says: how many of a thing stack, what it
// is made of, what an engram costs, how much experience a level takes, how
// fast a body tires. They do not reach into the compiled tables one by one.
// They become a small piece of data, the tuning, and one function applies it
// to the definitions, which are then compiled as any definitions are (D90).
// So every reader of content, of a definition or of a table, sees the same
// thing, and the registry's own hash covers it.
//
// The server sends its tuning to each client as it welcomes it. The client
// derives the same registry from the same definitions and is refused if its
// hash is not the server's.
//
// A tuning that changes nothing derives the very registry it was given.
//
// `applyTuning` makes something that compiles of anything it is handed: a
// number out of range is brought into it, a name of nothing is passed over.
// What a tuning says is the server's to get right (server/settings/tune.ts
// reports what it passed over); this only never fails.

import type { Def, EngramDef, ItemDef, LevelsDef, NodeDef, RecipeDef, SpeciesDef } from "./defs.ts";
import { MAX_BURN_SECONDS, MAX_LEVELS, MAX_NODE_HITS, MAX_SPOIL_HOURS, STAMINA_DEFAULT, compileContent, type Registry } from "./registry.ts";

export interface Tuning {
  /** What every stack of more than one is multiplied by. */
  readonly stack?: number;
  /** One item's stack. `plain`: the multiplier is left out of it. */
  readonly stacks?: Readonly<Record<string, { readonly n: number; readonly plain?: boolean }>>;
  /** What a thing is made of, by the item made, in place of what its recipe says. */
  readonly costs?: Readonly<Record<string, readonly { readonly item: string; readonly count: number }[]>>;
  /** An engram's level and cost; whether it is not offered; the level at which it is learned without asking. */
  readonly engrams?: Readonly<Record<string, { readonly level?: number; readonly cost?: number; readonly hidden?: boolean; readonly auto?: number }>>;
  /** Every engram is learned as its level is reached, whatever `engrams` says. */
  readonly autoAll?: boolean;
  /** Only the engrams named in `engrams` are offered. */
  readonly onlyNamed?: boolean;
  /** Survivors: the experience each level takes (the first is level 1, and 0), the most they may have, and the engram points each level gives. */
  readonly xp?: readonly number[];
  readonly most?: number;
  readonly points?: readonly number[];
  /** Tames: the experience each level takes, and the most they may have. */
  readonly tameXp?: readonly number[];
  readonly tameMost?: number;
  /** What sprinting and jumping cost a body in stamina, times this; and for one species, times its own instead. */
  readonly stamina?: number;
  readonly staminaOf?: Readonly<Record<string, number>>;
  /**
   * What a species' stats are, as multiples of what content says, by stat
   * name: where each begins, what a wild level is worth, and what a level its
   * owner (or, for a survivor, itself) gives is worth. `gains` is for every
   * species; `gainsOf` is for one, in place of that.
   */
  readonly gains?: Gains;
  readonly gainsOf?: Readonly<Record<string, Gains>>;
  /** How long things keep before they spoil, and how long a piece of fuel burns, times this. */
  readonly spoil?: number;
  readonly fuel?: number;
  /** How many blows a tree, a rock or a bush takes, times this. */
  readonly nodeHits?: number;
}

export interface Gains {
  readonly base?: Readonly<Record<string, number>>;
  readonly wild?: Readonly<Record<string, number>>;
  readonly tamed?: Readonly<Record<string, number>>;
}

const MULTIPLIERS: readonly (keyof Tuning)[] = ["stack", "stamina", "spoil", "fuel", "nodeHits"];

/** Key-sorted JSON, so that the same tuning is the same text however it was put together. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/**
 * A tuning as text: what is sent to a client, and what two tunings are told
 * apart by. Whatever in it changes nothing (a multiplier of 1, an empty
 * table, a switch that is off) is left out, and one that changes nothing at
 * all is "".
 */
export function tuningText(t: Tuning): string {
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (v === undefined || v === null || v === false) continue;
    if ((MULTIPLIERS as readonly string[]).includes(k) && v === 1) continue;
    if ((k === "most" || k === "tameMost") && !(v > 0)) continue;
    if (typeof v === "object" && Object.keys(v).length === 0) continue;
    // Gains that say nothing of any stat say nothing.
    if (k === "gains" && Object.values(v as Gains).every((of) => of === undefined || Object.keys(of).length === 0)) continue;
    kept[k] = v;
  }
  return Object.keys(kept).length === 0 ? "" : canonical(kept);
}

/** The tuning a text holds; null if it is not one. "" is the tuning that changes nothing. */
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
/** A multiplier: a number not below 0, or 1. */
const factor = (v: unknown): number => (isNumber(v) && v >= 0 ? v : 1);
const whole = (v: number, least: number, most: number): number => Math.min(most, Math.max(least, Math.round(v)));
const within = (v: number, least: number, most: number): number => Math.min(most, Math.max(least, v));

/** A level table: it begins at 0 and rises, and is no longer than a level can be told. Null for anything else. */
function levelTable(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_LEVELS || v[0] !== 0) return null;
  for (let i = 1; i < v.length; i++) if (!isNumber(v[i]) || !(v[i] > v[i - 1])) return null;
  return v as number[];
}

/** The definitions as a tuning has them. Those it leaves alone are the very ones given. */
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
  /** The curve of one stat as a species' gains have it. A beginning is never brought to nothing, which no body could have. */
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
      // What is one to a slot because it wears, or holds rounds, stays so. Anything else that stacks, stacks: never to one, which would make it such a thing.
      const single = (d.weapon !== undefined || d.wear !== undefined || d.tool !== undefined) && d.weapon?.kind !== "thrown";
      const own = Object.hasOwn(stacks, d.id) ? stacks[d.id] : undefined;
      let n = d.stack;
      if (single) n = d.stack;
      else if (own && isNumber(own.n) && own.n >= 1) n = whole(own.n * (own.plain === true ? 1 : stack), d.stack > 1 ? 2 : 1, 65535);
      else if (d.stack > 1) n = whole(d.stack * stack, 2, 65535);
      const out: { -readonly [K in keyof ItemDef]: ItemDef[K] } = { ...d, stack: n };
      // Never so short that it keeps for ever, or burns for no time at all.
      if (d.spoilHours !== undefined) out.spoilHours = within(d.spoilHours * spoil, 1e-4, MAX_SPOIL_HOURS);
      if (d.fuel !== undefined) out.fuel = within(d.fuel * fuel, 0.05, MAX_BURN_SECONDS);
      return out.stack === d.stack && out.spoilHours === d.spoilHours && out.fuel === d.fuel ? d : out;
    }
    if (d.type === "recipe") {
      const list = Object.hasOwn(costs, d.makes) ? costs[d.makes] : undefined;
      if (!Array.isArray(list)) return d;
      const needs: RecipeDef["needs"][number][] = [];
      for (const need of list as { item?: unknown; count?: unknown }[]) {
        if (need === null || typeof need !== "object" || typeof need.item !== "string" || !items.has(need.item) || !isNumber(need.count) || !(need.count > 0)) continue;
        if (!needs.some((have) => have.item === need.item)) needs.push({ item: need.item, count: whole(need.count, 1, 65535) });
      }
      return needs.length === 0 ? d : { ...d, needs };
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
        // A level the content does not go up to gives what its last does.
        engramPoints: table.map((_, i) => (isNumber(points[i]) && points[i] >= 0 ? whole(points[i], 0, 65535) : (d.engramPoints[i] ?? d.engramPoints[d.engramPoints.length - 1] ?? 0))),
      };
      if (isNumber(t.most) && t.most > 0) out.most = t.most;
      // Tames have a table of their own once either is said: what is said of survivors leaves them as they were.
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
      const out: SpeciesDef = { ...d, ...(stats ? { stats } : {}), ...(m !== 1 ? { stamina: { sprint: s.sprint * m, regen: s.regen, jump: s.jump * m } } : {}) };
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
 * The registry a tuning makes of the definitions `reg` came from. One that
 * was itself derived is not tuned twice: it is derived from what it was
 * derived from. The same tuning gives the very registry it was given, and no
 * tuning gives the untuned one.
 */
export function deriveRegistry(reg: Registry, tuning: Tuning): Registry {
  const base = reg.source ?? reg;
  const text = tuningText(tuning);
  if (text === reg.tuning) return reg;
  if (text === "") return base;
  const made = compileContent(applyTuning(base.defs.filter((d): d is Def => d !== null), tuning));
  if (!made.registry) throw new Error("content does not compile as tuned:\n" + made.errors.join("\n"));
  return { ...made.registry, baseHash: base.hash, tuning: text, source: base };
}
