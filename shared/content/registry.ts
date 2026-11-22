// Dense indices are assigned in id order, so every process that loads the same definitions gets the same indices and hash.
// Index 0 is reserved. It marks an empty structure slot and stands in for content that no longer exists.

import { validateSeats, type Seat } from "../sim/seats.ts";
import { TICK_RATE } from "../coords.ts";
import { hashString } from "../hash.ts";
import { GAME_HOUR_TICKS } from "../sim/lazy.ts";
import { DAMAGE_TYPES } from "../sim/damage.ts";
import { HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_SPEAR, HOLD_THROW, HOLD_TOOL, SWING_TICKS, W_BOW, W_GUN, W_MELEE, W_THROWN, type WeaponParams } from "../sim/weapon.ts";
import type { PartTable } from "../world/structures.ts";
import type { HullTable } from "../world/convex.ts";
import type { VehicleSurface } from "../sim/vehicle.ts";
import { defFaults, refFaults } from "./classes.ts";
import { MAX_BURN_SECONDS } from "./kinds/stations.ts";
import type { Checking, Kind, Making } from "./kind.ts";
import { KINDS } from "./kinds.ts";
import { type Content, type Def, type RenameDef, type WeaponFacet } from "./defs.ts";

export { MAX_LOOK_PARTS, MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF } from "./kinds/shapes.ts";
export { MAX_LEVELS } from "./kinds/levels.ts";
export { MAX_NODE_HEIGHT, MAX_NODE_HITS, MAX_NODE_VARIANTS, MOST_NODE_SIZE } from "./kinds/nodes.ts";
export { MAX_MOVING_PARTS, MAX_MOVING_REACH } from "./kinds/structures.ts";
export { MAX_BURN_SECONDS } from "./kinds/stations.ts";
export { MUTATION_COLORS, STAMINA_DEFAULT, WILD_COLORS } from "./kinds/species.ts";
export const MISSING = 0;

const ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_\/-]*$/;
const ALIAS = /^[A-Za-z0-9_.-]+$/;

/** What every kind's definitions have, and the columns more than one kind fills. */
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
  /** Item columns, zero for content that is not an item. See shared/sim/items.ts. */
  readonly stack: Uint16Array;
  readonly weight: Float32Array;
  readonly spoilTicks: Uint32Array;
  /** Per item: 1 where its spoil clock is a charge (ItemDef.charge). Per structure kind, `charges`: 1 where it holds one full. */
  readonly charge: Uint8Array;
  /**
   * Soul balls (ItemDef.ball): per item, the item an empty one becomes when it holds a tame, and the item a full one is
   * again when it holds none. 0 for anything else.
   */
  readonly ballFull: Uint16Array;
  readonly ballEmpty: Uint16Array;
  /** Radius and height of a species or prop. Zero otherwise. */
  readonly bodyRadius: Float32Array;
  readonly bodyHeight: Float32Array;
  /** The armor slot an item is worn in (0 head, 1 torso, 2 hands, 3 legs, 4 feet), or -1. */
  readonly wearSlot: Int8Array;
  /** Per item: a glider's grade, 0 for anything else, and the ticks in the air that cost it one use (GlideFacet). */
  readonly glide: Uint8Array;
  readonly glideTicks: Uint32Array;
  /** Uses a tool, weapon or worn piece has at primitive quality. 0 for things that do not wear out. */
  readonly uses: Uint16Array;
  /** Timing of a weapon item, or of a species' bite. Null for everything else. Bare hands are `FISTS`. */
  readonly weapon: readonly (WeaponParams | null)[];
  /** Damage of one melee or thrown hit, or of one round of ammunition, at primitive quality, and its DMG_ type. For a species, its bare hands. */
  readonly damage: Float32Array;
  readonly damageType: Uint8Array;
  /** Melee reach from the eye, in metres. For a species, its bare hands or its bite. */
  readonly reach: Float32Array;
  /** Armor rating of a worn piece at primitive quality. */
  readonly armor: Float32Array;
  /** What a bow or gun multiplies its ammunition's damage by. */
  readonly power: Float32Array;
  /** Ammunition: metres per second at full power (0 if it arrives the tick it is fired), its fall, and the chance a spent round can be picked up. */
  readonly ammoSpeed: Float32Array;
  readonly ammoGravity: Float32Array;
  readonly ammoRecover: Float32Array;
  /** Ammunition: torpor as multiples of the damage done, at once and then over `ammoTorporSeconds`, and the buff it gives (a content index, or 0). */
  readonly ammoTorpor: Float32Array;
  readonly ammoTorporOver: Float32Array;
  readonly ammoTorporSeconds: Float32Array;
  readonly ammoBuff: Uint16Array;
  /** Per structure and node: the boxes bodies and rays meet. One without a shape has a single box. */
  readonly parts: PartTable;
  /** Per placeable item: the structures it may be set down as, the usual one first. Null for everything else. */
  readonly places: readonly (Uint16Array | null)[];
  /** Per assembly item: deployed vehicle kind, or 0. */
  readonly vehicleDeploy: Uint16Array;
  /**
   * Per species and structure: how many times as long things keep in its inventory (a species' or a structure's `keeps`;
   * for a structure the same as structKeeps). 1 for everything else.
   */
  readonly keeps: Float32Array;
  /** Per item: the species it is a saddle for (0 if it is no saddle), and the armor it gives. */
  readonly saddleFits: Uint16Array;
  readonly saddleArmor: Float32Array;
  /** Per item: the seats a saddle puts on the creature that wears it, or null for an item that is no saddle. */
  readonly saddleSeats: readonly (readonly Seat[] | null)[];
  /** Per item: the torpor a dose gives and the seconds it takes (0 if it is no dose). */
  readonly doseTorpor: Float32Array;
  readonly doseSeconds: Float32Array;
  /** Per item: the ticks one burns (0 if it is no fuel), what it becomes over a fire (0 for nothing), and the ticks that takes. */
  readonly fuelTicks: Uint32Array;
  readonly cooksInto: Uint16Array;
  readonly cookTicks: Uint32Array;
  /** Per item: what it becomes when it spoils (ItemDef.spoilsInto), or 0 for nothing. */
  readonly spoilsInto: Uint16Array;
  /** Per item that can be made: the ingredients as pairs of item and count, and how many one crafting makes. Null for everything else. */
  readonly recipeOf: readonly (Uint16Array | null)[];
  readonly recipeMakes: Uint16Array;
  /** Per item: the station it is made at (a structure's content index), or 0 for one made in the hands. */
  readonly craftAt: Uint16Array;
  /** Per item: 1 if it may be a blueprint (ItemDef.blueprint), which takes a craft facet. */
  readonly blueprints: Uint8Array;
  /** A thrown weapon: metres per second off the hand, ticks until it goes off, and how far its blast reaches. */
  readonly throwSpeed: Float32Array;
  readonly fuseTicks: Uint16Array;
  readonly blast: Float32Array;
  /** Torpor of one melee hit, as a multiple of its damage: a melee weapon's, and for a species its bare hands'. */
  readonly meleeTorpor: Float32Array;
  /**
   * Per item: the ticks one lies on the ground before it is gone, or 0 for as long as any dropped stack; and what a young
   * body gives in its place (0 for itself).
   */
  readonly decomposeTicks: Uint32Array;
  readonly youngItem: Uint16Array;
  // The columns of planning/reference/weapons-plan.md. The blow's (W2), the structure factor, blast, pierce and light (W6)
  // are read; the rest are compiled and read by nothing until the project named builds them.
  /** A bow's or gun's blow (W2): its damage at primitive quality (0 for none), torpor as a multiple of it, and reach in metres. */
  readonly blowDamage: Float32Array;
  readonly blowTorpor: Float32Array;
  readonly blowReach: Float32Array;
  /**
   * W6, per weapon: what its damage is multiplied by against a structure (1 where the facet does not say). Kept in doubles,
   * so that the grenade's 788 / 175 gives back the Table of explosives' 788 exactly (D435).
   */
  readonly structureMul: Float64Array;
  /** W5, per thrown weapon that bursts into a cloud: the prop/cloud (0 for none), the ticks it lasts, and its buff (0 for none). */
  readonly cloudProp: Uint16Array;
  readonly cloudTicks: Uint32Array;
  readonly cloudBuff: Uint16Array;
  /**
   * W3, per ammunition: rays a round sends (1 for everything but shot), and the metres its damage falls off from and to (0
   * and 0 for none). `weaponPellets` is a gun's own count in place of its round's, 0 where it has none (shotRays).
   */
  readonly ammoPellets: Uint8Array;
  readonly weaponPellets: Uint8Array;
  readonly ammoFalloffFull: Float32Array;
  readonly ammoFalloffNone: Float32Array;
  /** W6, per ammunition: the reach of the blast where it ends (0 for none), and the share of armor it goes through (both read). */
  readonly ammoBlast: Float32Array;
  readonly ammoPierce: Float32Array;
  /**
   * M9, per ammunition: the reach of the light it carries (0 for none) and its palette colour. A round with a light flies as
   * a prop that every client draws, until it lands (W6, server/projectiles.ts); the light itself is rendering's (D436).
   */
  readonly ammoLight: Float32Array;
  readonly ammoLightColor: Uint8Array;
  /** Per item: what one piece leaves in the fire when it has burnt out (0 for nothing). */
  readonly burnsInto: Uint16Array;
}

type Join<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
/** The columns the kinds add (Kind.columns), as they are filled. */
type Made = Join<ReturnType<NonNullable<(typeof KINDS)[number]["columns"]>>>;
type Frozen<T> = { readonly [K in keyof T]: T[K] extends (infer E)[] ? readonly E[] : T[K] extends Map<infer A, (infer E)[]> ? ReadonlyMap<A, readonly E[]> : T[K] };
type Thawed<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer E)[] ? E[] : T[K] };

/**
 * The compiled content. Each member is a plain field: `reg.maxHp[kind]` is one property and one index. A column is
 * declared, with what it holds, in the file of the kind that fills it (kinds/).
 */
export interface Registry extends Core, Frozen<Made> {}

/** The part table while it is filled: structures and nodes add their boxes (Making.boxes), and structures the rest. */
interface FillingParts {
  vehicleSurface: (VehicleSurface | null)[];
  start: Uint32Array;
  box: Float32Array;
  hulls?: HullTable;
}

/** The registry while it is compiled, which a kind's hooks write. */
export type Filling = Omit<Thawed<Core>, "parts"> & { parts: FillingParts } & Made;

/** The hooks of one name by the type they are given, in the order of the list. */
function hooks<H extends "check" | "among" | "fill" | "link">(name: H): ReadonlyMap<string, NonNullable<Kind<Content>[H]>[]> {
  const out = new Map<string, NonNullable<Kind<Content>[H]>[]>();
  for (const k of KINDS as readonly Kind<Content>[]) {
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

/** Default reach of a melee weapon, in metres. */
const MELEE_REACH = 2.6;
/** The longest any weapon timing may be, in ticks, which is what a body's act counter holds. */
const MAX_ACT_TICKS = 250;
/** The most an optic may magnify (OpticFacet): the Meridian visor's digital zoom is the far end (D1076). */
export const MAX_ZOOM = 2000;
/** The longest an item may keep before it spoils, in game hours. The spoil clock holds this with room to spare. */
export const MAX_SPOIL_HOURS = 1e6;
/** The stats a use may change at once, and the ones it may change over time, which buffs carry (server/use.ts). */
export const USE_AT_ONCE: readonly string[] = ["health", "stamina", "oxygen", "food", "water", "torpidity"];
export const USE_OVER_TIME: readonly string[] = ["health", "torpidity"];

export const WEAR_SLOTS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];

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

export function compileContent(all: readonly Def[]): CompileResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  // A rename is not content. It is checked here and kept apart.
  const renames = all.filter((d): d is RenameDef => d.type === "rename");
  const input = all.filter((d): d is Exclude<Def, RenameDef> => d.type !== "rename");
  const typeOf = new Map(input.map((d) => [d.id, d.type]));
  const defOf = new Map(input.map((d) => [d.id, d]));
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
    if (d.type === "item") {
      if (!(Number.isInteger(d.stack) && d.stack >= 1 && d.stack <= 65535)) errors.push(`${d.id}: stack must be a whole number from 1 to 65535`);
      if (d.deploys !== undefined && (d.stack !== 1 || d.places !== undefined || d.weapon !== undefined || d.eat !== undefined)) errors.push(`${d.id}: a vehicle assembly stacks to 1 and has no other use`);
      if (d.craft) {
        if (d.craft.count !== undefined) positive(d, "craft.count", d.craft.count, 1000);
        positive(d, "craft.seconds", d.craft.seconds, 86400);
        if (!Array.isArray(d.craft.needs) || d.craft.needs.length === 0) errors.push(`${d.id}: craft needs at least one ingredient`);
        if (d.craft.level !== undefined) positive(d, "craft.level", d.craft.level, 1000);
      }
      if (d.weight !== undefined && !(d.weight >= 0)) errors.push(`${d.id}: weight must not be negative`);
      if (d.saddle) {
        try {
          validateSeats(d.saddle.seats, 0, "saddle");
        } catch (e) { errors.push(`${d.id}: ${(e as Error).message}`); }
      }
      if (d.optic) {
        // At least 1x, at most MAX_ZOOM; a zooming one's steps rise inside its range.
        const { min, max = min, steps = [] } = d.optic;
        if (!(min >= 1 && max >= min && max <= MAX_ZOOM)) errors.push(`${d.id}: optic must magnify from at least 1 to at most ${MAX_ZOOM}, min first`);
        if (steps.some((z, k) => !(z >= min && z <= max && (k === 0 || z > steps[k - 1]!)))) errors.push(`${d.id}: optic.steps must rise from optic.min to optic.max`);
        if (d.optic.window && !d.optic.window.every((w) => w > 0 && w <= 1)) errors.push(`${d.id}: optic.window must be two shares of the screen's height, above 0 and at most 1`);
      }
      if (d.fuel !== undefined) positive(d, "fuel", d.fuel, MAX_BURN_SECONDS);
      if (d.cooks !== undefined) positive(d, "cooks.seconds", d.cooks.seconds, MAX_BURN_SECONDS);
      if (d.spoilHours !== undefined && !(d.spoilHours > 0 && d.spoilHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: spoilHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
      if (d.decomposeHours !== undefined && !(d.decomposeHours > 0 && d.decomposeHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: decomposeHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
      // Anything that wears out, holds rounds or takes an attachment cannot stack.
      if ((d.weapon || d.wear || d.tool) && d.stack !== 1 && d.weapon?.kind !== "thrown") errors.push(`${d.id}: a tool, weapon or worn piece must have stack 1`);
      if (d.glide) {
        if (!(Number.isInteger(d.glide.grade) && d.glide.grade >= 1 && d.glide.grade <= 3)) errors.push(`${d.id}: glide.grade must be 1, 2 or 3`);
        positive(d, "glide.uses", d.glide.uses, 60000);
        positive(d, "glide.seconds", d.glide.seconds, 3600);
        // Its wear is the slot's durability, which one of a kind has.
        if (d.stack !== 1 || d.weapon || d.wear || d.tool || d.use?.holds) errors.push(`${d.id}: a glider stacks to 1 and wears no other durability`);
      }
      if (d.charge && (d.spoilHours === undefined || d.stack !== 1)) errors.push(`${d.id}: only an item that spoils and stacks to 1 has a charge`);
      if (d.ball) {
        // An empty ball names its full form and a full one its empty, and each is the other's.
        const other = d.ball.full ?? d.ball.empty;
        const o = other === undefined ? undefined : defOf.get(other);
        if ((d.ball.full === undefined) === (d.ball.empty === undefined)) errors.push(`${d.id}: a ball names its full item or its empty one, and not both`);
        else if (o?.type !== "item" || !o.ball || (d.ball.full !== undefined ? o.ball.empty : o.ball.full) !== d.id) errors.push(`${d.id}: ${other} is not the ball that names it back`);
        if (d.stack !== 1 || d.weapon?.kind !== "thrown") errors.push(`${d.id}: a ball stacks to 1 and is thrown`);
        if (d.ball.empty !== undefined && (!d.charge || d.spoilsInto !== d.ball.empty || d.craft)) errors.push(`${d.id}: a full ball has a charge, spoils into its empty item and is never made`);
      }
      const w = d.weapon;
      if (w) {
        positive(d, "weapon.uses", w.uses, 60000);
        // A thrown weapon with an ammo facet of its own flies and hits with that facet's damage, which may be none (the bola);
        // one that bursts into a cloud may do no harm of its own (smoke, poison: W5).
        // A soul ball is thrown, and harms nothing (ItemDef.ball).
        if ((w.kind === "melee" || (w.kind === "thrown" && !d.ammo && !w.cloud && !d.ball)) && !(w.damage! > 0 && w.type)) errors.push(`${d.id}: a ${w.kind} weapon needs damage and a type`);
        if (d.ammo && !(w.kind === "thrown" && d.ammo.speed !== undefined)) errors.push(`${d.id}: a weapon with an ammo facet of its own is thrown, and flies at its ammo.speed`);
        if (d.ammo && w.fuse !== undefined) errors.push(`${d.id}: a thrown weapon that flies and hits has no fuse`);
        if ((w.kind === "bow" || w.kind === "gun") && !(w.ammo && w.ammo.length > 0)) errors.push(`${d.id}: a ${w.kind} needs the ammunition it takes`);
        if (w.kind === "bow" && !(w.draw! > 0)) errors.push(`${d.id}: a bow needs a draw time`);
        if (w.clip !== undefined && !(Number.isInteger(w.clip) && w.clip >= 1 && w.clip <= 255)) errors.push(`${d.id}: weapon.clip must be a whole number from 1 to 255`);
        if (w.torpor !== undefined && !(w.kind === "melee" && w.torpor >= 0)) errors.push(`${d.id}: weapon.torpor is a melee weapon's, and not negative`);
        for (const [name, v] of [["reload", w.reload], ["draw", w.draw], ["interval", w.interval]] as const) {
          if (v !== undefined && !(v > 0 && v * TICK_RATE <= MAX_ACT_TICKS)) errors.push(`${d.id}: weapon.${name} must be above 0 and at most ${MAX_ACT_TICKS / TICK_RATE} seconds`);
        }
        // The stubs of planning/reference/weapons-plan.md are checked before anything reads them.
        if ((w.auto || w.reloadEach || w.spread || w.recoil || w.melee) && w.kind !== "bow" && w.kind !== "gun") errors.push(`${d.id}: weapon.auto, reloadEach, spread, recoil and melee are a bow's or gun's`);
        if (w.draw !== undefined && w.kind !== "bow" && w.kind !== "thrown") errors.push(`${d.id}: weapon.draw is a bow's, or a thrown weapon's that is charged`);
        // A round at a time counts the round under way past its reload once it is the last, within a byte (shared/sim/weapon.ts).
        if (w.reloadEach && !((w.reload ?? 0) * TICK_RATE <= MAX_ACT_TICKS / 2)) errors.push(`${d.id}: weapon.reload of a round at a time must be at most ${Math.floor((MAX_ACT_TICKS / 2 / TICK_RATE) * 10) / 10} seconds`);
        if (w.melee) {
          positive(d, "weapon.melee.damage", w.melee.damage, 60000);
          if (w.melee.torpor !== undefined && !(w.melee.torpor >= 0)) errors.push(`${d.id}: weapon.melee.torpor must not be negative`);
          if (w.melee.reach !== undefined) positive(d, "weapon.melee.reach", w.melee.reach, 100);
          if (w.melee.interval !== undefined && !(w.melee.interval > 0 && w.melee.interval * TICK_RATE <= MAX_ACT_TICKS)) errors.push(`${d.id}: weapon.melee.interval must be above 0 and at most ${MAX_ACT_TICKS / TICK_RATE} seconds`);
        }
        const sp = w.spread;
        if (sp && ![sp.hip, sp.aim, sp.move ?? 0, sp.bloom ?? 0, sp.recover ?? 0, sp.sway ?? 0].every((v) => v >= 0 && v <= 90)) errors.push(`${d.id}: weapon.spread is in degrees from 0 to 90`);
        if (sp && (sp.bloom ?? 0) > 0 && !((sp.recover ?? 0) > 0)) errors.push(`${d.id}: weapon.spread that blooms must recover`);
        if (w.recoil && !(w.recoil.kick >= 0 && w.recoil.kick <= 90 && w.recoil.recover >= 0)) errors.push(`${d.id}: weapon.recoil.kick is in degrees from 0 to 90, and its recovery not negative`);
        if (w.recoil && w.recoil.kick > 0 && !(w.recoil.recover > 0)) errors.push(`${d.id}: weapon.recoil that kicks must recover`);
        if (w.structures !== undefined && !(w.structures >= 0)) errors.push(`${d.id}: weapon.structures must not be negative`);
        if (w.pellets !== undefined && !(w.kind === "gun" && Number.isInteger(w.pellets) && w.pellets >= 1 && w.pellets <= 255)) errors.push(`${d.id}: weapon.pellets is a gun's, a whole number from 1 to 255`);
        if (w.cloud) {
          if (w.kind !== "thrown") errors.push(`${d.id}: only a thrown weapon bursts into a cloud`);
          positive(d, "weapon.cloud.seconds", w.cloud.seconds, MAX_BURN_SECONDS);
        }
      }
      if (d.ammo && !(d.ammo.damage >= 0)) errors.push(`${d.id}: ammo.damage must not be negative`);
      if (d.ammo?.speed !== undefined && !(d.ammo.speed > 0 && d.ammo.speed <= 1000)) errors.push(`${d.id}: ammo.speed must be above 0 and at most 1000`);
      if (d.ammo?.recover !== undefined && !(d.ammo.recover >= 0 && d.ammo.recover <= 1)) errors.push(`${d.id}: ammo.recover must be from 0 to 1`);
      const am = d.ammo;
      if (am?.pellets !== undefined && !(Number.isInteger(am.pellets) && am.pellets >= 1 && am.pellets <= 255)) errors.push(`${d.id}: ammo.pellets must be a whole number from 1 to 255`);
      if ((am?.pellets ?? 1) > 1 && am?.speed !== undefined) errors.push(`${d.id}: ammo.pellets above 1 is for a round with no speed`);
      if (am?.falloff && !(am.falloff.full >= 0 && am.falloff.none > am.falloff.full)) errors.push(`${d.id}: ammo.falloff is full from 0 metres or more, and none further than that`);
      if (am?.blast !== undefined) positive(d, "ammo.blast", am.blast, 100);
      if (am?.pierce !== undefined && !(am.pierce >= 0 && am.pierce <= 1)) errors.push(`${d.id}: ammo.pierce must be from 0 to 1`);
      if (am?.light) {
        // A light is carried by a round that flies, as a prop, until it lands (W6).
        if (am.speed === undefined) errors.push(`${d.id}: a round that carries a light flies, at its ammo.speed`);
        positive(d, "ammo.light.reach", am.light.reach, 1000);
        if (!paletteIndex(am.light.color)) errors.push(`${d.id}: ammo.light.color must be a palette index`);
      }
      if (d.wear) {
        if (!WEAR_SLOTS.includes(d.wear.slot)) errors.push(`${d.id}: wear.slot must be one of ${WEAR_SLOTS.join(", ")}`);
        if (!(d.wear.armor >= 0)) errors.push(`${d.id}: wear.armor must not be negative`);
        positive(d, "wear.uses", d.wear.uses, 60000);
      }
      if (d.spoilsInto !== undefined && (d.spoilsInto === d.id || d.spoilHours === undefined)) errors.push(`${d.id}: spoilsInto names another item, and only something that spoils has it`);
      // A blueprint crafts what it is of, so only an item that is crafted may be one.
      if (d.blueprint === true && !d.craft) errors.push(`${d.id}: only an item that is crafted may be a blueprint`);
      // What using one does (server/use.ts). Over time only health and torpor, which buffs carry; the rest at once.
      const use = d.use;
      for (const a of use?.adds ?? []) {
        const timed = a.seconds !== undefined;
        if (!(timed ? USE_OVER_TIME : USE_AT_ONCE).includes(a.stat)) errors.push(`${d.id}: use.adds may change ${(timed ? USE_OVER_TIME : USE_AT_ONCE).join(", ")}${timed ? " over time" : ""}, not "${a.stat}"`);
        if (!(Number.isFinite(a.amount) && a.amount !== 0 && (!timed || a.amount > 0))) errors.push(`${d.id}: use.adds amount must be a number other than 0, and above 0 over time`);
        if (timed) positive(d, "use.adds seconds", a.seconds!, MAX_BURN_SECONDS);
      }
      if (use?.holds) {
        positive(d, "use.holds.water", use.holds.water, 60000);
        positive(d, "use.holds.each", use.holds.each, use.holds.water);
        // The water is held as the slot's durability, which one of a kind has.
        if (d.stack !== 1 || d.eat || d.dose || d.weapon || d.wear || d.tool) errors.push(`${d.id}: a vessel stacks to 1, wears no durability of its own, and is drunk from, not eaten`);
      }
    }
  }
  // What a definition names must exist and be of the class its field asks for (shared/content/classes.ts).
  errors.push(...refFaults(input));
  for (const k of KINDS as readonly Kind<Content>[]) k.survey?.(cx);
  const noAmmo = new Set(input.flatMap((d) => (d.type === "item" && !d.ammo ? [d.id] : [])));
  const young = new Map<string, string>();
  for (const d of input) {
    for (const among of AMONG.get(d.type) ?? NO_HOOKS) among(d, cx);
    if (d.type === "item" && d.places && d.places.length === 0) errors.push(`${d.id}: places must name at least one structure`);
    for (const a of d.type === "item" ? (d.weapon?.ammo ?? []) : []) if (noAmmo.has(a)) errors.push(`${d.id}: "${a}" has no ammo facet, so it cannot be fired`);
    if (d.type === "item" && d.youngFor !== undefined) {
      const other = young.get(d.youngFor);
      if (other !== undefined) errors.push(`${d.id}: ${other} is already given in place of "${d.youngFor}"`);
      young.set(d.youngFor, d.id);
    }
  }
  if (input.length >= 65535) errors.push("too many definitions for a 16-bit index");
  if (errors.length > 0) return { registry: null, errors };

  const sorted = [...input].sort((a, b) => (a.id < b.id ? -1 : 1));
  const defs: (Def | null)[] = [null, ...sorted];
  const ids = ["core:missing", ...sorted.map((d) => d.id)];
  const index = new Map<string, number>();
  const n = defs.length;
  const halfX = new Float32Array(n);
  const halfY = new Float32Array(n);
  const halfZ = new Float32Array(n);
  const stack = new Uint16Array(n);
  const weight = new Float32Array(n);
  const spoilTicks = new Uint32Array(n);
  const charge = new Uint8Array(n);
  const ballFull = new Uint16Array(n);
  const ballEmpty = new Uint16Array(n);
  const bodyRadius = new Float32Array(n);
  const bodyHeight = new Float32Array(n);
  const wearSlot = new Int8Array(n).fill(-1);
  const uses = new Uint16Array(n);
  const glide = new Uint8Array(n);
  const glideTicks = new Uint32Array(n);
  const weapon: (WeaponParams | null)[] = new Array(n).fill(null);
  const damage = new Float32Array(n);
  const damageType = new Uint8Array(n);
  const reach = new Float32Array(n);
  const armor = new Float32Array(n);
  const power = new Float32Array(n);
  const ammoSpeed = new Float32Array(n);
  const ammoGravity = new Float32Array(n);
  const ammoRecover = new Float32Array(n);
  const ammoTorpor = new Float32Array(n);
  const ammoTorporOver = new Float32Array(n);
  const ammoTorporSeconds = new Float32Array(n);
  const ammoBuff = new Uint16Array(n);
  const places: (Uint16Array | null)[] = new Array(n).fill(null);
  const vehicleDeploy = new Uint16Array(n);
  const keeps = new Float32Array(n).fill(1);
  const saddleFits = new Uint16Array(n);
  const saddleArmor = new Float32Array(n);
  const saddleSeats: (readonly Seat[] | null)[] = new Array(n).fill(null);
  const doseTorpor = new Float32Array(n);
  const doseSeconds = new Float32Array(n);
  const fuelTicks = new Uint32Array(n);
  const cooksInto = new Uint16Array(n);
  const cookTicks = new Uint32Array(n);
  const spoilsInto = new Uint16Array(n);
  const recipeOf: (Uint16Array | null)[] = new Array(n).fill(null);
  const recipeMakes = new Uint16Array(n);
  const craftAt = new Uint16Array(n);
  const blueprints = new Uint8Array(n);
  const partStart = new Uint32Array(n + 1);
  const partBox: number[] = [];
  const throwSpeed = new Float32Array(n);
  const fuseTicks = new Uint16Array(n);
  const blast = new Float32Array(n);
  const meleeTorpor = new Float32Array(n);
  const decomposeTicks = new Uint32Array(n);
  const youngItem = new Uint16Array(n);
  const blowDamage = new Float32Array(n);
  const blowTorpor = new Float32Array(n);
  const blowReach = new Float32Array(n);
  const structureMul = new Float64Array(n).fill(1);
  const cloudProp = new Uint16Array(n);
  const cloudTicks = new Uint32Array(n);
  const cloudBuff = new Uint16Array(n);
  const ammoPellets = new Uint8Array(n).fill(1);
  const weaponPellets = new Uint8Array(n);
  const ammoFalloffFull = new Float32Array(n);
  const ammoFalloffNone = new Float32Array(n);
  const ammoBlast = new Float32Array(n);
  const ammoPierce = new Float32Array(n);
  const ammoLight = new Float32Array(n);
  const ammoLightColor = new Uint8Array(n);
  const burnsInto = new Uint16Array(n);
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
  const parts: FillingParts = { vehicleSurface: new Array<VehicleSurface | null>(n).fill(null), start: partStart, box: NO_BOXES };
  const core: Omit<Thawed<Core>, "parts"> & { parts: FillingParts } = { defs, ids, index, hash, redirects, renames, aliases, baseHash: hash, tuning: "", source: null, coreHash: hash, own: NONE, halfX, halfY, halfZ, parts, places, vehicleDeploy, keeps, saddleFits, saddleArmor, saddleSeats, doseTorpor, doseSeconds, fuelTicks, cooksInto, cookTicks, spoilsInto, recipeOf, recipeMakes, craftAt, blueprints, stack, weight, spoilTicks, charge, ballFull, ballEmpty, bodyRadius, bodyHeight, wearSlot, glide, glideTicks, uses, weapon, damage, damageType, reach, armor, power, ammoSpeed, ammoGravity, ammoRecover, ammoTorpor, ammoTorporOver, ammoTorporSeconds, ammoBuff, throwSpeed, fuseTicks, blast, meleeTorpor, decomposeTicks, youngItem, blowDamage, blowTorpor, blowReach, structureMul, cloudProp, cloudTicks, cloudBuff, ammoPellets, weaponPellets, ammoFalloffFull, ammoFalloffNone, ammoBlast, ammoPierce, ammoLight, ammoLightColor, burnsInto };
  // Spreads, and not Object.assign: V8 keeps an object made by spreads in fast mode whatever its size, and reads one that
  // Object.assign gave this many members ten times as slowly.
  let reg = core as Filling;
  for (const k of KINDS) if ("columns" in k) reg = { ...reg, ...(k as Kind<Content, Made>).columns!(n) };
  const making: Making = { once, boxes: partBox };
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    partStart[i] = partBox.length / 6;
    for (const fill of FILL.get(d.type) ?? NO_HOOKS) fill(d as Content, i, reg, making);
    if (d.type === "item") {
      stack[i] = d.stack;
      weight[i] = d.weight ?? 0.1;
      // At least 1 tick, because 0 means the item never spoils.
      spoilTicks[i] = d.spoilHours !== undefined ? Math.max(1, Math.round(d.spoilHours * GAME_HOUR_TICKS)) : 0;
      decomposeTicks[i] = d.decomposeHours !== undefined ? Math.max(1, Math.round(d.decomposeHours * GAME_HOUR_TICKS)) : 0;
      if (d.charge) charge[i] = 1;
      if (d.wear) wearSlot[i] = WEAR_SLOTS.indexOf(d.wear.slot);
      uses[i] = d.wear?.uses ?? d.weapon?.uses ?? d.tool?.uses ?? d.glide?.uses ?? 0;
      if (d.glide) {
        glide[i] = d.glide.grade;
        glideTicks[i] = Math.max(1, Math.round(d.glide.seconds * TICK_RATE));
      }
      armor[i] = d.wear?.armor ?? 0;
      if (d.weapon) {
        weapon[i] = weaponParams(d.weapon);
        reach[i] = d.weapon.reach ?? MELEE_REACH;
        power[i] = d.weapon.power ?? 1;
        throwSpeed[i] = d.weapon.speed ?? 0;
        fuseTicks[i] = Math.min(65535, Math.round((d.weapon.fuse ?? 0) * TICK_RATE));
        blast[i] = d.weapon.blast ?? 0;
        meleeTorpor[i] = d.weapon.torpor ?? 0;
        if (d.weapon.melee) {
          blowDamage[i] = d.weapon.melee.damage;
          blowTorpor[i] = d.weapon.melee.torpor ?? 0;
          blowReach[i] = d.weapon.melee.reach ?? MELEE_REACH;
        }
        structureMul[i] = d.weapon.structures ?? 1;
        weaponPellets[i] = d.weapon.pellets ?? 0;
        if (d.weapon.cloud) cloudTicks[i] = Math.max(1, Math.round(d.weapon.cloud.seconds * TICK_RATE));
      }
      if (d.ammo) {
        ammoSpeed[i] = d.ammo.speed ?? 0;
        ammoGravity[i] = d.ammo.gravity ?? 0;
        ammoRecover[i] = d.ammo.recover ?? 0;
        ammoTorpor[i] = d.ammo.torpor?.instant ?? 0;
        ammoTorporOver[i] = d.ammo.torpor?.over ?? 0;
        ammoTorporSeconds[i] = d.ammo.torpor?.seconds ?? 0;
        // Ids are sorted, so a definition's index is its place among them plus one.
        if (d.ammo.buff !== undefined) ammoBuff[i] = sorted.findIndex((o) => o.id === d.ammo!.buff) + 1;
        ammoPellets[i] = d.ammo.pellets ?? 1;
        ammoFalloffFull[i] = d.ammo.falloff?.full ?? 0;
        ammoFalloffNone[i] = d.ammo.falloff?.none ?? 0;
        ammoBlast[i] = d.ammo.blast ?? 0;
        ammoPierce[i] = d.ammo.pierce ?? 0;
        ammoLight[i] = d.ammo.light?.reach ?? 0;
        ammoLightColor[i] = d.ammo.light?.color ?? 0;
      }
      const hits = d.ammo ?? d.weapon;
      if (hits?.damage !== undefined) {
        damage[i] = hits.damage;
        damageType[i] = Math.max(0, DAMAGE_TYPES.indexOf(hits.type ?? "melee"));
      }
    }
  }
  partStart[n] = partBox.length / 6;
  parts.box = Float32Array.from(partBox);
  // A second pass resolves references, now that every definition has its index.
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    for (const link of LINK.get(d.type) ?? NO_HOOKS) link(d as Content, i, reg, making);
    if (d.type === "item" && d.places) {
      places[i] = Uint16Array.from(d.places, (id) => index.get(id)!);
      // Every form of a piece maps back to the one item.
      for (const s of places[i]!) if (reg.pieceItem[s] === 0) reg.pieceItem[s] = i;
    }
    if (d.type === "item" && d.youngFor !== undefined) youngItem[index.get(d.youngFor)!] = i;
    if (d.type === "item" && d.weapon?.cloud) {
      cloudProp[i] = index.get(d.weapon.cloud.prop)!;
      if (d.weapon.cloud.buff !== undefined) cloudBuff[i] = index.get(d.weapon.cloud.buff)!;
    }
    if (d.type === "item" && d.saddle) {
      saddleFits[i] = index.get(d.saddle.fits)!;
      saddleArmor[i] = d.saddle.armor;
      saddleSeats[i] = d.saddle.seats;
    }
    if (d.type === "item" && d.deploys !== undefined) vehicleDeploy[i] = index.get(d.deploys)!;
    if (d.type === "item" && d.dose) {
      doseTorpor[i] = d.dose.torpor;
      doseSeconds[i] = d.dose.seconds;
    }
    if (d.type === "item") {
      // At least 1 tick, because 0 means it is no fuel.
      fuelTicks[i] = d.fuel !== undefined ? Math.max(1, Math.round(d.fuel * TICK_RATE)) : 0;
      if (d.cooks) {
        cooksInto[i] = index.get(d.cooks.into)!;
        cookTicks[i] = Math.max(1, Math.round(d.cooks.seconds * TICK_RATE));
      }
      if (d.spoilsInto !== undefined) spoilsInto[i] = index.get(d.spoilsInto)!;
      if (d.ball?.full !== undefined) ballFull[i] = index.get(d.ball.full)!;
      if (d.ball?.empty !== undefined) ballEmpty[i] = index.get(d.ball.empty)!;
      if (d.burnsInto !== undefined) burnsInto[i] = index.get(d.burnsInto)!;
    }
    if (d.type === "item" && d.craft) {
      recipeOf[index.get(d.id)!] = Uint16Array.from(d.craft.needs.flatMap((need) => [index.get(need.item)!, need.count]));
      recipeMakes[index.get(d.id)!] = d.craft.count ?? 1;
      if (d.craft.at !== undefined) craftAt[index.get(d.id)!] = index.get(d.craft.at)!;
      // What a fire makes by itself is made from no blueprint.
      if (d.blueprint !== false && !d.craft.fired) blueprints[index.get(d.id)!] = 1;
    }
  }
  for (const k of KINDS as readonly Kind<Content>[]) k.finish?.(reg, making);
  return { registry: reg, errors };
}

const paletteIndex = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 256;

/**
 * The rays a shot of `ammo` from `weapon` sends, each tested and landed alone (W3): the gun's own count if it gives one, as
 * ARK's pump-action fires the double-barrel's shells as 14 pellets in place of 10, else its round's. A round that flies is
 * always one.
 */
export function shotRays(reg: Registry, weapon: number, ammo: number): number {
  if (reg.ammoSpeed[ammo]! > 0) return 1;
  return reg.weaponPellets[weapon] || reg.ammoPellets[ammo] || 1;
}

const HOLDS: Readonly<Record<WeaponFacet["hold"], number>> = { tool: HOLD_TOOL, spear: HOLD_SPEAR, bow: HOLD_BOW, rifle: HOLD_RIFLE, pistol: HOLD_PISTOL };

function weaponParams(w: WeaponFacet): WeaponParams {
  const ticks = (seconds: number | undefined, fallback: number): number => (seconds === undefined ? fallback : Math.max(1, Math.round(seconds * TICK_RATE)));
  const kind = w.kind === "melee" ? W_MELEE : w.kind === "bow" ? W_BOW : w.kind === "gun" ? W_GUN : W_THROWN;
  // A swing, or the pause after a shot. A bow or a single-round gun pauses briefly, because the reload that follows is the wait.
  const swingTicks = ticks(w.interval, kind === W_BOW ? 6 : kind === W_GUN && (w.clip ?? 1) === 1 ? 3 : SWING_TICKS);
  // A thrown weapon with a draw is a charged throw (W2), held as a bow is drawn.
  const drawTicks = kind === W_BOW || (kind === W_THROWN && w.draw !== undefined) ? ticks(w.draw, 1) : 0;
  return {
    kind,
    hold: kind === W_THROWN ? HOLD_THROW : (HOLDS[w.hold] ?? HOLD_HANDS),
    swingTicks,
    // A blow lands a third of the way through its swing. A throw leaves the hand a little later.
    strikeTick: Math.max(1, Math.min(swingTicks - 1, Math.round(swingTicks * (kind === W_THROWN ? 0.45 : 1 / 3)))),
    drawTicks,
    minDrawTicks: Math.round(drawTicks / 4),
    reloadTicks: kind === W_BOW || kind === W_GUN ? ticks(w.reload, 1) : 0,
    clip: kind === W_BOW || kind === W_GUN ? (w.clip ?? 1) : 0,
    wet: w.wet ?? (kind === W_MELEE),
    // Fire modes and the blow (planning/reference/weapons-plan.md, M4), only where the facet says.
    ...(w.auto ? { auto: true } : {}),
    ...(w.reloadEach ? { reloadEach: true } : {}),
    ...(w.melee ? blowParams(ticks(w.melee.interval, SWING_TICKS)) : {}),
    ...(w.spread ? { coneHip: w.spread.hip, coneAim: w.spread.aim, coneMove: w.spread.move ?? 0, coneBloom: w.spread.bloom ?? 0, coneRecover: (w.spread.recover ?? 0) / TICK_RATE, coneSway: w.spread.sway ?? 0 } : {}),
    ...(w.recoil ? { recoilKick: w.recoil.kick, recoilRecover: w.recoil.recover / TICK_RATE } : {}),
  };
}

/** A gun's blow (W2): a swing of `ticks` that lands a third of the way through, as a melee weapon's does. */
function blowParams(ticks: number): { meleeTicks: number; meleeStrikeTick: number } {
  return { meleeTicks: ticks, meleeStrikeTick: Math.max(1, Math.min(ticks - 1, Math.round(ticks / 3))) };
}


const PLAIN_KEY = /^\w*$/;

/** The hash of `v` written as JSON with its keys sorted, without the text: a map's landmarks write some 25 MB of it. */
function hashCanonical(v: unknown, h: number, inList = false): number {
  if (Array.isArray(v)) {
    let numbers = true;
    for (let i = 0; i < v.length && numbers; i++) numbers = typeof v[i] === "number";
    // JSON writes a list of numbers as canonical does.
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
  // What JSON does not write, such as undefined, canonical leaves out of a list and writes as "undefined" in a field.
  const s = JSON.stringify(v);
  return s !== undefined ? hashString(s, h) : inList ? h : hashString("undefined", h);
}
