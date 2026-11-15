// Dense indices are assigned in id order, so every process that loads the same definitions gets the same indices and hash.
// Index 0 is reserved. It marks an empty structure slot and stands in for content that no longer exists.

import { BIRTH_SCALE } from "../sim/breeding.ts";
import type { TameParams } from "../sim/taming.ts";
import { TICK_RATE } from "../coords.ts";
import { hashString } from "../hash.ts";
import { STAMINA_UNITS, type MoveParams } from "../sim/character.ts";
import { COLOR_REGIONS, STAT_NAMES, type ColorSet } from "../sim/genome.ts";
import { GAME_HOUR_TICKS } from "../sim/lazy.ts";
import { ZONE_COUNT } from "../anim/human.ts";
import { DAMAGE_TYPES } from "../sim/damage.ts";
import { lootFaults } from "../sim/loot.ts";
import { HOLD_BOW, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_SPEAR, HOLD_THROW, HOLD_TOOL, SWING_TICKS, W_BOW, W_GUN, W_MELEE, W_THROWN, type WeaponParams } from "../sim/weapon.ts";
import { hullOf, hullTable, type HullDef } from "../world/convex.ts";
import type { PartTable } from "../world/structures.ts";
import { defFaults, refFaults } from "./classes.ts";
import { PIECE_ROLES, shapeHalf, type Def, type NodeShape, type RenameDef, type SpeciesDef, type WeaponFacet } from "./defs.ts";

export const MISSING = 0;
export const MAX_STRUCTURE_HALF = 16;
export const MAX_SHAPE_BOXES = 16;
/** What a shape's look may draw: a flight's treads. */
export const MAX_LOOK_PARTS = 64;
/** The most a node kind may be drawn at, as a multiple of its modelled size, and the most variants it may have. */
export const MOST_NODE_SIZE = 3.9;
export const MAX_NODE_VARIANTS = 64;
/** Metres a node's boxes may reach up from its origin at its largest size, as a tall palm's trunk does. Sideways, a structure's half. */
export const MAX_NODE_HEIGHT = 32;

const ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_\/-]*$/;
const ALIAS = /^[A-Za-z0-9_.-]+$/;
const TAG = /^[a-z][a-z0-9_]*$/;
const GRAVITY = 20;
const SLOPE_COS = 0.6427876096865394; // 50 degrees

export interface Registry {
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
  /** The creatures that share each tag: a species and its variants. */
  readonly tags: ReadonlyMap<string, readonly number[]>;
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
  /** Per species: the colours each region of a wild one may take, and the palette colours a mutation may give a region. Null for everything else. */
  readonly colorSet: readonly (ColorSet | null)[];
  readonly mutationColors: readonly (readonly number[] | null)[];
  /** Per species: how many times as long things keep in its inventory. 1 for everything else. */
  readonly keeps: Float32Array;
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
   * Per species: how far off others of its species take fright with it (0 for none), how it moves once tamed (the very
   * object `move` holds where taming does not change it), its drag weight and mass (0 where not given), 1 if a survivor may
   * pick it up, the item it leaves when it defecates (0 for none), and the chance a female lays an egg in its place.
   */
  readonly alarm: Float32Array;
  readonly tamedMove: readonly (MoveParams | null)[];
  readonly drag: Float32Array;
  readonly mass: Float32Array;
  readonly carriable: Uint8Array;
  readonly feces: Uint16Array;
  readonly eggChance: Float32Array;
  /** Per prop: the multiple of its mesh's modelled size it is drawn at, 1 for everything else; for an egg, the item it is once picked up (0 for none). */
  readonly drawSize: Float32Array;
  readonly propItem: Uint16Array;
  /** Per prop: for an egg, the item it is once picked up fertilised (0 for none). */
  readonly propFertile: Uint16Array;
  /**
   * Per item: the ticks one lies on the ground before it is gone, or 0 for as long as any dropped stack; and what a young
   * body gives in its place (0 for itself).
   */
  readonly decomposeTicks: Uint32Array;
  readonly youngItem: Uint16Array;
  // The columns of planning/reference/weapons-plan.md. The blow's are read (W2); the rest are compiled and read by nothing until the project named builds them.
  /** A bow's or gun's blow (W2): its damage at primitive quality (0 for none), torpor as a multiple of it, and reach in metres. */
  readonly blowDamage: Float32Array;
  readonly blowTorpor: Float32Array;
  readonly blowReach: Float32Array;
  /** W6, per weapon: what its damage is multiplied by against a structure. 1 for everything. */
  readonly structureMul: Float32Array;
  /** W5, per thrown weapon that bursts into a cloud: the prop/cloud (0 for none), the ticks it lasts, and its buff (0 for none). */
  readonly cloudProp: Uint16Array;
  readonly cloudTicks: Uint32Array;
  readonly cloudBuff: Uint16Array;
  /** W3, per ammunition: rays a round sends (1 for everything), and the metres its damage falls off from and to (0 and 0 for none). */
  readonly ammoPellets: Uint8Array;
  readonly ammoFalloffFull: Float32Array;
  readonly ammoFalloffNone: Float32Array;
  /** W6, per ammunition: the reach of the blast where it ends (0 for none), and the share of armor it goes through. */
  readonly ammoBlast: Float32Array;
  readonly ammoPierce: Float32Array;
  /** M9, per ammunition: the reach of the light it carries (0 for none) and its palette colour. */
  readonly ammoLight: Float32Array;
  readonly ammoLightColor: Uint8Array;
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
/** The stats a use may change at once, and the ones it may change over time, which buffs carry (server/use.ts). */
export const USE_AT_ONCE: readonly string[] = ["health", "stamina", "oxygen", "food", "water", "torpidity"];
export const USE_OVER_TIME: readonly string[] = ["health", "torpidity"];
export const MAX_NODE_HITS = 10000;
export const MAX_LEVELS = 10000;
/** Stamina per second of sprinting, per second of rest, and per jump, where a species does not say. */
export const STAMINA_DEFAULT = { sprint: 5, regen: 8, jump: 6 };
/** Palette colours every region of a wild creature draws from evenly, where its species has no colour set. */
export const WILD_COLORS: readonly number[] = [3, 5, 6, 7, 9, 12, 15];
/** Palette colours a mutation may give a region, where the species does not say. None is a wild colour. */
export const MUTATION_COLORS: readonly number[] = [8, 10, 11, 13, 14, 17, 19, 21];

export const WEAR_SLOTS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];

export interface CompileResult {
  registry: Registry | null;
  errors: string[];
}

export function compileContent(all: readonly Def[]): CompileResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  // A rename is not content. It is checked here and kept apart.
  const renames = all.filter((d): d is RenameDef => d.type === "rename");
  const input = all.filter((d): d is Exclude<Def, RenameDef> => d.type !== "rename");
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
  const positive = (d: Def, name: string, v: number, max: number) => {
    if (!(v > 0 && v <= max)) errors.push(`${d.id}: ${name} must be in (0, ${max}], got ${v}`);
  };

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
    if (d.type === "species" && d.tag !== undefined && !TAG.test(d.tag)) errors.push(`${d.id}: tag "${d.tag}" must be one word of lower-case letters, digits and "_"`);
    if (d.type === "species") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
      positive(d, "walkSpeed", d.walkSpeed, 40);
      positive(d, "sprintMul", d.sprintMul, 4);
      positive(d, "jumpSpeed", d.jumpSpeed, 30);
      if (d.swimSpeed !== undefined) positive(d, "swimSpeed", d.swimSpeed, 40);
      if (d.keeps !== undefined) positive(d, "keeps", d.keeps, 1000);
      if (d.turn !== undefined) positive(d, "turn", d.turn, 3600);
      // The pack decides which skeletons exist, so only an empty name is an error here.
      if (d.skeleton !== undefined && d.skeleton.length === 0) errors.push(`${d.id}: a skeleton must be named`);
      if (d.stamina && !(d.stamina.sprint >= 0 && d.stamina.regen >= 0 && d.stamina.jump >= 0 && (d.stamina.walk ?? 0) >= 0)) errors.push(`${d.id}: stamina costs must not be negative`);
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
      if (Array.isArray(d.regions)) {
        if (d.regions.length !== COLOR_REGIONS) errors.push(`${d.id}: regions must list all ${COLOR_REGIONS} colour regions, with null for one that takes no colour`);
        const weighted = (c: unknown): boolean => Array.isArray(c) && c.length === 2 && paletteIndex(c[0]) && Number.isFinite(c[1]) && c[1] > 0;
        for (const r of d.regions) {
          if (r !== null && !(typeof r?.name === "string" && r.name !== "" && Array.isArray(r.colors) && r.colors.length > 0 && r.colors.every(weighted))) errors.push(`${d.id}: a region is null, or a name and its colours, each [palette index, weight above 0]`);
        }
      }
      if (Array.isArray(d.mutations) && !(d.mutations.length > 0 && d.mutations.every(paletteIndex))) errors.push(`${d.id}: mutations must be palette indices, and at least one`);
      if (d.alarm !== undefined) positive(d, "alarm", d.alarm, 1000);
      if (d.tamedSprintMul !== undefined) positive(d, "tamedSprintMul", d.tamedSprintMul, 4);
      if (d.drag !== undefined) positive(d, "drag", d.drag, 1e6);
      if (d.mass !== undefined) positive(d, "mass", d.mass, 1e6);
      if (d.eggChance !== undefined && !(d.eggChance >= 0 && d.eggChance <= 1)) errors.push(`${d.id}: eggChance must be from 0 to 1`);
      if (d.fistsTorpor !== undefined && !(d.fistsTorpor >= 0)) errors.push(`${d.id}: fistsTorpor must not be negative`);
    } else if (d.type === "prop") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
      if (d.size !== undefined) positive(d, "size", d.size, 8);
    } else if (d.type === "node") {
      for (let a = 0; a < 3; a++) positive(d, `half[${a}]`, d.half[a]!, MAX_STRUCTURE_HALF);
      positive(d, "hits", d.hits, MAX_NODE_HITS);
      positive(d, "respawnHours", d.respawnHours, 1e6);
      for (const y of d.yields) if (!(y.min >= 0 && y.max >= y.min)) errors.push(`${d.id}: a yield's range must be 0 <= min <= max`);
      const largest = d.size?.[1] ?? 1;
      if (!(d.half[1] * 2 * largest <= MAX_NODE_HEIGHT && Math.max(d.half[0], d.half[2]) * largest <= MAX_STRUCTURE_HALF)) errors.push(`${d.id}: its box reaches further than ${MAX_STRUCTURE_HALF} m sideways or ${MAX_NODE_HEIGHT} m up from its origin at its largest size`);
      const shaped = (what: string, s: NodeShape): void => {
        if (typeof s.mesh !== "string" || s.mesh.length === 0) errors.push(`${d.id}: ${what} names its mesh`);
        if (s.boxes !== undefined && !(Array.isArray(s.boxes) && s.boxes.length <= MAX_SHAPE_BOXES)) errors.push(`${d.id}: ${what} has at most ${MAX_SHAPE_BOXES} boxes`);
        for (const b of s.boxes ?? []) {
          for (let a = 0; a < 3; a++) {
            positive(d, `a box's half[${a}]`, b.half?.[a]!, MAX_STRUCTURE_HALF);
            if (!((Math.abs(b.at?.[a]!) + b.half?.[a]!) * largest <= (a === 1 ? MAX_NODE_HEIGHT : MAX_STRUCTURE_HALF))) errors.push(`${d.id}: a box of ${what} reaches further than ${MAX_STRUCTURE_HALF} m sideways or ${MAX_NODE_HEIGHT} m up from its origin at the kind's largest size`);
          }
        }
      };
      if (d.variants !== undefined && !(d.variants.length >= 1 && d.variants.length <= MAX_NODE_VARIANTS)) errors.push(`${d.id}: a node has 1 to ${MAX_NODE_VARIANTS} variants`);
      for (const v of d.variants ?? []) {
        shaped("a variant", v);
        if (v.weight !== undefined && !(Number.isInteger(v.weight) && v.weight >= 1 && v.weight <= 255)) errors.push(`${d.id}: a variant's weight is a whole number from 1 to 255`);
        if (v.depleted) shaped("a variant's depleted form", v.depleted);
      }
      if (d.depleted) shaped("its depleted form", d.depleted);
      if (d.footing !== undefined && !(d.footing.reach > 0 && d.footing.reach <= MAX_STRUCTURE_HALF && d.footing.fall >= 0 && d.footing.fall <= MAX_NODE_HEIGHT)) errors.push(`${d.id}: footing reaches more than 0 and at most ${MAX_STRUCTURE_HALF} m, and allows a fall of 0 to ${MAX_NODE_HEIGHT} m`);
      if (d.size !== undefined && !(d.size.length === 2 && d.size[0] >= 0.25 && d.size[1] >= d.size[0] && d.size[1] <= MOST_NODE_SIZE)) errors.push(`${d.id}: size is [least, most], from 0.25 to ${MOST_NODE_SIZE}`);
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
    } else if (d.type === "spawns") {
      for (const e of d.entries) {
        const n = Array.isArray(e.group) ? e.group.length : 0;
        if (!(e.weight >= 0) || n === 0) errors.push(`${d.id}: an entry needs a weight of at least 0 and a group of at least one`);
        if (e.chances !== undefined && (!Array.isArray(e.chances) || e.chances.length !== n || e.chances.some((c) => !(c >= 0 && c <= 1)))) errors.push(`${d.id}: an entry's chances are one for each of its group, each from 0 to 1`);
        if (e.offsets !== undefined && (!Array.isArray(e.offsets) || e.offsets.length !== n || e.offsets.some((o) => !(Math.abs(o[0]) <= 64 && Math.abs(o[1]) <= 64)))) errors.push(`${d.id}: an entry's offsets are one for each of its group, each within 64 m`);
      }
      for (const l of d.limits ?? []) if (!(l.share >= 0 && l.share <= 1)) errors.push(`${d.id}: the limit of ${l.species} must be a share from 0 to 1`);
    } else if (d.type === "map") {
      for (const z of d.zones ?? []) {
        if (z.count !== undefined && !(Number.isInteger(z.count) && z.count >= 0 && z.count <= 65535)) errors.push(`${d.id}: a zone holds a whole number of creatures from 0 to 65,535`);
        if ((z.spawns === undefined) !== (z.count === undefined)) errors.push(`${d.id}: a zone that names spawns says how many it holds, and only such a zone does`);
      }
    } else if (d.type === "loot") {
      errors.push(...lootFaults(d));
    } else if (d.type === "material") {
      for (const [type, v] of Object.entries(d.takes)) {
        if (!(DAMAGE_TYPES as readonly string[]).includes(type) || !(v >= 0)) errors.push(`${d.id}: takes.${type} must name a kind of damage and not be negative`);
      }
    } else if (d.type === "buff") {
      if (d.seconds !== undefined) positive(d, "seconds", d.seconds, 86400);
      if (d.survivorSeconds !== undefined) positive(d, "survivorSeconds", d.survivorSeconds, 86400);
      if (d.after === d.id) errors.push(`${d.id}: after must name another buff`);
      for (const [name, v] of [["speed", d.speed], ["dealt", d.dealt], ["taken", d.taken]] as const) {
        if (v !== undefined && !(v >= 0 && v <= 100)) errors.push(`${d.id}: ${name} must be from 0 to 100`);
      }
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
      if (d.damage !== undefined && !DAMAGE_TYPES.includes(d.damage)) errors.push(`${d.id}: damage must name a kind of damage`);
    } else if (d.type === "structure") {
      positive(d, "half[0]", d.half[0], MAX_STRUCTURE_HALF);
      positive(d, "half[1]", d.half[1], MAX_STRUCTURE_HALF);
      positive(d, "half[2]", d.half[2], MAX_STRUCTURE_HALF);
      positive(d, "hp", d.hp, 1e9);
      if ((d.mesh === "shape") !== (d.shape !== undefined)) errors.push(`${d.id}: a mesh of "shape" and a shape go together`);
    } else if (d.type === "shape") {
      if (!PIECE_ROLES.includes(d.role)) errors.push(`${d.id}: role must be one of ${PIECE_ROLES.join(", ")}`);
      const parts = d.boxes.length + (d.hulls?.length ?? 0);
      if (parts < 1 || parts > MAX_SHAPE_BOXES) errors.push(`${d.id}: a shape has 1 to ${MAX_SHAPE_BOXES} boxes and convex parts`);
      const drawn = (d.look?.boxes?.length ?? 0) + (d.look?.hulls?.length ?? 0);
      if (d.look !== undefined && (drawn < 1 || drawn > MAX_LOOK_PARTS)) errors.push(`${d.id}: a look has 1 to ${MAX_LOOK_PARTS} boxes and convex parts`);
      for (const b of [...d.boxes, ...(d.look?.boxes ?? [])]) {
        for (let a = 0; a < 3; a++) {
          positive(d, `a box's half[${a}]`, b.half[a]!, MAX_STRUCTURE_HALF);
          if (!(Math.abs(b.at[a]!) + b.half[a]! <= MAX_STRUCTURE_HALF)) errors.push(`${d.id}: a box reaches further than ${MAX_STRUCTURE_HALF} m from the origin`);
        }
      }
      for (const h of [...(d.hulls ?? []), ...(d.look?.hulls ?? [])]) {
        const made = hullOf(h);
        if (typeof made === "string") errors.push(`${d.id}: ${made}`);
        if (shapeHalf([], [h]).some((v) => !(v <= MAX_STRUCTURE_HALF))) errors.push(`${d.id}: a convex part reaches further than ${MAX_STRUCTURE_HALF} m from the origin`);
      }
    } else if (d.type === "item") {
      if (!(Number.isInteger(d.stack) && d.stack >= 1 && d.stack <= 65535)) errors.push(`${d.id}: stack must be a whole number from 1 to 65535`);
      if (d.craft) {
        if (d.craft.count !== undefined) positive(d, "craft.count", d.craft.count, 1000);
        positive(d, "craft.seconds", d.craft.seconds, 86400);
        if (!Array.isArray(d.craft.needs) || d.craft.needs.length === 0) errors.push(`${d.id}: craft needs at least one ingredient`);
        if (d.craft.level !== undefined) positive(d, "craft.level", d.craft.level, 1000);
      }
      if (d.weight !== undefined && !(d.weight >= 0)) errors.push(`${d.id}: weight must not be negative`);
      if (d.fuel !== undefined) positive(d, "fuel", d.fuel, MAX_BURN_SECONDS);
      if (d.cooks !== undefined) positive(d, "cooks.seconds", d.cooks.seconds, MAX_BURN_SECONDS);
      if (d.spoilHours !== undefined && !(d.spoilHours > 0 && d.spoilHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: spoilHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
      if (d.decomposeHours !== undefined && !(d.decomposeHours > 0 && d.decomposeHours <= MAX_SPOIL_HOURS)) errors.push(`${d.id}: decomposeHours must be above 0 and at most ${MAX_SPOIL_HOURS}`);
      // Anything that wears out, holds rounds or takes an attachment cannot stack.
      if ((d.weapon || d.wear || d.tool) && d.stack !== 1 && d.weapon?.kind !== "thrown") errors.push(`${d.id}: a tool, weapon or worn piece must have stack 1`);
      const w = d.weapon;
      if (w) {
        positive(d, "weapon.uses", w.uses, 60000);
        // A thrown weapon with an ammo facet of its own flies and hits with that facet's damage, which may be none (the bola).
        if ((w.kind === "melee" || (w.kind === "thrown" && !d.ammo)) && !(w.damage! > 0 && w.type)) errors.push(`${d.id}: a ${w.kind} weapon needs damage and a type`);
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
      if (am?.falloff && !(am.falloff.full >= 0 && am.falloff.none > am.falloff.full)) errors.push(`${d.id}: ammo.falloff is full from 0 metres or more, and none further than that`);
      if (am?.blast !== undefined) positive(d, "ammo.blast", am.blast, 100);
      if (am?.pierce !== undefined && !(am.pierce >= 0 && am.pierce <= 1)) errors.push(`${d.id}: ammo.pierce must be from 0 to 1`);
      if (am?.light) {
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
    if (d.type === "species" || d.type === "structure" || d.type === "prop" || d.type === "node") {
      if (d.mesh.length === 0) errors.push(`${d.id}: mesh is required`);
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    }
  }
  // What a definition names must exist and be of the class its field asks for (shared/content/classes.ts).
  errors.push(...refFaults(input));
  const shapes = new Map(input.flatMap((d) => (d.type === "shape" ? [[d.id, d] as const] : [])));
  const crafted = new Set(input.flatMap((d) => (d.type === "item" && d.craft ? [d.id] : [])));
  // A station's recipes take from its slots and put the product there, so a station something is made at must have some.
  const stationSlots = new Map(input.flatMap((d) => (d.type === "structure" && d.class === "station" ? [[d.id, d.slots ?? 0] as const] : [])));
  for (const d of input) if (d.type === "item" && d.craft?.at !== undefined && stationSlots.get(d.craft.at) === 0) errors.push(`${d.id}: it is made at "${d.craft.at}", which has no slots to make it from`);
  const noAmmo = new Set(input.flatMap((d) => (d.type === "item" && !d.ammo ? [d.id] : [])));
  const taught = new Map<string, string>();
  const young = new Map<string, string>();
  for (const d of input) {
    if (d.type === "engram" && typeof d.item === "string") {
      if (!crafted.has(d.item)) errors.push(`${d.id}: "${d.item}" cannot be made, so there is nothing to learn`);
      const other = taught.get(d.item);
      if (other !== undefined) errors.push(`${d.id}: ${other} already unlocks "${d.item}"`);
      taught.set(d.item, d.id);
    }
    if (d.type === "species" && d.breeds && !(d.breeds.incubate > 0 && d.breeds.mature > 0)) errors.push(`${d.id}: breeds needs incubate and mature above 0`);
    if (d.type === "structure" && d.shape !== undefined) {
      const shape = shapes.get(d.shape);
      const holds = shape ? shapeHalf(shape.boxes, shape.hulls, shape.look) : null;
      if (holds && holds.some((v, a) => Math.abs(v - d.half[a]!) > 1e-6)) errors.push(`${d.id}: half must be [${holds.join(", ")}], the box that holds ${d.shape}`);
    }
    if (d.type === "item" && d.places && d.places.length === 0) errors.push(`${d.id}: places must name at least one structure`);
    for (const a of d.type === "item" ? (d.weapon?.ammo ?? []) : []) if (noAmmo.has(a)) errors.push(`${d.id}: "${a}" has no ammo facet, so it cannot be fired`);
    if (d.type === "item" && d.youngFor !== undefined) {
      const other = young.get(d.youngFor);
      if (other !== undefined) errors.push(`${d.id}: ${other} is already given in place of "${d.youngFor}"`);
      young.set(d.youngFor, d.id);
    }
    if (d.type === "prop" && d.fertile !== undefined && input.some((o) => o.id === d.fertile && o.type === "item" && o.stack !== 1)) errors.push(`${d.id}: its fertile item must stack to 1`);
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
  const colorSet: (ColorSet | null)[] = new Array(n).fill(null);
  const mutationColors: (readonly number[] | null)[] = new Array(n).fill(null);
  const keeps = new Float32Array(n).fill(1);
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
  const alarm = new Float32Array(n);
  const tamedMove: (MoveParams | null)[] = new Array(n).fill(null);
  const drag = new Float32Array(n);
  const mass = new Float32Array(n);
  const carriable = new Uint8Array(n);
  const feces = new Uint16Array(n);
  const eggChance = new Float32Array(n);
  const drawSize = new Float32Array(n).fill(1);
  const propItem = new Uint16Array(n);
  const propFertile = new Uint16Array(n);
  const decomposeTicks = new Uint32Array(n);
  const youngItem = new Uint16Array(n);
  const blowDamage = new Float32Array(n);
  const blowTorpor = new Float32Array(n);
  const blowReach = new Float32Array(n);
  const structureMul = new Float32Array(n).fill(1);
  const cloudProp = new Uint16Array(n);
  const cloudTicks = new Uint32Array(n);
  const cloudBuff = new Uint16Array(n);
  const ammoPellets = new Uint8Array(n).fill(1);
  const ammoFalloffFull = new Float32Array(n);
  const ammoFalloffNone = new Float32Array(n);
  const ammoBlast = new Float32Array(n);
  const ammoPierce = new Float32Array(n);
  const ammoLight = new Float32Array(n);
  const ammoLightColor = new Uint8Array(n);
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
        tamedMove[i] = d.tamedSprintMul === undefined ? move[i] : { ...move[i]!, sprintMul: d.tamedSprintMul };
        damage[i] = d.fists ?? 8;
        meleeTorpor[i] = d.fistsTorpor ?? 0;
        reach[i] = FIST_REACH;
        alarm[i] = d.alarm ?? 0;
        drag[i] = d.drag ?? 0;
        mass[i] = d.mass ?? 0;
        if (d.carriable) carriable[i] = 1;
        eggChance[i] = d.eggChance ?? 0;
        takes[i] = Float32Array.from(DAMAGE_TYPES, (t) => d.takes?.[t] ?? 1);
        const zones = new Float32Array(ZONE_COUNT).fill(1);
        for (const [group, v] of Object.entries(d.zones ?? {})) for (const z of ZONE_GROUPS[group]!) zones[z] = v;
        zoneMul[i] = zones;
      }
      bodyRadius[i] = d.radius;
      bodyHeight[i] = d.height;
      if (d.type === "prop") drawSize[i] = d.size ?? 1;
    } else if (d.type === "item") {
      stack[i] = d.stack;
      weight[i] = d.weight ?? 0.1;
      // At least 1 tick, because 0 means the item never spoils.
      spoilTicks[i] = d.spoilHours !== undefined ? Math.max(1, Math.round(d.spoilHours * GAME_HOUR_TICKS)) : 0;
      decomposeTicks[i] = d.decomposeHours !== undefined ? Math.max(1, Math.round(d.decomposeHours * GAME_HOUR_TICKS)) : 0;
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
        meleeTorpor[i] = d.weapon.torpor ?? 0;
        if (d.weapon.melee) {
          blowDamage[i] = d.weapon.melee.damage;
          blowTorpor[i] = d.weapon.melee.torpor ?? 0;
          blowReach[i] = d.weapon.melee.reach ?? MELEE_REACH;
        }
        structureMul[i] = d.weapon.structures ?? 1;
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
  // Convex parts, only if some shape has them, so content without them is compiled as it always was.
  const hullsOf = (k: number): readonly HullDef[] => {
    const d = defs[k];
    return d?.type === "structure" && d.shape !== undefined ? (shapes.get(d.shape)!.hulls ?? []) : [];
  };
  const anyHull = defs.some((_, k) => hullsOf(k).length > 0);
  const parts: PartTable = { start: partStart, box: Float32Array.from(partBox), ...(anyHull ? { hulls: hullTable(n, hullsOf) } : {}) };
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
      keeps[i] = d.keeps ?? 1;
      if (d.feces !== undefined) feces[i] = index.get(d.feces)!;
      if (d.breeds) {
        breedEgg[i] = d.breeds.egg !== undefined ? index.get(d.breeds.egg)! : 0;
        incubateTicks[i] = Math.round(d.breeds.incubate * TICK_RATE);
        matureTicks[i] = Math.round(d.breeds.mature * TICK_RATE);
        birthScale[i] = d.breeds.scale ?? BIRTH_SCALE;
      }
      colorSet[i] = d.regions ? compileColors(d.regions.map((r) => r && r.colors)) : WILD_SET;
      mutationColors[i] = d.mutations ?? MUTATION_COLORS;
      // A bite is the species' melee weapon.
      if (d.bite) {
        reach[i] = d.bite.reach;
        weapon[i] = { kind: W_MELEE, hold: HOLD_HANDS, swingTicks: d.bite.ticks ?? 27, strikeTick: d.bite.lands ?? 11, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true };
      }
    }
    if (d.type === "prop" && d.item !== undefined) propItem[i] = index.get(d.item)!;
    if (d.type === "prop" && d.fertile !== undefined) propFertile[i] = index.get(d.fertile)!;
    if (d.type === "item" && d.youngFor !== undefined) youngItem[index.get(d.youngFor)!] = i;
    if (d.type === "item" && d.weapon?.cloud) {
      cloudProp[i] = index.get(d.weapon.cloud.prop)!;
      if (d.weapon.cloud.buff !== undefined) cloudBuff[i] = index.get(d.weapon.cloud.buff)!;
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
      if (d.spoilsInto !== undefined) spoilsInto[i] = index.get(d.spoilsInto)!;
    }
    if (d.type === "item" && d.craft) {
      recipeOf[index.get(d.id)!] = Uint16Array.from(d.craft.needs.flatMap((need) => [index.get(need.item)!, need.count]));
      recipeMakes[index.get(d.id)!] = d.craft.count ?? 1;
      if (d.craft.at !== undefined) craftAt[index.get(d.id)!] = index.get(d.craft.at)!;
      if (d.blueprint !== false) blueprints[index.get(d.id)!] = 1;
    }
  }
  // An open door maps back to the closed door's item.
  for (let i = 1; i < n; i++) if (opens[i] !== 0 && pieceItem[opens[i]!] === 0) pieceItem[opens[i]!] = pieceItem[i]!;
  // A burning fire maps back to the unlit fire's item.
  for (let i = 1; i < n; i++) if (lights[i] !== 0 && pieceItem[lights[i]!] === 0) pieceItem[lights[i]!] = pieceItem[i]!;
  const redirects = new Map(renames.map((r) => [r.id, r.to.map((to) => index.get(to)!)]));
  const aliases = new Map<string, number>();
  const tags = new Map<string, number[]>();
  sorted.forEach((d, at) => {
    for (const a of d.aliases ?? []) aliases.set(a.toLowerCase(), at + 1);
    if (d.type === "species" && d.tag !== undefined) tags.set(d.tag, [...(tags.get(d.tag) ?? []), at + 1]);
  });
  return { registry: { defs, ids, index, hash, redirects, renames, aliases, tags, baseHash: hash, tuning: "", source: null, halfX, halfY, halfZ, parts, role, doorway, places, pieceItem, maxHp, decayDays, structSlots, opens, lockedAtFirst, fallsWhole, lights, burning, isBed, runAt, taming, eats, breedEgg, incubateTicks, matureTicks, birthScale, colorSet, mutationColors, keeps, saddleFits, saddleArmor, doseTorpor, doseSeconds, temper, sight, leash, fuelTicks, cooksInto, cookTicks, spoilsInto, recipeOf, recipeMakes, craftAt, blueprints, move, stack, weight, spoilTicks, bodyRadius, bodyHeight, soft, nodeHits, wearSlot, uses, weapon, damage, damageType, reach, armor, takes, zoneMul, power, ammoSpeed, ammoGravity, ammoRecover, ammoTorpor, ammoTorporOver, ammoTorporSeconds, ammoBuff, structTakes, throwSpeed, fuseTicks, blast, meleeTorpor, alarm, tamedMove, drag, mass, carriable, feces, eggChance, drawSize, propItem, propFertile, decomposeTicks, youngItem, blowDamage, blowTorpor, blowReach, structureMul, cloudProp, cloudTicks, cloudBuff, ammoPellets, ammoFalloffFull, ammoFalloffNone, ammoBlast, ammoPierce, ammoLight, ammoLightColor }, errors };
}

const paletteIndex = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 256;

/** Each region's colours as pairs of palette index and weight, or null for a region that takes none. */
function compileColors(regions: readonly (readonly (readonly [palette: number, weight: number])[] | null)[]): ColorSet {
  const start = new Uint32Array(COLOR_REGIONS + 1);
  const palette: number[] = [];
  const upTo: number[] = [];
  for (let r = 0; r < COLOR_REGIONS; r++) {
    let sum = 0;
    for (const [color, weight] of regions[r] ?? []) {
      palette.push(color);
      upTo.push((sum += weight));
    }
    start[r + 1] = palette.length;
  }
  return { start, palette: Uint8Array.from(palette), upTo: Float64Array.from(upTo) };
}

/** What a species with no colour set rolls: WILD_COLORS at equal weight in every region. */
const WILD_SET = compileColors(new Array(COLOR_REGIONS).fill(WILD_COLORS.map((c) => [c, 1] as const)));

/** The ZONE_* ids (shared/anim/human.ts) each body part named in content covers. */
const ZONE_GROUPS: Readonly<Record<string, readonly number[]>> = { head: [1], torso: [2], arms: [3, 4], hands: [5, 6], legs: [7, 8], feet: [9, 10] };

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
    // A cost that would round to nothing is a unit.
    staminaWalk: d.stamina?.walk ? Math.max(1, Math.round((d.stamina.walk * STAMINA_UNITS) / TICK_RATE)) : 0,
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
