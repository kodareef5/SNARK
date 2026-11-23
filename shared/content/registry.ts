// The registry is content compiled: every definition by a dense index, and flat columns the simulation reads by it.
// Dense indices are assigned in id order, so every process that loads the same definitions gets the same indices and hash.
// Index 0 is reserved. It marks an empty structure slot and stands in for content that no longer exists.
//
// What a kind of content is, checks and fills is in its own file under kinds/, and kinds.ts lists them. Here is what no
// one kind owns: a definition's id, index, aliases and renames, the hash, the columns more than one kind fills, and the
// walk of the list.

import { hashString } from "../hash.ts";
import type { VehicleSurface } from "../sim/vehicle.ts";
import type { WeaponParams } from "../sim/weapon.ts";
import type { HullTable } from "../world/convex.ts";
import type { PartTable } from "../world/structures.ts";
import { defFaults, refFaults } from "./classes.ts";
import type { Content, Def, RenameDef } from "./defs.ts";
import { ID, f32, list, type Checking, type Kind, type Making } from "./kind.ts";
import { KINDS } from "./kinds.ts";

// What other files have always taken from here, and now lives with its kind.

export { MAX_LOOK_PARTS, MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF } from "./kinds/shapes.ts";
export { MAX_LEVELS } from "./kinds/levels.ts";
export { MAX_NODE_HEIGHT, MAX_NODE_HITS, MAX_NODE_VARIANTS, MOST_NODE_SIZE } from "./kinds/nodes.ts";
export { MAX_MOVING_PARTS, MAX_MOVING_REACH } from "./kinds/structures.ts";
export { MAX_BURN_SECONDS } from "./kinds/stations.ts";
export { MUTATION_COLORS, STAMINA_DEFAULT, WILD_COLORS } from "./kinds/species.ts";
export { MAX_SPOIL_HOURS, MAX_ZOOM, USE_AT_ONCE, USE_OVER_TIME, WEAR_SLOTS } from "./kinds/items.ts";
export { shotRays } from "./kinds/weapons.ts";

export const MISSING = 0;

const ALIAS = /^[A-Za-z0-9_.-]+$/;

/** What every definition has whatever its kind, and the columns more than one kind fills. */
interface Core {
  /** Definitions by dense index. Entry 0 is null. */
  readonly defs: readonly (Def | null)[];
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  /** Changes whenever any definition changes. Client and server must match. */
  readonly hash: number;
  /** Ids that are no longer defined, and the content each now is. The hash does not cover them. */
  readonly redirects: ReadonlyMap<string, readonly number[]>;
  /** The renames the redirects came from, for compiling the same content again under other settings. */
  readonly renames: readonly RenameDef[];
  /** The one definition each alias names. Aliases are kept in lower case. See shared/content/find.ts. */
  readonly aliases: ReadonlyMap<string, number>;
  /**
   * For a registry a server's settings have tuned (shared/content/tuning.ts): the hash of the untuned definitions, the
   * tuning as text, and the untuned registry. For untuned content: its own hash, "", and null.
   */
  readonly baseHash: number;
  readonly tuning: string;
  readonly source: Registry | null;
  /**
   * The hash of the definitions without a map's own (withContent), and which kinds are the map's own. The servers of a
   * cluster share the first, since a survivor carries only what every map has, and nothing of the second leaves its map.
   */
  readonly coreHash: number;
  readonly own: ReadonlySet<number>;
  /** Collider half extents of structures and nodes. 0 for everything else. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  /** Radius and height of a species or prop. Zero otherwise. */
  readonly bodyRadius: Float32Array;
  readonly bodyHeight: Float32Array;
  /** Timing of a weapon item, or of a species' bite. Null for everything else. Bare hands are `FISTS`. */
  readonly weapon: readonly (WeaponParams | null)[];
  /** Damage of one melee or thrown hit, or of one round of ammunition, at primitive quality (its DMG_ type is `damageType`). For a species, its bare hands. */
  readonly damage: Float32Array;
  /** Melee reach from the eye, in metres. For a species, its bare hands or its bite. */
  readonly reach: Float32Array;
  /** Per structure and node: the boxes bodies and rays meet. One without a shape has a single box. */
  readonly parts: PartTable;
  /**
   * Per species and structure: how many times as long things keep in its inventory (a species' or a structure's `keeps`;
   * for a structure the same as structKeeps). 1 for everything else.
   */
  readonly keeps: Float32Array;
  /** Torpor of one melee hit, as a multiple of its damage: a melee weapon's, and for a species its bare hands'. */
  readonly meleeTorpor: Float32Array;
}

/** A and B and so on, of A | B | so on. */
type Join<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
/** Every column the kinds add (Kind.columns), as a hook writes them. */
type Made = Join<ReturnType<NonNullable<(typeof KINDS)[number]["columns"]>>>;
/** As a reader holds them: nothing is set, and a list or a map of lists is not changed. */
type Frozen<T> = { readonly [K in keyof T]: T[K] extends (infer E)[] ? readonly E[] : T[K] extends Map<infer A, (infer E)[]> ? ReadonlyMap<A, readonly E[]> : T[K] };
type Thawed<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer E)[] ? E[] : T[K] };

/**
 * The compiled content. Every member is a plain field of the one object: `reg.maxHp[kind]` is a property and an index.
 * A column is declared, with what it holds, in the file of the kind that fills it (kinds/), and is a member here by
 * that kind being in the list.
 */
export interface Registry extends Core, Frozen<Made> {}

/** The part table while it is filled: structures and nodes add their boxes (Making.boxes), and structures the rest. */
interface FillingParts {
  grindLine: (readonly import("../world/structures.ts").GrindLine[] | undefined)[];
  vehicleSurface: (VehicleSurface | null)[];
  start: Uint32Array;
  box: Float32Array;
  hulls?: HullTable;
}

/** The registry while it is compiled, which a kind's hooks write. */
export type Filling = Omit<Thawed<Core>, "parts"> & { parts: FillingParts } & Made;

/** The list as the walk takes it: any kind, given any definition of its type. */
const LIST = KINDS as readonly Kind<Content, Partial<Made>>[];

/** The hooks of one name by the type they are given, in the order of the list. */
function hooks<H extends "check" | "among" | "fill" | "link">(name: H): ReadonlyMap<string, NonNullable<Kind<Content>[H]>[]> {
  const out = new Map<string, NonNullable<Kind<Content>[H]>[]>();
  for (const k of LIST) {
    const hook = k[name];
    if (hook) out.set(k.type, [...(out.get(k.type) ?? []), hook as NonNullable<Kind<Content>[H]>]);
  }
  return out;
}
const CHECK = hooks("check");
const AMONG = hooks("among");
const FILL = hooks("fill");
const LINK = hooks("link");
const NO_HOOKS: readonly never[] = [];

export interface CompileResult {
  registry: Registry | null;
  errors: string[];
}

const NONE: ReadonlySet<number> = new Set();
const NO_BOXES = new Float32Array(0);

/** `reg` with a map's own definitions compiled after it (shared/world/mapfile.ts MapContent), or `reg` where there are none. */
export function withContent(reg: Registry, defs: readonly Def[]): Registry {
  if (defs.length === 0) return reg;
  const { registry, errors } = compileContent([...(reg.defs.slice(1) as Def[]), ...reg.renames, ...defs]);
  if (!registry) throw new Error("the map's content:\n" + errors.join("\n"));
  return { ...registry, coreHash: reg.coreHash, own: new Set(defs.map((d) => registry.index.get(d.id) ?? 0).filter((k) => k > 0)) };
}

/**
 * Checks the definitions and, if nothing is wrong with them, compiles them. The order is fixed: errors are listed in
 * it, and one kind reads what another has filled.
 * 1. Renames. Then each definition in the order given: its shape (classes.ts), its id and aliases, its kinds' `check`.
 * 2. What each definition names (refFaults). Each kind's `survey`, in the list's order. Each definition's `among`.
 * 3. The index and the hash, by id. Every kind's `columns`.
 * 4. Each definition by index: `fill`. Then each again: `link`.
 * 5. Each kind's `finish`, in the list's order.
 */
export function compileContent(all: readonly Def[]): CompileResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  // A rename is not content. It is checked here and kept apart.
  const renames = all.filter((d): d is RenameDef => d.type === "rename");
  const input = all.filter((d): d is Content => d.type !== "rename");
  const typeOf = new Map(input.map((d) => [d.id, d.type]));
  for (const r of renames) {
    errors.push(...defFaults(r));
    if (!ID.test(r.id)) errors.push(`"${r.id}": id must look like "namespace:name"`);
    if (typeOf.has(r.id)) errors.push(`${r.id}: is renamed and also defined`);
    if (!Array.isArray(r.to) || r.to.length === 0) continue;
    for (const to of r.to) if (!typeOf.has(to)) errors.push(`${r.id}: is renamed to "${to}", which is not defined`);
    if (new Set(r.to.map((to) => typeOf.get(to))).size > 1) errors.push(`${r.id}: is renamed to things of different types`);
  }
  if (new Set(renames.map((r) => r.id)).size !== renames.length) errors.push("an id is renamed twice");
  const positive = (d: { readonly id: string }, name: string, v: number, max: number) => {
    if (!(v > 0 && v <= max)) errors.push(`${d.id}: ${name} must be in (0, ${max}], got ${v}`);
  };
  const memo = new Map<unknown, unknown>();
  const once = <T>(make: (input: readonly Content[]) => T): T => {
    if (!memo.has(make)) memo.set(make, make(input));
    return memo.get(make) as T;
  };
  const cx: Checking = { input, errors, once, positive };

  const claimed = new Map<string, string>();
  for (const d of input) {
    errors.push(...defFaults(d));
    if (!ID.test(d.id)) errors.push(`"${d.id}": id must look like "namespace:name"`);
    if (seen.has(d.id)) errors.push(`${d.id}: duplicate id`);
    seen.add(d.id);
    for (const a of Array.isArray(d.aliases) ? d.aliases : []) {
      if (!ALIAS.test(a)) errors.push(`${d.id}: alias "${a}" must be one word of letters, digits, "_", "-" and "."`);
      const by = claimed.get(String(a).toLowerCase());
      if (by !== undefined) errors.push(`${d.id}: alias "${a}" is ${by}'s`);
      claimed.set(String(a).toLowerCase(), d.id);
    }
    for (const check of CHECK.get(d.type) ?? NO_HOOKS) check(d, cx);
  }
  // What a definition names must exist and be of the class its field asks for (shared/content/classes.ts).
  errors.push(...refFaults(input));
  for (const k of LIST) k.survey?.(cx);
  for (const d of input) for (const among of AMONG.get(d.type) ?? NO_HOOKS) among(d, cx);
  if (input.length >= 65535) errors.push("too many definitions for a 16-bit index");
  if (errors.length > 0) return { registry: null, errors };

  const sorted = [...input].sort((a, b) => (a.id < b.id ? -1 : 1));
  const defs: (Def | null)[] = [null, ...sorted];
  const ids = ["core:missing", ...sorted.map((d) => d.id)];
  const index = new Map<string, number>();
  const n = defs.length;
  // The hash is of the definitions alone, each as JSON with its keys sorted, in id order. No column is in it.
  let hash = hashString("snark-content-1");
  for (let i = 1; i < n; i++) {
    index.set(sorted[i - 1]!.id, i);
    hash = hashCanonical(sorted[i - 1], hash);
  }
  const redirects = new Map(renames.map((r) => [r.id, r.to.map((to) => index.get(to)!)]));
  const aliases = new Map<string, number>();
  sorted.forEach((d, at) => {
    for (const a of d.aliases ?? []) aliases.set(a.toLowerCase(), at + 1);
  });
  const boxes: number[] = [];
  const parts: FillingParts = { grindLine: new Array(n), vehicleSurface: new Array<VehicleSurface | null>(n).fill(null), start: new Uint32Array(n + 1), box: NO_BOXES };
  const core: Omit<Thawed<Core>, "parts"> & { parts: FillingParts } = {
    defs, ids, index, hash, redirects, renames, aliases, baseHash: hash, tuning: "", source: null, coreHash: hash, own: NONE,
    halfX: f32(n), halfY: f32(n), halfZ: f32(n), parts, keeps: f32(n, 1), bodyRadius: f32(n), bodyHeight: f32(n),
    weapon: list<WeaponParams>(n), damage: f32(n), reach: f32(n), meleeTorpor: f32(n),
  };
  // Spreads, and not Object.assign: V8 keeps an object made by spreads in fast mode whatever its size, and reads one that
  // Object.assign gave this many members ten times as slowly.
  let reg = core as Filling;
  for (const k of LIST) if (k.columns) reg = { ...reg, ...k.columns(n) };
  const making: Making = { once, boxes };
  for (let i = 1; i < n; i++) {
    parts.start[i] = boxes.length / 6;
    for (const fill of FILL.get(sorted[i - 1]!.type) ?? NO_HOOKS) fill(sorted[i - 1]!, i, reg, making);
  }
  parts.start[n] = boxes.length / 6;
  parts.box = Float32Array.from(boxes);
  for (let i = 1; i < n; i++) for (const link of LINK.get(sorted[i - 1]!.type) ?? NO_HOOKS) link(sorted[i - 1]!, i, reg, making);
  for (const k of LIST) k.finish?.(reg, making);
  return { registry: reg, errors };
}

const PLAIN_KEY = /^\w*$/;

/** The hash of `v` written as JSON with its keys sorted, without the text: a map's landmarks write some 25 MB of it. */
function hashCanonical(v: unknown, h: number, inList = false): number {
  if (Array.isArray(v)) {
    let numbers = true;
    for (let i = 0; i < v.length && numbers; i++) numbers = typeof v[i] === "number";
    // A list of numbers is written as JSON writes it.
    if (numbers) return hashString(JSON.stringify(v), h);
    h = hashString("[", h);
    for (let i = 0; i < v.length; i++) h = hashCanonical(v[i], i > 0 ? hashString(",", h) : h, true);
    return hashString("]", h);
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    h = hashString("{", h);
    const keys = Object.keys(o).sort();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if (i > 0) h = hashString(",", h);
      // A name of letters, digits and "_" is written in quotes as it is.
      h = PLAIN_KEY.test(k) ? hashString('":', hashString(k, hashString('"', h))) : hashString(JSON.stringify(k) + ":", h);
      h = hashCanonical(o[k], h);
    }
    return hashString("}", h);
  }
  // What JSON does not write, such as undefined, is left out of a list and written as "undefined" in a field.
  const s = JSON.stringify(v);
  return s !== undefined ? hashString(s, h) : inList ? h : hashString("undefined", h);
}
