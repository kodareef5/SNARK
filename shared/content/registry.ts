// Dense indices are assigned in id order, so every process that loads the same definitions gets the same indices and hash.
// Index 0 is reserved. It marks an empty structure slot and stands in for content that no longer exists.

import { BIRTH_SCALE } from "../sim/breeding.ts";
import type { TameParams } from "../sim/taming.ts";
import { TICK_RATE } from "../coords.ts";
import { hashString } from "../hash.ts";
import { STAMINA_UNITS, type MoveParams } from "../sim/character.ts";
import { STAT_NAMES } from "../sim/genome.ts";
import { GAME_HOUR_TICKS } from "../sim/lazy.ts";
import { ZONE_COUNT } from "../anim/human.ts";
import { DAMAGE_TYPES } from "../sim/damage.ts";
import { HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_SPEAR, HOLD_THROW, HOLD_TOOL, SWING_TICKS, W_BOW, W_GUN, W_MELEE, W_THROWN, type WeaponParams } from "../sim/weapon.ts";
import type { PartTable } from "../world/structures.ts";
import { PIECE_ROLES, shapeHalf, type Def, type SpeciesDef, type WeaponFacet } from "./defs.ts";

export const MISSING = 0;
export const MAX_STRUCTURE_HALF = 16;
export const MAX_SHAPE_BOXES = 16;

const ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_\/-]*$/;
const GRAVITY = 20;
const SLOPE_COS = 0.6427876096865394; // 50 degrees

export interface Registry {
  /** Definitions by dense index. Entry 0 is null. */
  readonly defs: readonly (Def | null)[];
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  /** Changes whenever any definition changes. Client and server must match. */
  readonly hash: number;
  /**
   * For a registry a server's settings have tuned (shared/content/tuning.ts): the hash of the untuned definitions, the
   * tuning as text, and the untuned registry. For untuned content: its own hash, "", and null.
   */
  readonly baseHash: number;
  readonly tuning: string;
  readonly source: Registry | null;
  /** Collider half extents of structures and nodes. 0 for everything else. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  /** Null for everything that is not a species. */
  readonly move: readonly (MoveParams | null)[];
  /** Item columns, zero for content that is not an item. See shared/sim/items.ts. */
  readonly stack: Uint16Array;
  readonly weight: Float32Array;
  readonly spoilTicks: Uint32Array;
  /** Radius and height of a species or prop. Zero otherwise. */
  readonly bodyRadius: Float32Array;
  readonly bodyHeight: Float32Array;
  /** 1 for box kinds that bodies pass through (bushes). */
  readonly soft: Uint8Array;
  readonly nodeHits: Float32Array;
  /** The armor slot an item is worn in (0 head, 1 torso, 2 hands, 3 legs, 4 feet), or -1. */
  readonly wearSlot: Int8Array;
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
  /** Per species: the multiplier on each DMG_ type it takes, and on a hit to each zone. Null for everything else. */
  readonly takes: readonly (Float32Array | null)[];
  readonly zoneMul: readonly (Float32Array | null)[];
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
  /** Per structure: the multiplier on each DMG_ type, from its material. Null for everything else, and for a structure nothing harms. */
  readonly structTakes: readonly (Float32Array | null)[];
  /** Per structure and node: the boxes bodies and rays meet. One without a shape has a single box. */
  readonly parts: PartTable;
  /** Per structure with a shape: an index into PIECE_ROLES. -1 for everything else. */
  readonly role: Int8Array;
  /** Per structure: 1 if it is a wall with a doorway. */
  readonly doorway: Uint8Array;
  /** Per placeable item: the structures it may be set down as, the usual one first. Null for everything else. */
  readonly places: readonly (Uint16Array | null)[];
  /** Per structure: the item that places it (0 if none), its full health, and the days it lasts unvisited (0 means for ever). */
  readonly pieceItem: Uint16Array;
  readonly maxHp: Float32Array;
  readonly decayDays: Float32Array;
  /** Per structure: the stacks it holds, the structure it becomes when used (0 for none), whether it starts locked, and whether it drops whole. */
  readonly structSlots: Uint16Array;
  readonly opens: Uint16Array;
  readonly lockedAtFirst: Uint8Array;
  readonly fallsWhole: Uint8Array;
  /** Per structure: the structure it becomes when lit or put out (0 if it is no fire), whether it is the burning one, and whether it is a bed. */
  readonly lights: Uint16Array;
  readonly burning: Uint8Array;
  readonly isBed: Uint8Array;
  /** Per species: the speed from which it is drawn running, in metres per second. */
  readonly runAt: Float32Array;
  /** Per species: its taming numbers, or null if it cannot be tamed, and what it eats, best first, as triples of item, food and affinity. */
  readonly taming: readonly (TameParams | null)[];
  readonly eats: readonly (readonly number[] | null)[];
  /**
   * Per species that breeds: the prop a female lays (0 if she bears live young), the ticks to hatch and the ticks to grow up,
   * both at the reference's rates, and a newborn's size as a share of a grown one. A species that does not breed has 0xffff
   * and 0 ticks.
   */
  readonly breedEgg: Uint16Array;
  readonly incubateTicks: Uint32Array;
  readonly matureTicks: Uint32Array;
  readonly birthScale: Float32Array;
  /** Per item: the species it is a saddle for (0 if it is no saddle), and the armor it gives. */
  readonly saddleFits: Uint16Array;
  readonly saddleArmor: Float32Array;
  /** Per item: the torpor a dose gives and the seconds it takes (0 if it is no dose). */
  readonly doseTorpor: Float32Array;
  readonly doseSeconds: Float32Array;
  /** Per species: its temper (0 flees, 1 defends, 2 hunts), and its sight and leash in metres. */
  readonly temper: Uint8Array;
  readonly sight: Float32Array;
  readonly leash: Float32Array;
  /** Per item: the ticks one burns (0 if it is no fuel), what it becomes over a fire (0 for nothing), and the ticks that takes. */
  readonly fuelTicks: Uint32Array;
  readonly cooksInto: Uint16Array;
  readonly cookTicks: Uint32Array;
  /** Per item a recipe makes: the ingredients as pairs of item and count, and how many one crafting makes. Null for everything else. */
  readonly recipeOf: readonly (Uint16Array | null)[];
  readonly recipeMakes: Uint16Array;
  /** A thrown weapon: metres per second off the hand, ticks until it goes off, and how far its blast reaches. */
  readonly throwSpeed: Float32Array;
  readonly fuseTicks: Uint16Array;
  readonly blast: Float32Array;
}

/** Default reach of bare hands and of a melee weapon, in metres. */
const FIST_REACH = 2.2;
const MELEE_REACH = 2.6;
/** The longest any weapon timing may be, in ticks, which is what a body's act counter holds. */
const MAX_ACT_TICKS = 250;
/** The longest one piece of fuel may burn or one item take to cook. Thirty days. */
export const MAX_BURN_SECONDS = 30 * 86400;
/** The longest an item may keep before it spoils, in game hours. The spoil clock holds this with room to spare. */
export const MAX_SPOIL_HOURS = 1e6;
export const MAX_NODE_HITS = 10000;
export const MAX_LEVELS = 10000;
/** Stamina per second of sprinting, per second of rest, and per jump, where a species does not say. */
export const STAMINA_DEFAULT = { sprint: 5, regen: 8, jump: 6 };

export const WEAR_SLOTS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];

export interface CompileResult {
  registry: Registry | null;
  errors: string[];
}

export function compileContent(input: readonly Def[]): CompileResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  const positive = (d: Def, name: string, v: number, max: number) => {
    if (!(v > 0 && v <= max)) errors.push(`${d.id}: ${name} must be in (0, ${max}], got ${v}`);
  };

  for (const d of input) {
    if (!ID.test(d.id)) errors.push(`"${d.id}": id must look like "namespace:name"`);
    if (seen.has(d.id)) errors.push(`${d.id}: duplicate id`);
    seen.add(d.id);
    if (d.type === "species") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
      positive(d, "walkSpeed", d.walkSpeed, 40);
      positive(d, "sprintMul", d.sprintMul, 4);
      positive(d, "jumpSpeed", d.jumpSpeed, 30);
      if (d.swimSpeed !== undefined) positive(d, "swimSpeed", d.swimSpeed, 40);
      if (d.turn !== undefined) positive(d, "turn", d.turn, 3600);
      // The pack decides which skeletons exist, so only an empty name is an error here.
      if (d.skeleton !== undefined && d.skeleton.length === 0) errors.push(`${d.id}: a skeleton must be named`);
      if (d.stamina && !(d.stamina.sprint >= 0 && d.stamina.regen >= 0 && d.stamina.jump >= 0)) errors.push(`${d.id}: stamina costs must not be negative`);
      if (d.height < 2 * d.radius) errors.push(`${d.id}: height must be at least twice the radius`);
      if (!(d.eyeHeight > 0 && d.eyeHeight <= d.height)) errors.push(`${d.id}: eyeHeight must be within the body`);
      for (const [name, st] of [["crouch", d.crouch], ["prone", d.prone]] as const) {
        if (st && !(st.height > 0 && st.height <= d.height && st.eye > 0 && st.eye <= st.height && st.speed > 0 && st.speed <= 1)) errors.push(`${d.id}: ${name} needs 0 < eye <= height <= the body's height and 0 < speed <= 1`);
      }
      if (d.food) {
        positive(d, "food.max", d.food.max, 1e6);
        positive(d, "food.perHour", d.food.perHour, 1e6);
      }
      for (const [type, v] of Object.entries(d.takes ?? {})) {
        if (!(DAMAGE_TYPES as readonly string[]).includes(type) || !(v >= 0)) errors.push(`${d.id}: takes.${type} must name a kind of damage and not be negative`);
      }
      for (const [zone, v] of Object.entries(d.zones ?? {})) {
        if (!(zone in ZONE_GROUPS) || !(v >= 0)) errors.push(`${d.id}: zones.${zone} must name a part of the body and not be negative`);
      }
      for (const [stat, curve] of Object.entries(d.stats ?? {})) {
        if (!(STAT_NAMES as readonly string[]).includes(stat)) errors.push(`${d.id}: unknown stat "${stat}"`);
        else if (!Array.isArray(curve) || curve.length !== 3 || !(curve[0] > 0) || !(curve[1] >= 0) || !(curve[2] >= 0)) errors.push(`${d.id}: stats.${stat} must be [base > 0, perWild >= 0, perTamed >= 0]`);
      }
    } else if (d.type === "prop") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
    } else if (d.type === "node") {
      for (let a = 0; a < 3; a++) positive(d, `half[${a}]`, d.half[a]!, MAX_STRUCTURE_HALF);
      positive(d, "hits", d.hits, MAX_NODE_HITS);
      positive(d, "respawnHours", d.respawnHours, 1e6);
      for (const y of d.yields) if (!(y.min >= 0 && y.max >= y.min)) errors.push(`${d.id}: a yield's range must be 0 <= min <= max`);
    } else if (d.type === "recipe") {
      positive(d, "count", d.count, 1000);
      positive(d, "seconds", d.seconds, 86400);
      if (d.needs.length === 0) errors.push(`${d.id}: a recipe needs at least one ingredient`);
    } else if (d.type === "engram") {
      positive(d, "level", d.level, 1000);
      if (!(d.cost >= 0)) errors.push(`${d.id}: cost must not be negative`);
      if (d.auto !== undefined && !(d.auto >= 0 && d.auto <= 1000)) errors.push(`${d.id}: auto must be a level from 0 to 1000`);
    } else if (d.type === "levels") {
      for (const [name, xp] of [["xp", d.xp], ["tame.xp", d.tame?.xp]] as const) {
        if (xp !== undefined && (xp.length < 2 || xp.length > MAX_LEVELS || xp[0] !== 0 || xp.some((v, i) => i > 0 && !(v > xp[i - 1]!)))) errors.push(`${d.id}: ${name} must start at 0 and rise, for at most ${MAX_LEVELS} levels`);
      }
      if (d.engramPoints.length !== d.xp.length) errors.push(`${d.id}: engramPoints must have one entry per level`);
      if ((d.most !== undefined && !(d.most > 0)) || (d.tame?.most !== undefined && !(d.tame.most > 0))) errors.push(`${d.id}: the most experience must be above 0`);
    } else if (d.type === "material") {
      for (const [type, v] of Object.entries(d.takes)) {
        if (!(DAMAGE_TYPES as readonly string[]).includes(type) || !(v >= 0)) errors.push(`${d.id}: takes.${type} must name a kind of damage and not be negative`);
      }
    } else if (d.type === "buff") {
      if (d.seconds !== undefined) positive(d, "seconds", d.seconds, 86400);
      for (const [name, v] of [["speed", d.speed], ["dealt", d.dealt], ["taken", d.taken]] as const) {
        if (v !== undefined && !(v >= 0 && v <= 100)) errors.push(`${d.id}: ${name} must be from 0 to 100`);
      }
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    } else if (d.type === "structure") {
      positive(d, "half[0]", d.half[0], MAX_STRUCTURE_HALF);
      positive(d, "half[1]", d.half[1], MAX_STRUCTURE_HALF);
      positive(d, "half[2]", d.half[2], MAX_STRUCTURE_HALF);
      positive(d, "hp", d.hp, 1e9);
      if ((d.mesh === "shape") !== (d.shape !== undefined)) errors.push(`${d.id}: a mesh of "shape" and a shape go together`);
    } else if (d.type === "shape") {
      if (!PIECE_ROLES.includes(d.role)) errors.push(`${d.id}: role must be one of ${PIECE_ROLES.join(", ")}`);
      if (d.boxes.length < 1 || d.boxes.length > MAX_SHAPE_BOXES) errors.push(`${d.id}: a shape has 1 to ${MAX_SHAPE_BOXES} boxes`);
      for (const b of d.boxes) {
        for (let a = 0; a < 3; a++) {
          positive(d, `a box's half[${a}]`, b.half[a]!, MAX_STRUCTURE_HALF);
          if (!(Math.abs(b.at[a]!) + b.half[a]! <= MAX_STRUCTURE_HALF)) errors.push(`${d.id}: a box reaches further than ${MAX_STRUCTURE_HALF} m from the origin`);
        }
      }
    } else {
      if (!(Number.isInteger(d.stack) && d.stack >= 1 && d.stack <= 65535)) errors.push(`${d.id}: stack must be a whole number from 1 to 65535`);
      if (d.weight !== undefined && !(d.weight >= 0)) errors.push(`${d.id}: weight must not be negative`);
      if (d.fuel !== undefined) positive(d, "fuel", d.fuel, MAX_BURN_SECONDS);
      if (d.cooks !== undefined) positive(d, "cooks.seconds", d.cooks.seconds, MAX_BURN_SECONDS);
      if (d.spoilHours !== undefined && !(d.spoilHours > 0 && d.spoilHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: spoilHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
      // Anything that wears out, holds rounds or takes an attachment cannot stack.
      if ((d.weapon || d.wear || d.tool) && d.stack !== 1 && d.weapon?.kind !== "thrown") errors.push(`${d.id}: a tool, weapon or worn piece must have stack 1`);
      const w = d.weapon;
      if (w) {
        positive(d, "weapon.uses", w.uses, 60000);
        if ((w.kind === "melee" || w.kind === "thrown") && !(w.damage! > 0 && w.type)) errors.push(`${d.id}: a ${w.kind} weapon needs damage and a type`);
        if ((w.kind === "bow" || w.kind === "gun") && !(w.ammo && w.ammo.length > 0)) errors.push(`${d.id}: a ${w.kind} needs the ammunition it takes`);
        if (w.kind === "bow" && !(w.draw! > 0)) errors.push(`${d.id}: a bow needs a draw time`);
        if (w.clip !== undefined && !(Number.isInteger(w.clip) && w.clip >= 1 && w.clip <= 255)) errors.push(`${d.id}: weapon.clip must be a whole number from 1 to 255`);
        for (const [name, v] of [["reload", w.reload], ["draw", w.draw], ["interval", w.interval]] as const) {
          if (v !== undefined && !(v > 0 && v * TICK_RATE <= MAX_ACT_TICKS)) errors.push(`${d.id}: weapon.${name} must be above 0 and at most ${MAX_ACT_TICKS / TICK_RATE} seconds`);
        }
      }
      if (d.ammo && !(d.ammo.damage >= 0)) errors.push(`${d.id}: ammo.damage must not be negative`);
      if (d.ammo?.speed !== undefined && !(d.ammo.speed > 0 && d.ammo.speed <= 1000)) errors.push(`${d.id}: ammo.speed must be above 0 and at most 1000`);
      if (d.ammo?.recover !== undefined && !(d.ammo.recover >= 0 && d.ammo.recover <= 1)) errors.push(`${d.id}: ammo.recover must be from 0 to 1`);
      if (d.wear) {
        if (!WEAR_SLOTS.includes(d.wear.slot)) errors.push(`${d.id}: wear.slot must be one of ${WEAR_SLOTS.join(", ")}`);
        if (!(d.wear.armor >= 0)) errors.push(`${d.id}: wear.armor must not be negative`);
        positive(d, "wear.uses", d.wear.uses, 60000);
      }
    }
    if (d.type === "species" || d.type === "structure" || d.type === "prop" || d.type === "node") {
      if (d.mesh.length === 0) errors.push(`${d.id}: mesh is required`);
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    }
  }
  // References between definitions must name something of the right type.
  const typeOf = new Map(input.map((d) => [d.id, d.type]));
  const items = new Map(input.flatMap((d) => (d.type === "item" ? [[d.id, d] as const] : [])));
  const shapes = new Map(input.flatMap((d) => (d.type === "shape" ? [[d.id, d] as const] : [])));
  const want = (d: Def, id: string, type: string) => {
    if (typeOf.get(id) !== type) errors.push(`${d.id}: "${id}" is not ${type === "item" ? "an item" : `a ${type}`}`);
  };
  for (const d of input) {
    if (d.type === "node") for (const y of d.yields) want(d, y.item, "item");
    else if (d.type === "recipe") {
      want(d, d.makes, "item");
      for (const n of d.needs) want(d, n.item, "item");
    } else if (d.type === "engram") for (const r of d.unlocks) want(d, r, "recipe");
    else if (d.type === "species") {
      for (const drop of d.drops ?? []) want(d, drop.item, "item");
      for (const f of d.eats ?? []) want(d, f.item, "item");
      if (d.breeds?.egg !== undefined) want(d, d.breeds.egg, "prop");
      if (d.breeds && !(d.breeds.incubate > 0 && d.breeds.mature > 0)) errors.push(`${d.id}: breeds needs incubate and mature above 0`);
    } else if (d.type === "structure") {
      if (d.material !== undefined) want(d, d.material, "material");
      if (d.opens !== undefined) want(d, d.opens, "structure");
      if (d.lights !== undefined) want(d, d.lights, "structure");
      if (d.shape !== undefined) {
        want(d, d.shape, "shape");
        const shape = shapes.get(d.shape);
        const holds = shape ? shapeHalf(shape.boxes) : null;
        if (holds && holds.some((v, a) => Math.abs(v - d.half[a]!) > 1e-6)) errors.push(`${d.id}: half must be [${holds.join(", ")}], the box that holds ${d.shape}`);
      }
    }
    else if (d.type === "item") {
      if (d.saddle) want(d, d.saddle.fits, "species");
      for (const a of d.weapon?.ammo ?? []) if (!items.get(a)?.ammo) errors.push(`${d.id}: "${a}" is not ammunition`);
      for (const a of d.weapon?.fits ?? []) if (!items.get(a)?.attachment) errors.push(`${d.id}: "${a}" is not an attachment`);
      if (d.ammo?.buff !== undefined) want(d, d.ammo.buff, "buff");
      for (const s of d.places ?? []) want(d, s, "structure");
      if (d.places && d.places.length === 0) errors.push(`${d.id}: places must name at least one structure`);
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
  const move: (MoveParams | null)[] = new Array(n).fill(null);
  const stack = new Uint16Array(n);
  const weight = new Float32Array(n);
  const spoilTicks = new Uint32Array(n);
  const bodyRadius = new Float32Array(n);
  const bodyHeight = new Float32Array(n);
  const soft = new Uint8Array(n);
  const nodeHits = new Float32Array(n);
  const wearSlot = new Int8Array(n).fill(-1);
  const uses = new Uint16Array(n);
  const weapon: (WeaponParams | null)[] = new Array(n).fill(null);
  const damage = new Float32Array(n);
  const damageType = new Uint8Array(n);
  const reach = new Float32Array(n);
  const armor = new Float32Array(n);
  const takes: (Float32Array | null)[] = new Array(n).fill(null);
  const zoneMul: (Float32Array | null)[] = new Array(n).fill(null);
  const power = new Float32Array(n);
  const ammoSpeed = new Float32Array(n);
  const ammoGravity = new Float32Array(n);
  const ammoRecover = new Float32Array(n);
  const ammoTorpor = new Float32Array(n);
  const ammoTorporOver = new Float32Array(n);
  const ammoTorporSeconds = new Float32Array(n);
  const ammoBuff = new Uint16Array(n);
  const structTakes: (Float32Array | null)[] = new Array(n).fill(null);
  const role = new Int8Array(n).fill(-1);
  const doorway = new Uint8Array(n);
  const places: (Uint16Array | null)[] = new Array(n).fill(null);
  const pieceItem = new Uint16Array(n);
  const maxHp = new Float32Array(n);
  const decayDays = new Float32Array(n);
  const structSlots = new Uint16Array(n);
  const opens = new Uint16Array(n);
  const lockedAtFirst = new Uint8Array(n);
  const fallsWhole = new Uint8Array(n);
  const lights = new Uint16Array(n);
  const burning = new Uint8Array(n);
  const isBed = new Uint8Array(n);
  const runAt = new Float32Array(n);
  const taming: (TameParams | null)[] = new Array(n).fill(null);
  const eats: (number[] | null)[] = new Array(n).fill(null);
  const breedEgg = new Uint16Array(n).fill(0xffff);
  const incubateTicks = new Uint32Array(n);
  const matureTicks = new Uint32Array(n);
  const birthScale = new Float32Array(n).fill(1);
  const saddleFits = new Uint16Array(n);
  const saddleArmor = new Float32Array(n);
  const doseTorpor = new Float32Array(n);
  const doseSeconds = new Float32Array(n);
  const temper = new Uint8Array(n);
  const sight = new Float32Array(n);
  const leash = new Float32Array(n);
  const fuelTicks = new Uint32Array(n);
  const cooksInto = new Uint16Array(n);
  const cookTicks = new Uint32Array(n);
  const recipeOf: (Uint16Array | null)[] = new Array(n).fill(null);
  const recipeMakes = new Uint16Array(n);
  const partStart = new Uint32Array(n + 1);
  const partBox: number[] = [];
  const throwSpeed = new Float32Array(n);
  const fuseTicks = new Uint16Array(n);
  const blast = new Float32Array(n);
  const materials = new Map(sorted.flatMap((o) => (o.type === "material" ? [[o.id, o] as const] : [])));
  let hash = hashString("snark-content-1");
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    index.set(d.id, i);
    hash = hashString(canonical(d), hash);
    partStart[i] = partBox.length / 6;
    if (d.type === "structure" || d.type === "node") {
      halfX[i] = d.half[0];
      halfY[i] = d.half[1];
      halfZ[i] = d.half[2];
      // Collision parts are the shape's boxes, or else the one box.
      const shape = d.type === "structure" && d.shape !== undefined ? shapes.get(d.shape)! : null;
      if (shape) {
        role[i] = PIECE_ROLES.indexOf(shape.role);
        if (shape.doorway) doorway[i] = 1;
        for (const b of shape.boxes) partBox.push(b.at[0], b.at[1], b.at[2], b.half[0], b.half[1], b.half[2]);
      } else partBox.push(0, 0, 0, d.half[0], d.half[1], d.half[2]);
      if (d.type === "structure") {
        maxHp[i] = d.hp;
        structSlots[i] = d.slots ?? 0;
        if (d.locked) lockedAtFirst[i] = 1;
        if (d.falls) fallsWhole[i] = 1;
        if (d.lit) burning[i] = 1;
        if (d.bed) isBed[i] = 1;
      }
      if (d.type === "structure") {
        const m = d.material !== undefined ? materials.get(d.material)! : null;
        if (m) structTakes[i] = Float32Array.from(DAMAGE_TYPES, (t) => m.takes[t] ?? 0);
        decayDays[i] = d.decayDays ?? m?.decayDays ?? 0;
      }
      if (d.type === "node") {
        nodeHits[i] = d.hits;
        if (d.soft) soft[i] = 1;
      }
    } else if (d.type === "species" || d.type === "prop") {
      if (d.type === "species") {
        move[i] = moveParams(d);
        damage[i] = d.fists ?? 8;
        reach[i] = FIST_REACH;
        takes[i] = Float32Array.from(DAMAGE_TYPES, (t) => d.takes?.[t] ?? 1);
        const zones = new Float32Array(ZONE_COUNT).fill(1);
        for (const [group, v] of Object.entries(d.zones ?? {})) for (const z of ZONE_GROUPS[group]!) zones[z] = v;
        zoneMul[i] = zones;
      }
      bodyRadius[i] = d.radius;
      bodyHeight[i] = d.height;
    } else if (d.type === "item") {
      stack[i] = d.stack;
      weight[i] = d.weight ?? 0.1;
      // At least 1 tick, because 0 means the item never spoils.
      spoilTicks[i] = d.spoilHours !== undefined ? Math.max(1, Math.round(d.spoilHours * GAME_HOUR_TICKS)) : 0;
      if (d.wear) wearSlot[i] = WEAR_SLOTS.indexOf(d.wear.slot);
      uses[i] = d.wear?.uses ?? d.weapon?.uses ?? d.tool?.uses ?? 0;
      armor[i] = d.wear?.armor ?? 0;
      if (d.weapon) {
        weapon[i] = weaponParams(d.weapon);
        reach[i] = d.weapon.reach ?? MELEE_REACH;
        power[i] = d.weapon.power ?? 1;
        throwSpeed[i] = d.weapon.speed ?? 0;
        fuseTicks[i] = Math.min(65535, Math.round((d.weapon.fuse ?? 0) * TICK_RATE));
        blast[i] = d.weapon.blast ?? 0;
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
      }
      const hits = d.ammo ?? d.weapon;
      if (hits?.damage !== undefined) {
        damage[i] = hits.damage;
        damageType[i] = Math.max(0, DAMAGE_TYPES.indexOf(hits.type ?? "melee"));
      }
    }
  }
  partStart[n] = partBox.length / 6;
  const parts: PartTable = { start: partStart, box: Float32Array.from(partBox) };
  // A second pass resolves references, now that every definition has its index.
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    if (d.type === "item" && d.places) {
      places[i] = Uint16Array.from(d.places, (id) => index.get(id)!);
      // Every form of a piece maps back to the one item.
      for (const s of places[i]!) if (pieceItem[s] === 0) pieceItem[s] = i;
    }
    if (d.type === "structure" && d.opens !== undefined) opens[i] = index.get(d.opens)!;
    if (d.type === "structure" && d.lights !== undefined) lights[i] = index.get(d.lights)!;
    if (d.type === "species") {
      runAt[i] = d.walkSpeed * 1.5;
      temper[i] = Math.max(0, ["flees", "defends", "hunts"].indexOf(d.temper ?? "flees"));
      sight[i] = d.sight ?? 20;
      taming[i] = d.taming ?? null;
      if (d.eats) eats[i] = d.eats.flatMap((f) => [index.get(f.item)!, f.food, f.affinity]);
      leash[i] = d.leash ?? 60;
      if (d.breeds) {
        breedEgg[i] = d.breeds.egg !== undefined ? index.get(d.breeds.egg)! : 0;
        incubateTicks[i] = Math.round(d.breeds.incubate * TICK_RATE);
        matureTicks[i] = Math.round(d.breeds.mature * TICK_RATE);
        birthScale[i] = d.breeds.scale ?? BIRTH_SCALE;
      }
      // A bite is the species' melee weapon.
      if (d.bite) {
        reach[i] = d.bite.reach;
        weapon[i] = { kind: W_MELEE, hold: HOLD_HANDS, swingTicks: d.bite.ticks ?? 27, strikeTick: d.bite.lands ?? 11, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true };
      }
    }
    if (d.type === "item" && d.saddle) {
      saddleFits[i] = index.get(d.saddle.fits)!;
      saddleArmor[i] = d.saddle.armor;
    }
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
    }
    // The first recipe that makes an item gives its ingredients.
    if (d.type === "recipe" && recipeOf[index.get(d.makes)!] === null) {
      recipeOf[index.get(d.makes)!] = Uint16Array.from(d.needs.flatMap((need) => [index.get(need.item)!, need.count]));
      recipeMakes[index.get(d.makes)!] = d.count;
    }
  }
  // An open door maps back to the closed door's item.
  for (let i = 1; i < n; i++) if (opens[i] !== 0 && pieceItem[opens[i]!] === 0) pieceItem[opens[i]!] = pieceItem[i]!;
  // A burning fire maps back to the unlit fire's item.
  for (let i = 1; i < n; i++) if (lights[i] !== 0 && pieceItem[lights[i]!] === 0) pieceItem[lights[i]!] = pieceItem[i]!;
  return { registry: { defs, ids, index, hash, baseHash: hash, tuning: "", source: null, halfX, halfY, halfZ, parts, role, doorway, places, pieceItem, maxHp, decayDays, structSlots, opens, lockedAtFirst, fallsWhole, lights, burning, isBed, runAt, taming, eats, breedEgg, incubateTicks, matureTicks, birthScale, saddleFits, saddleArmor, doseTorpor, doseSeconds, temper, sight, leash, fuelTicks, cooksInto, cookTicks, recipeOf, recipeMakes, move, stack, weight, spoilTicks, bodyRadius, bodyHeight, soft, nodeHits, wearSlot, uses, weapon, damage, damageType, reach, armor, takes, zoneMul, power, ammoSpeed, ammoGravity, ammoRecover, ammoTorpor, ammoTorporOver, ammoTorporSeconds, ammoBuff, structTakes, throwSpeed, fuseTicks, blast }, errors };
}

/** The ZONE_* ids (shared/anim/human.ts) each body part named in content covers. */
const ZONE_GROUPS: Readonly<Record<string, readonly number[]>> = { head: [1], torso: [2], arms: [3, 4], hands: [5, 6], legs: [7, 8], feet: [9, 10] };

const HOLDS: Readonly<Record<WeaponFacet["hold"], number>> = { tool: HOLD_TOOL, spear: HOLD_SPEAR, bow: HOLD_BOW, rifle: HOLD_RIFLE, pistol: HOLD_PISTOL };

function weaponParams(w: WeaponFacet): WeaponParams {
  const ticks = (seconds: number | undefined, fallback: number): number => (seconds === undefined ? fallback : Math.max(1, Math.round(seconds * TICK_RATE)));
  const kind = w.kind === "melee" ? W_MELEE : w.kind === "bow" ? W_BOW : w.kind === "gun" ? W_GUN : W_THROWN;
  // A swing, or the pause after a shot. A bow or a single-round gun pauses briefly, because the reload that follows is the wait.
  const swingTicks = ticks(w.interval, kind === W_BOW ? 6 : kind === W_GUN && (w.clip ?? 1) === 1 ? 3 : SWING_TICKS);
  const drawTicks = kind === W_BOW ? ticks(w.draw, 1) : 0;
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
  };
}

function moveParams(d: SpeciesDef): MoveParams {
  // A capsule is never shorter than it is wide.
  const low = (h: number): number => (h < 2 * d.radius ? 2 * d.radius : h);
  const crouchHeight = low(d.crouch?.height ?? (d.height * 2) / 3);
  const proneHeight = low(d.prone?.height ?? 0);
  return {
    radius: d.radius,
    height: d.height,
    eyeHeight: d.eyeHeight,
    crouchHeight,
    crouchEye: d.crouch?.eye ?? crouchHeight * (d.eyeHeight / d.height),
    crouchMul: d.crouch?.speed ?? 0.5,
    proneHeight,
    proneEye: d.prone?.eye ?? proneHeight * 0.45,
    proneMul: d.prone?.speed ?? 0.2,
    walkSpeed: d.walkSpeed,
    sprintMul: d.sprintMul,
    accelGround: d.walkSpeed * 10,
    accelAir: d.walkSpeed * 2,
    jumpSpeed: d.jumpSpeed,
    gravity: GRAVITY,
    slopeCos: SLOPE_COS,
    stepUp: 0.5,
    stepDown: 0.4,
    swimSpeed: d.swimSpeed ?? d.walkSpeed * 0.6,
    swimSprintMul: 1.5,
    accelSwim: d.walkSpeed * 3,
    // Whole stamina units per tick, so both sides count the same integers.
    staminaSprint: Math.round(((d.stamina?.sprint ?? STAMINA_DEFAULT.sprint) * STAMINA_UNITS) / TICK_RATE),
    staminaRegen: Math.round(((d.stamina?.regen ?? STAMINA_DEFAULT.regen) * STAMINA_UNITS) / TICK_RATE),
    staminaJump: Math.round((d.stamina?.jump ?? STAMINA_DEFAULT.jump) * STAMINA_UNITS),
    // Whole units per tick, so both sides turn the same.
    turnRate: d.turn === undefined ? 0 : Math.max(1, Math.round(((d.turn / 360) * 65536) / TICK_RATE)),
    strafe: d.strafe !== false,
  };
}

/** Key-sorted JSON, so the hash does not depend on property order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
