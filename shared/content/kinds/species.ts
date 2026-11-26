// Species: a kind of body that lives. The survivor, a creature, a civilian, a vehicle, a practice target.

import { BODY_SIZES, type BodySize } from "../../sim/loot.ts";
import { ZONE_COUNT, ZONE_TAIL } from "../../anim/human.ts";
import { TICK_RATE } from "../../coords.ts";
import { BIRTH_SCALE } from "../../sim/breeding.ts";
import { FLIGHT_TICKS_MAX, STAMINA_UNITS, type MoveParams } from "../../sim/character.ts";
import { DAMAGE_TYPES } from "../../sim/damage.ts";
import { COLOR_REGIONS, STAT_NAMES, type ColorSet, type StatCurve, type StatName } from "../../sim/genome.ts";
import type { TameParams } from "../../sim/taming.ts";
import { validateVehicleDefinition, type VehicleDefinition } from "../../sim/vehicle.ts";
import { HOLD_HANDS, W_MELEE } from "../../sim/weapon.ts";
import { creatureCombatFaults } from "../creature-combat.ts";
import { drawnFaults, f, f32, icon, list, mesh, paletteIndex, row, stub, u16, u32, u8, type Fields, type Kind, type Named, type Slot } from "../kind.ts";
import type { DamageType } from "./damage.ts";

/** Stamina per second of sprinting, per second of rest, and per jump, where a species does not say. */
export const STAMINA_DEFAULT = { sprint: 5, regen: 8, jump: 6 };
/** Palette colours every region of a wild creature draws from evenly, where its species has no colour set. */
export const WILD_COLORS: readonly number[] = [3, 5, 6, 7, 9, 12, 15];
/** Palette colours a mutation may give a region, where the species does not say. None is a wild colour. */
export const MUTATION_COLORS: readonly number[] = [8, 10, 11, 13, 14, 17, 19, 21];

const TAG = /^[a-z][a-z0-9_]*$/;
const GRAVITY = 20;
/** The steepest a survivor or a wild creature stands on, as a cosine: Unreal's WalkableFloorZ, which ARK keeps, 44.765 degrees. */
const SLOPE_COS = 0.71;
/** A tame's: TamedWalkableFloorZ on ARK's base creature, 53.13 degrees. */
const TAMED_SLOPE_COS = 0.6;
/** Default reach of bare hands, in metres. */
const FIST_REACH = 2.2;

export interface SpeciesDef extends Named {
  readonly type: "species";
  readonly class: "survivor" | "creature" | "target" | "vehicle" | "civilian";
  /** Wheeled movement and named seats; independent of the replaceable body mesh. */
  readonly vehicle?: VehicleDefinition;
  readonly id: string;
  /** Mesh id in an asset pack, or "box" for a generated graybox. */
  readonly mesh: string;
  /**
   * The skeleton of its body ("human"). The body is then drawn from the meshes "<mesh>/head", "/torso", "/hands", "/legs"
   * and "/feet", posed by shared/anim, and hit by zone. Omitted for a body that is one rigid mesh.
   */
  readonly skeleton?: string;
  /** Palette index used by graybox meshes. */
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly walkSpeed: number;
  readonly sprintMul: number;
  readonly jumpSpeed: number;
  /**
   * Capsule height, eye height and share of the walk speed. Crouch defaults to two thirds of the height at half speed.
   * Prone defaults to the lowest height the radius allows at a fifth of the speed.
   */
  readonly crouch?: { readonly height: number; readonly eye: number; readonly speed: number };
  readonly prone?: { readonly height: number; readonly eye: number; readonly speed: number };
  /** Degrees per second its body turns toward its look. Omitted, it faces there at once, as a survivor does. */
  readonly turn?: number;
  /** False for a body that cannot move sideways. */
  readonly strafe?: boolean;
  /** Metres per second in water. Defaults to 60% of the walk speed. */
  readonly swimSpeed?: number;
  /** Metres the origin rests below the surface while swimming. Omitted, 75% of the full collision height. */
  readonly swimDepth?: number;
  /** Measured breathing height in the conscious swimming pose. Omitted, ordinary stance eye height is retained. */
  readonly swimEyeHeight?: number;
  /** Stamina points: per second of sprinting, per second of rest, per jump, and per second of walking. Defaults to 5, 8, 6 and none. */
  readonly stamina?: { readonly sprint: number; readonly regen: number; readonly jump: number; readonly walk?: number };
  /** Food capacity and loss per in-game hour. Omitted for species that do not eat. */
  readonly food?: { readonly max: number; readonly perHour: number };
  /** Water lost per in-game hour. Omitted for species that do not drink. */
  readonly waterPerHour?: number;
  /** Inventory slots. Defaults to none. */
  readonly slots?: number;
  /** How many times as long things keep in its inventory before they spoil. Defaults to 1. */
  readonly keeps?: number;
  /** It carries equipment. Ten hotbar slots and five armor slots follow its bag. */
  readonly equips?: boolean;
  /** Damage of a bare-handed strike. Defaults to 8. */
  readonly fists?: number;
  /** Torpor a bare-handed strike gives, as a multiple of the damage it does. Defaults to none. */
  readonly fistsTorpor?: number;
  /**
   * What its body gives to the blows that harvest it (server/corpses.ts). Each roll gives `min` to `max` of one drop,
   * picked by `weight` (1 where not given). A tool whose `tool.on` is a drop's `favoured` picks that drop half as often again.
   */
  readonly drops?: readonly { readonly item: string; readonly min: number; readonly max: number; readonly weight?: number; readonly favoured?: string }[];
  /** The harvest damage its grown body takes before it is used up, and the harvest damage of each roll. */
  readonly corpse?: { readonly health: number; readonly roll: number };
  /** Per stat: [base, gain per wild point, gain per tamed point]. */
  readonly stats?: { readonly [S in StatName]?: StatCurve };
  /** Multiplier on each type of damage it takes. 1 where not given. */
  readonly takes?: { readonly [T in DamageType]?: number };
  /** Multiplier on a hit to each part of its body. 1 where not given. Arms, hands, legs and feet each cover both sides. */
  readonly zones?: { readonly head?: number; readonly torso?: number; readonly arms?: number; readonly hands?: number; readonly legs?: number; readonly feet?: number; readonly tail?: number };
  /** Experience for killing one at level 1. Each level above that adds a tenth. Defaults to none. */
  readonly killXp?: number;
  /** It stands where it is put and does nothing, as a practice target. */
  readonly still?: boolean;
  /** "flees" (the default) runs from what hurts it, "defends" attacks what hurts it, and "hunts" attacks any survivor it sees. */
  readonly temper?: "flees" | "defends" | "hunts";
  /** How it shows in a visor's heat view (D1081): "warm" (the default) or "cold", a cold-blooded thing barely there. */
  readonly blood?: "warm" | "cold";
  /** How far off it notices what it hunts, in metres. Defaults to 20. */
  readonly sight?: number;
  /** How far from where a hunt began it follows before it gives up, in metres. Defaults to 60. */
  readonly leash?: number;
  /**
   * Its bite, which does its `fists` damage. `reach` is how far from its eye it reaches, past its own length. `ticks` is
   * how long one bite takes and `lands` is the tick it lands on. They default to 27 and 11. `stamina` is the points one
   * costs, none where not given: a stub until a ridden creature's bite spends it (FL2 of planning/reference/flyers-plan.md).
   */
  readonly bite?: { readonly harvest?: "berries" | "carrion"; readonly reach: number; readonly ticks?: number; readonly lands?: number; readonly stamina?: number };
  /** Ground combat, with a primary attack and a secondary attack or a held charge. */
  readonly combat?: CreatureCombatFacet;
  /** Riding view measured against the body and saddle, independently of a long tail or horn. */
  readonly camera?: { readonly height: number; readonly distance: number; readonly forward?: number; readonly avoidBody?: boolean };
  /** It can be tamed by knocking it out and feeding it. These are the reference's five numbers for its species (shared/sim/taming.ts). */
  readonly taming?: { readonly a0: number; readonly a1: number; readonly foodBase: number; readonly proneMult: number; readonly k: number };
  /** What it eats, best liked first. Each entry is an item, the food one piece is worth to it, and its affinity. */
  readonly eats?: readonly { readonly item: string; readonly food: number; readonly affinity: number }[];
  /** Torpor lost per second. Defaults to 1. The maximum is its torpidity stat, and a species without that stat cannot be knocked out. */
  readonly torporDrain?: number;
  /**
   * It breeds (shared/sim/breeding.ts). `egg` is the prop a female lays, which hatches after `incubate` seconds. Without
   * one she carries her young for that long and bears them where she stands. A young one is grown `mature` seconds after
   * birth and is drawn at `scale` of full size at birth (a quarter where not given).
   */
  readonly breeds?: { readonly egg?: string; readonly incubate: number; readonly mature: number; readonly scale?: number };
  /** A name shared by every variant of a creature, for settings that speak of all of them at once. */
  readonly tag?: string;
  /**
   * Its colour set: for each of the six colour regions in order, a name and the palette colours a wild one may take, each
   * with a weight, or null for a region that takes no colour. Omitted, every region draws evenly from WILD_COLORS
   * (shared/content/registry.ts).
   */
  readonly regions?: readonly ({ readonly name: string; readonly colors: readonly (readonly [palette: number, weight: number])[] } | null)[];
  /** The palette colours a mutation may give one of its regions. Defaults to MUTATION_COLORS. */
  readonly mutations?: readonly number[];
  /** When it is hurt, others of its species within this many metres take fright with it. Omitted, none do. */
  readonly alarm?: number;
  /** Base metres per second once tamed, before its speed stat; omitted, the wild value is retained. */
  readonly tamedWalkSpeed?: number;
  readonly tamedSwimSpeed?: number;
  /** Mounted secondary roar. Range is metres, maxDrag is exclusive, and the three durations are seconds. */
  readonly roar?: { readonly range: number; readonly maxDrag: number; readonly cooldown: number; readonly immunity: number; readonly interrupt: number };
  /** Its sprintMul once tamed. Defaults to its sprintMul. */
  readonly tamedSprintMul?: number;
  /**
   * Its body as others on foot meet it (shared/sim/blockers.ts): along its facing from `back` to `front` metres from its
   * origin, `radius` across, at full size; its height is its collision height. Measured from its rig's torso and legs,
   * the tail left to the pose. Omitted, a circle of its radius. `head` is a sphere where the head is, `ahead` along its
   * facing and `up` from where it stands, that it neither walks nor turns into a wall (shared/sim/character.ts).
   */
  readonly footprint?: { readonly back: number; readonly front: number; readonly radius: number; readonly head?: { readonly ahead: number; readonly up: number; readonly radius: number } };
  /** What it weighs to a creature that carries or drags it (the reference's drag weight), and its mass. */
  readonly drag?: number;
  readonly mass?: number;
  /** A survivor may pick it up in both arms, hold it and throw it. */
  readonly carriable?: boolean;
  /** The item it leaves when it defecates. Omitted, it does not. */
  readonly feces?: string;
  /** The chance, 0 to 1, that a female lays an unfertilised egg in place of her feces: the item her egg prop names. */
  readonly eggChance?: number;
  // The flyers' contracts (planning/reference/flyers-plan.md, FL0): declared, checked and compiled, and read by nothing
  // until the package each names builds it. classes.ts lists them as stubs.
  /** It flies in a mode of its own (MODE_FLYER), along its look, with no climb key (FL1). Its numbers, each in its unit: */
  readonly fly?: FlyFacet;
  /** It grabs and carries in its feet while flying (FL6). */
  readonly grab?: {
    /** The most it lifts, in drag weight, against a body's drag weight plus three quarters of that body's weight stat. */
    readonly drag: number;
    /** Metres below it within which it may grab. */
    readonly reach: number;
  };
  /** Though it flees from harm, the wild of its kind go for whoever takes their egg, as ARK's pteranodon does (FL3, amending D388). */
  readonly defendsEgg?: boolean;
  /** The share of a rider's weight that counts on it, 0 to 1 (ARK's PassengerWeightMultiplier). 1 where not given (FL2). */
  readonly riderWeight?: number;
  /**
   * Multiplier on the damage of a hit from a missile, a projectile that is not a bullet: an arrow, a dart, a stone, a
   * thrown weapon. ARK's flyers take 1.5 (ASE 231.4). 1 where not given. The weapons program's damage function reads it.
   */
  readonly missiles?: number;
  /** Multiplier on the damage its bite and bare hands do to a structure. ARK's flyers do 0.4 (ASE 177.0). 1 where not given. */
  readonly structures?: number;
  /**
   * The taming bonuses of each stat, ARK's TamingMaxStatAdditions and TamingMaxStatMultipliers (Ta and Tm): what a tame
   * gains over its wild value by how well it was tamed (the tameBonus feature). Where a stat is not given, both are 0.
   */
  readonly tameBonus?: { readonly [S in StatName]?: readonly [add: number, mult: number] };
  /** A tame's base health as a share of a wild one's (ARK's TamedBaseHealthMultiplier). 1 where not given (tameBonus). */
  readonly tamedHealth?: number;
  /** How big its body is, for the loot it holds (BODY_SIZES, shared/sim/loot.ts); medium where not given. */
  readonly size?: BodySize;
  // The rest are stubs: declared, checked and read by nothing yet. The catalogue says what each waits for.
  /** What kind of variant of its base it is: "alpha", "event". */
  readonly variant?: string;
  /** Its attacks, to replace `bite` and `fists`. */
  readonly attacks?: readonly { readonly name: string; readonly damage: number; readonly type: DamageType; readonly reach: number; readonly ticks: number; readonly lands: number }[];
  /**
   * The saddle item it wears. Today the saddle names the species. How a worn saddle is drawn is its asset's business, not
   * content's: see the `saddled` slot of species/creature (shared/content/classes.ts).
   */
  readonly saddle?: string;
  /** Buffs it always has. */
  readonly buffs?: readonly string[];
  readonly boss?: boolean;
}

/** What a tamed creature's contact gathers. "plant" names nodes without a material. */
export interface CreatureHarvestFacet {
  readonly materials: readonly string[];
  readonly power: number;
  /** Node depletion units at 100% melee, before the server's harvesting multiplier. */
  readonly damage: number;
  readonly yields?: readonly { readonly item: string; readonly mult: number }[];
}

/** A timed blow from an authored socket. It can meet each victim only once per action. */
export interface CreatureAttackDef {
  readonly name: string;
  readonly clip: string;
  readonly alternateClip?: string;
  /** Additive action layer on these bones, leaving the planted locomotion below it intact. Omitted, a whole-body clip. */
  readonly bones?: readonly string[];
  readonly socket: string;
  /** Radius of the socket's swept contact, in metres. */
  readonly radius: number;
  /** Broad-phase extent from the body origin; must enclose the socket throughout its clip. */
  readonly reach: number;
  readonly damage: number;
  readonly type: DamageType;
  /** Whole action, first and last contact tick, at 30 Hz. */
  readonly ticks: number;
  readonly lands: number;
  readonly through: number;
  readonly stamina: number;
  readonly cooldown?: number;
  readonly knockback?: number;
  readonly slow?: { readonly multiplier: number; readonly seconds: number };
  readonly pierce?: number;
  readonly harvest?: CreatureHarvestFacet;
  readonly impale?: {
    readonly socket: string;
    readonly maxDrag: number;
    readonly maxHealthFraction: number;
    readonly seconds: number;
    readonly staminaPerSecond: number;
    readonly damagePerSecond: number;
  };
}

export interface CreatureChargeDef {
  /** Hold secondary to wind up; release after minWindup, or charge automatically at windup. */
  readonly minWindup: number;
  readonly windup: number;
  readonly duration: number;
  readonly recovery: number;
  readonly cooldown: number;
  readonly speed: number;
  readonly turn: number;
  readonly stamina: number;
  readonly staminaPerSecond: number;
  readonly attack: CreatureAttackDef;
}

export interface CreatureModeDef {
  readonly name: string;
  /** A static additive pose of the mode's plates. */
  readonly clip: string;
  readonly damageTaken: number;
  readonly pierce?: number;
  readonly slow?: { readonly multiplier: number; readonly seconds: number };
  readonly harvest?: CreatureHarvestFacet;
}

export interface CreatureCombatFacet {
  /** Tactical input layered onto the existing hunt/order/path state; all distances are world metres. */
  readonly ai?: {
    /** Unsigned bearing from forward: primary turns toward the left/negative side, an alternate toward right/positive. */
    readonly primary?: { readonly bearing: number; readonly distance: number; readonly arc: number };
    /** Only attempt a charge within this band and along a clear, supported ground corridor. */
    readonly charge?: { readonly minDistance: number; readonly maxDistance: number };
  };
  readonly primary: CreatureAttackDef;
  readonly secondary?: CreatureAttackDef;
  readonly charge?: CreatureChargeDef;
  /** Reload cycles these modes, switching midway through switchTicks. At most three. */
  readonly modes?: readonly CreatureModeDef[];
  readonly switchTicks?: number;
  /** Effective inventory weight by item; the amount and transferred stack never change. */
  readonly weight?: readonly { readonly item: string; readonly mult: number }[];
  readonly protectsRider?: boolean;
  readonly rivalry?: {
    readonly distance: number; readonly minThreatDrag: number; readonly damage: number; readonly resistance: number; readonly health: number;
    /** Optional dye region that flushes on a living animal when a qualifying threat is near. */
    readonly signalRegion?: number;
  };
}

/** A species' own flight (SpeciesDef.fly), compiled into the flight fields of its MoveParams (shared/sim/character.ts). */
export interface FlyFacet {
  /** Metres per second flying. Hovering is flying with no way given. */
  readonly speed: number;
  /** Its sprint in the air, as a multiple of `speed`, wild and once tamed. Tamed defaults to wild. */
  readonly sprintMul: number;
  readonly tamedSprintMul?: number;
  /** Metres per second squared by which its velocity moves toward the one it wishes. */
  readonly accel: number;
  /** Degrees per second its facing turns toward its look in the air. */
  readonly turn: number;
  /** Stamina points per second flying or hovering and per second sprinting in the air, and points per barrel roll and per grab. */
  readonly stamina: { readonly fly: number; readonly sprint: number; readonly roll: number; readonly grab: number };
  /** Seconds after it last flew before any stamina comes back on the ground. None comes back in the air. */
  readonly wait: number;
  /**
   * The barrel roll: metres per second it adds to its speed, and seconds from one roll to the next. FL2: the damage it does
   * to each body it passes, at 100% melee, 0 where not given.
   */
  readonly roll: { readonly burst: number; readonly every: number; readonly damage?: number };
}

const FIELDS = {
  vehicle: f("facet"),
  mesh: f("text"),
  skeleton: f("text"),
  color: f("number"),
  radius: f("number"),
  height: f("number"),
  eyeHeight: f("number"),
  walkSpeed: f("number"),
  sprintMul: f("number"),
  jumpSpeed: f("number"),
  crouch: f("facet"),
  prone: f("facet"),
  turn: f("number"),
  strafe: f("switch"),
  swimSpeed: f("number"),
  swimDepth: f("number", "the origin's depth below water while floating, independent of tall plates or horns"),
  swimEyeHeight: f("number", "the breathing point's height in the conscious swimming pose"),
  stamina: f("facet"),
  food: f("facet"),
  waterPerHour: f("number"),
  slots: f("number"),
  keeps: f("number", "GetSpoilingTimeMultiplier of its inventory"),
  equips: f("switch"),
  fists: f("number"),
  fistsTorpor: f("number", "the torpor of a bare-handed strike"),
  drops: f("list", "DeathHarvestingComponent", { refs: { "[].item": "item" }, open: true }),
  corpse: f("facet", "DeathHarvestingComponent's health and damage per roll"),
  stats: f("facet", "MaxStatusValues and the per-level gains"),
  takes: f("facet", "DamageTypeAdjusters"),
  zones: f("facet"),
  killXp: f("number"),
  still: f("switch"),
  temper: f("text"),
  blood: f("text", "none: ours, how it shows in a visor's heat view"),
  sight: f("number"),
  leash: f("number"),
  bite: f("facet", "AttackInfos"),
  combat: f("facet", "ground attacks, charge and plate modes"),
  camera: f("facet", "the mounted view measured against the saddle"),
  roar: f("facet", "mounted roar range and interruption"),
  taming: f("facet", "RequiredTameAffinity"),
  eats: f("list", "DinoSettings food effectiveness", { refs: { "[].item": "item" }, open: true }),
  torporDrain: f("number"),
  breeds: f("facet", "EggItemsToSpawn, BabyAgeSpeed", { refs: { egg: "prop/egg" } }),
  tag: f("text", "DinoNameTag"),
  regions: f("list", "the ColorSetDefinitions of RandomColorSetsMale, PreventColorizationRegions"),
  mutations: f("list"),
  alarm: f("number", "the herd that flees with a creature when it is hurt"),
  tamedWalkSpeed: f("number", "the tamed base walking speed"),
  tamedSwimSpeed: f("number", "the tamed base swimming speed"),
  tamedSprintMul: f("number", "the tamed running speed"),
  drag: f("number", "drag weight"),
  mass: f("number", "mass"),
  footprint: f("facet", "its body as others on foot meet it: back, front and radius along its facing"),
  carriable: f("switch", "picked up and thrown by a player"),
  size: f("text", "the size of its body, which the loot it holds goes by; ARK's DeathInventoryTemplates"),
  feces: f("text", "the creature's feces item", { refs: { "": "item/feces" } }),
  eggChance: f("number", "the chance of an egg in place of feces"),
  // The flyers' contracts (planning/reference/flyers-plan.md, FL0), each read once its package builds it: `fly` by the step,
  // `defendsEgg` by the egg rule.
  fly: f("facet", "the flying speed, sprint and stamina, and the barrel roll"),
  grab: stub("flyers", "facet", "the most drag weight a flyer carries"),
  defendsEgg: f("switch", "a skittish flyer that turns on an egg thief"),
  riderWeight: f("number", "PassengerWeightMultiplier"),
  missiles: stub("flyers", "number", "the flyers' damage from projectiles that are not bullets"),
  structures: stub("flyers", "number", "the flyers' damage to structures"),
  tameBonus: stub("tameBonus", "facet", "TamingMaxStatAdditions and TamingMaxStatMultipliers"),
  tamedHealth: stub("tameBonus", "number", "TamedBaseHealthMultiplier"),
  variant: stub("bosses", "text", "a child blueprint's kind"),
  attacks: stub("polish", "list", "AttackInfos"),
  saddle: stub("polish", "text", "SaddleItemClass", { refs: { "": "item/saddle" } }),
  buffs: stub("polish", "list", "DefaultBuffs", { refs: { "[]": "buff" }, open: true }),
  boss: stub("bosses", "switch", "bIsBossDino"),
} satisfies Fields<SpeciesDef>;

const BODY_PARTS = ["head", "torso", "hands", "legs", "feet"] as const;
const BODY = ["mesh", "color", "radius", "height", "eyeHeight", "walkSpeed", "sprintMul", "jumpSpeed"] as const;
const HUMAN_SLOTS = {
  body: { asset: "mesh", need: "must", keys: BODY_PARTS, when: "skeleton", from: "{mesh}_{sex}/{key}", fallback: ["{mesh}/{key}", "core:mannequin/{key}"] },
  hair: { asset: "mesh", need: "may", keys: "hair", when: "skeleton", from: "{mesh}_{sex}/hair/{key}", fallback: ["none"] },
  beard: { asset: "mesh", need: "may", keys: "beard", when: "skeleton", from: "{mesh}_{sex}/beard/{key}", fallback: ["none"] },
  icon,
} satisfies Record<string, Slot>;

/** What is wrong with a species' flyer fields (planning/reference/flyers-plan.md, FL0). */
function flyerFaults(d: SpeciesDef): string[] {
  const out: string[] = [];
  const f = d.fly;
  if (f) {
    const within = (name: string, v: number | undefined, low: number, high: number, open = true): void => {
      if (!(v !== undefined && (open ? v > low : v >= low) && v <= high)) out.push(`${d.id}: fly.${name} must be ${open ? "above" : "at least"} ${low} and at most ${high}, got ${v}`);
    };
    within("speed", f.speed, 0, 40);
    within("sprintMul", f.sprintMul, 0, 4);
    if (f.tamedSprintMul !== undefined) within("tamedSprintMul", f.tamedSprintMul, 0, 4);
    within("accel", f.accel, 0, 1000);
    within("turn", f.turn, 0, 3600);
    for (const cost of ["fly", "sprint", "roll", "grab"] as const) within(`stamina.${cost}`, f.stamina?.[cost], 0, 1e6, false);
    // Both counters of a body hold FLIGHT_TICKS_MAX.
    within("wait", f.wait, 0, FLIGHT_TICKS_MAX / TICK_RATE, false);
    within("roll.burst", f.roll?.burst, 0, 40, false);
    within("roll.every", f.roll?.every, 0, FLIGHT_TICKS_MAX / TICK_RATE);
    if (f.roll?.damage !== undefined) within("roll.damage", f.roll.damage, 0, 1e6, false);
  }
  if (d.grab && !(d.grab.drag > 0 && d.grab.drag <= 1e6 && d.grab.reach > 0 && d.grab.reach <= 100)) out.push(`${d.id}: grab needs a drag above 0 and a reach above 0 and at most 100 m`);
  if (d.riderWeight !== undefined && !(d.riderWeight >= 0 && d.riderWeight <= 1)) out.push(`${d.id}: riderWeight must be from 0 to 1`);
  for (const [name, v] of [["missiles", d.missiles], ["structures", d.structures], ["bite.stamina", d.bite?.stamina]] as const) {
    if (v !== undefined && !(v >= 0 && v <= 1e6)) out.push(`${d.id}: ${name} must not be negative`);
  }
  for (const [stat, pair] of Object.entries(d.tameBonus ?? {})) {
    if (!(STAT_NAMES as readonly string[]).includes(stat) || !(Array.isArray(pair) && pair.length === 2 && pair[0] >= 0 && pair[1] >= 0)) out.push(`${d.id}: tameBonus.${stat} must name a stat and be [add >= 0, mult >= 0]`);
  }
  if (d.tamedHealth !== undefined && !(d.tamedHealth > 0 && d.tamedHealth <= 10)) out.push(`${d.id}: tamedHealth must be above 0 and at most 10`);
  return out;
}

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
const ZONE_GROUPS: Readonly<Record<string, readonly number[]>> = { head: [1], torso: [2], arms: [3, 4], hands: [5, 6], legs: [7, 8], feet: [9, 10], tail: [ZONE_TAIL] };

function moveParams(d: SpeciesDef): MoveParams {
  // A capsule is never shorter than it is wide.
  const low = (h: number): number => (h < 2 * d.radius ? 2 * d.radius : h);
  const crouchHeight = low(d.crouch?.height ?? (d.height * 2) / 3);
  const proneHeight = low(d.prone?.height ?? 0);
  return {
    radius: d.radius,
    height: d.height,
    eyeHeight: d.eyeHeight,
    lowStance: d.class !== "creature",
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
    swimDepth: d.swimDepth,
    swimEyeHeight: d.swimEyeHeight,
    swimSprintMul: 1.5,
    accelSwim: d.walkSpeed * 3,
    // Whole stamina units per tick, so both sides count the same integers.
    staminaSprint: Math.round(((d.stamina?.sprint ?? STAMINA_DEFAULT.sprint) * STAMINA_UNITS) / TICK_RATE),
    staminaRegen: Math.round(((d.stamina?.regen ?? STAMINA_DEFAULT.regen) * STAMINA_UNITS) / TICK_RATE),
    staminaJump: Math.round((d.stamina?.jump ?? STAMINA_DEFAULT.jump) * STAMINA_UNITS),
    // A cost that would round to nothing is a unit.
    staminaWalk: d.stamina?.walk ? Math.max(1, Math.round((d.stamina.walk * STAMINA_UNITS) / TICK_RATE)) : 0,
    // Whole units per tick, so both sides turn the same.
    turnRate: d.turn === undefined ? 0 : turnUnits(d.turn),
    strafe: d.strafe !== false,
    ...(d.footprint?.head ? { headAhead: d.footprint.head.ahead, headUp: d.footprint.head.up, headRadius: d.footprint.head.radius } : {}),
    ...footEnds(d),
    ...flight(d.fly),
  };
}

/** The footprint's end spheres as the blockers make its stadium, where one reaches past the capsule (MoveParams.endFront). */
function footEnds(d: SpeciesDef): { endFront?: number; endBack?: number; endRadius?: number } {
  const f = d.footprint;
  if (!f) return {};
  let back = f.back + f.radius, front = f.front - f.radius;
  if (back > front) back = front = (back + front) / 2;
  return front + f.radius > d.radius || f.radius - back > d.radius ? { endFront: front, endBack: back, endRadius: f.radius } : {};
}

/** Degrees a second as whole 1/65536 turns a tick, at least one. */
const turnUnits = (degrees: number): number => Math.max(1, Math.round(((degrees / 360) * 65536) / TICK_RATE));

/** The flight fields of MoveParams, in whole units a tick as the rest are. All 0 for a body that does not fly. */
function flight(f: SpeciesDef["fly"]) {
  // A cost a second that would round to nothing is a unit a tick.
  const perTick = (perSecond: number): number => (perSecond > 0 ? Math.max(1, Math.round((perSecond * STAMINA_UNITS) / TICK_RATE)) : 0);
  return {
    flies: f !== undefined,
    flySpeed: f?.speed ?? 0,
    flySprintMul: f?.sprintMul ?? 0,
    accelFly: f?.accel ?? 0,
    flyTurnRate: f ? turnUnits(f.turn) : 0,
    staminaFly: f ? perTick(f.stamina.fly) : 0,
    staminaFlySprint: f ? perTick(f.stamina.sprint) : 0,
    staminaRoll: f ? Math.round(f.stamina.roll * STAMINA_UNITS) : 0,
    staminaGrab: f ? Math.round(f.stamina.grab * STAMINA_UNITS) : 0,
    regenWaitTicks: f ? Math.round(f.wait * TICK_RATE) : 0,
    rollBurst: f?.roll.burst ?? 0,
    rollTicks: f ? Math.max(1, Math.round(f.roll.every * TICK_RATE)) : 0,
  };
}

const columns = (n: number) => ({
  /** The creatures that share each tag: a species and its variants. */
  tags: new Map<string, number[]>(),
  /** Null for everything that is not a species. */
  move: list<MoveParams>(n),
  vehicle: list<VehicleDefinition>(n),
  /** A species' body as others on foot meet it (SpeciesDef.footprint): back, front and radius. A circle of its radius where not given. */
  footBack: f32(n),
  footFront: f32(n),
  footRadius: f32(n),
  /** Per species: the multiplier on each DMG_ type it takes, and on a hit to each zone. Null for everything else. */
  takes: list<Float32Array>(n),
  zoneMul: list<Float32Array>(n),
  /** Per species: the speed from which it is drawn running, in metres per second. */
  runAt: f32(n),
  /** Per species: its taming numbers, or null if it cannot be tamed, and what it eats, best first, as triples of item, food and affinity. */
  taming: list<TameParams>(n),
  eats: list<readonly number[]>(n),
  /**
   * Per species that breeds: the prop a female lays (0 if she bears live young), the ticks to hatch and the ticks to grow up,
   * both at the reference's rates, and a newborn's size as a share of a grown one. A species that does not breed has 0xffff
   * and 0 ticks.
   */
  breedEgg: u16(n, 0xffff),
  incubateTicks: u32(n),
  matureTicks: u32(n),
  birthScale: f32(n, 1),
  /** Per species: the colours each region of a wild one may take, and the palette colours a mutation may give a region. Null for everything else. */
  colorSet: list<ColorSet>(n),
  mutationColors: list<readonly number[]>(n),
  /** Per species: its temper (0 flees, 1 defends, 2 hunts), and its sight and leash in metres. */
  temper: u8(n),
  sight: f32(n),
  leash: f32(n),
  /**
   * Per species: how far off others of its species take fright with it (0 for none), how it moves once tamed (the very
   * object `move` holds where taming does not change it), its drag weight and mass (0 where not given), 1 if a survivor may
   * pick it up, the item it leaves when it defecates (0 for none), and the chance a female lays an egg in its place.
   */
  alarm: f32(n),
  combat: list<CreatureCombatFacet>(n),
  tamedMove: list<MoveParams>(n),
  drag: f32(n),
  mass: f32(n),
  carriable: u8(n),
  /** Per species: its body's size as an index into BODY_SIZES, medium where it does not say. */
  bodySize: u8(n),
  feces: u16(n),
  eggChance: f32(n),
  // The flyers' columns (planning/reference/flyers-plan.md, FL0), compiled and read by nothing until the package named
  // builds them. A flyer's speeds, turn, stamina and roll are in its MoveParams.
  /** Per species: 1 if it flies (SpeciesDef.fly). */
  flies: u8(n),
  /** FL6, per species: the most drag weight it grabs and lifts (0 if it grabs nothing), and the metres below it it reaches. */
  grabDrag: f32(n),
  grabReach: f32(n),
  /** FL3, per species: 1 if its wild go for whoever takes their egg though the species flees. */
  defendsEgg: u8(n),
  /** FL2, per species: the share of a rider's weight that counts on it, 1 where not given, and the stamina units one bite costs. */
  riderWeight: f32(n, 1),
  biteStamina: u32(n),
  /** FL2, per species: the damage its barrel roll does to each body it passes (`fly.roll.damage`), 0 for none. */
  rollDamage: f32(n),
  /**
   * Per species: what the damage of a missile, a projectile that is not a bullet, is multiplied by against it, and what its
   * bite's and bare hands' damage is multiplied by against a structure. 1 where not given.
   */
  missileMul: f32(n, 1),
  biteStructureMul: f32(n, 1),
});

export const species: Kind<SpeciesDef, ReturnType<typeof columns>> = {
  type: "species",
  fields: FIELDS,
  rows: [
    row("species", "species", FIELDS, { abstract: true, ark: "a character", shelf: "species", doc: "A kind of body that lives." }),
    row("species/survivor", "species", FIELDS, { parent: "species", ark: "the player's character", shelf: "survivors", must: [...BODY, "skeleton", "stats", "equips"], may: ["crouch", "prone", "swimSpeed", "stamina", "food", "waterPerHour", "slots", "fists", "fistsTorpor", "drops", "takes", "zones", "killXp", "torporDrain"], slots: HUMAN_SLOTS, doc: "The body a player has." }),
    row("species/creature", "species", FIELDS, {
      parent: "species",
      ark: "a creature's character, its status component and its entry",
      shelf: "creatures",
      must: [...BODY, "stats"],
      may: ["skeleton", "turn", "strafe", "swimSpeed", "swimDepth", "swimEyeHeight", "stamina", "food", "slots", "keeps", "fists", "bite", "roar", "combat", "camera", "drops", "corpse", "takes", "zones", "killXp", "temper", "blood", "sight", "leash", "taming", "eats", "torporDrain", "breeds", "still", "tag", "regions", "mutations", "alarm", "tamedWalkSpeed", "tamedSwimSpeed", "tamedSprintMul", "drag", "mass", "footprint", "carriable", "feces", "eggChance", "fistsTorpor", "fly", "grab", "defendsEgg", "riderWeight", "missiles", "structures", "tameBonus", "tamedHealth", "variant", "attacks", "size", "saddle", "buffs", "boss"],
      slots: {
        body: mesh("must", "{mesh}", "box"),
        rig: { asset: "rig", need: "must", when: "skeleton", from: "{mesh}", fallback: ["rigid"] },
        clip: { asset: "clip", need: "must", keys: ["idle", "walk", "run", "attack", "death"], when: "skeleton", from: "{mesh}/{key}", fallback: ["{mesh}/idle", "rest"] },
        // Without one, what it does besides goes on.
        move: { asset: "clip", need: "may", keys: ["swim", "swim_idle", "fall", "land", "turn", "startled", "flinch", "call", "torpor_eat", "held", "carried", "jump"], when: "skeleton", from: "{mesh}/{key}", fallback: ["none"] },
        torpor: { asset: "clip", need: "may", keys: ["torpor_in", "torpor_idle", "torpor_out"], when: "skeleton", from: "{mesh}/{key}", fallback: ["{mesh}/death", "rest"] },
        // A flyer's own clips (planning/reference/flyers-plan.md, FL4 and FL6). Without one, what it does besides goes on.
        flight: { asset: "clip", need: "may", keys: ["take_off", "hover", "fly", "fly_fast", "glide", "dive", "attack_air", "barrel_roll", "grab", "carry", "release", "torpor_fall", "death_air"], when: "fly", from: "{mesh}/{key}", fallback: ["none"] },
        // Two ways to draw a saddle, the asset's to choose (FL5). This is its whole model as it is saddled: the same skeleton,
        // clips, sockets and hit zones, its own meshes and maps, drawn in place of the bare body while it wears any saddle, and
        // then no saddle's worn mesh is drawn over it. Without it the bare body is drawn, with the worn saddle's "{id}/worn"
        // mesh (item/saddle) on its bones where the saddle has one.
        saddled: { asset: "mesh", need: "may", when: "skeleton", from: "{mesh}/saddled", fallback: ["#body"] },
        icon,
        sound: { asset: "sound", need: "may", keys: "any", from: "{id}/sound/{key}", fallback: ["none"] },
      },
      doc: "A wild thing that may be tamed, ridden and bred.",
    }),
    row("species/civilian", "species", FIELDS, { parent: "species", ark: "a humanoid creature", shelf: "civilians", must: [...BODY, "skeleton", "stats"], may: ["equips", "slots", "crouch", "prone", "strafe", "turn", "swimSpeed", "stamina", "food", "fists", "fistsTorpor", "takes", "zones", "killXp", "temper", "sight", "leash", "torporDrain", "still", "drops", "mass"], slots: HUMAN_SLOTS, doc: "An AI-controlled human using the current survivor body, equipment and creature systems." }),
    row("species/vehicle", "species", FIELDS, { parent: "species", ark: "a mechanical mount", shelf: "vehicles", must: [...BODY, "vehicle", "stats"], may: ["skeleton", "slots", "keeps", "still", "takes", "mass", "fists", "stamina", "swimSpeed", "strafe", "drag", "carriable", "regions", "corpse", "drops"], slots: { wreck: { ...mesh("may", "{vehicle.wreck}", "none"), when: "vehicle" }, body: mesh("must", "{mesh}", "box"), rig: { asset: "rig", need: "must", from: "{mesh}", fallback: ["rigid"] }, icon }, doc: "A vehicle with a movement controller, inventory, ownership and named seats." }),
    row("species/target", "species", FIELDS, { parent: "species", ark: "none, ours", shelf: "targets", must: [...BODY, "skeleton", "still"], may: ["stats", "equips", "slots", "zones", "takes", "torporDrain", "crouch", "prone", "stamina", "fists", "food", "drops", "killXp"], slots: HUMAN_SLOTS, doc: "A human-shaped body that stands where it is put, to be practised on. A creature that must stand still is a creature that says so." }),
  ],
  check(d, cx) {
    const { errors, input, positive } = cx;
    if (d.tag !== undefined && !TAG.test(d.tag)) errors.push(`${d.id}: tag "${d.tag}" must be one word of lower-case letters, digits and "_"`);
    if (d.vehicle) {
      try {
        if (d.vehicle.id !== d.id) throw new Error("its vehicle must carry its own id");
        // The body other systems see (radius, height) is the chassis, so nothing reads two sizes for one car.
        if (d.radius !== d.vehicle.spec.halfWidth || d.height !== d.vehicle.spec.height) throw new Error("its radius and height must be its chassis half width and height");
        validateVehicleDefinition(d.vehicle);
      } catch (e) { errors.push(`${d.id}: ${(e as Error).message}`); }
    }
    positive(d, "radius", d.radius, 8);
    positive(d, "height", d.height, 32);
    positive(d, "walkSpeed", d.walkSpeed, 40);
    // A slow walk may have a much faster sprint (Trike: 1.5 -> 6.075 m/s). This is a ratio, not an absolute speed cap.
    positive(d, "sprintMul", d.sprintMul, 8);
    if (!Number.isFinite(d.jumpSpeed) || d.jumpSpeed < 0 || d.jumpSpeed > 30) errors.push(`${d.id}: jumpSpeed must be between 0 and 30`);
    if (d.swimSpeed !== undefined) positive(d, "swimSpeed", d.swimSpeed, 40);
    if (d.swimDepth !== undefined && !(Number.isFinite(d.swimDepth) && d.swimDepth > 0 && d.swimDepth <= d.height)) errors.push(`${d.id}: swimDepth must be positive and within the body height`);
    if (d.swimEyeHeight !== undefined && !(Number.isFinite(d.swimEyeHeight) && d.swimEyeHeight > 0 && d.swimEyeHeight <= d.height)) errors.push(`${d.id}: swimEyeHeight must be positive and within the body height`);
    if (d.keeps !== undefined) positive(d, "keeps", d.keeps, 1000);
    if (d.turn !== undefined) positive(d, "turn", d.turn, 3600);
    // The pack decides which skeletons exist, so only an empty name is an error here.
    if (d.skeleton !== undefined && d.skeleton.length === 0) errors.push(`${d.id}: a skeleton must be named`);
    if (d.stamina && !(d.stamina.sprint >= 0 && d.stamina.regen >= 0 && d.stamina.jump >= 0 && (d.stamina.walk ?? 0) >= 0)) errors.push(`${d.id}: stamina costs must not be negative`);
    if (d.class !== "vehicle" && d.height < 2 * d.radius) errors.push(`${d.id}: height must be at least twice the radius`);
    if (!(d.eyeHeight > 0 && d.eyeHeight <= d.height)) errors.push(`${d.id}: eyeHeight must be within the body`);
    for (const [name, st] of [["crouch", d.crouch], ["prone", d.prone]] as const) {
      if (st && !(st.height > 0 && st.height <= d.height && st.eye > 0 && st.eye <= st.height && st.speed > 0 && st.speed <= 1)) errors.push(`${d.id}: ${name} needs 0 < eye <= height <= the body's height and 0 < speed <= 1`);
    }
    if (d.food) {
      positive(d, "food.max", d.food.max, 1e6);
      positive(d, "food.perHour", d.food.perHour, 1e6);
    }
    if (d.bite?.harvest !== undefined && d.bite.harvest !== "berries" && d.bite.harvest !== "carrion") errors.push(`${d.id}: bite.harvest must be berries or carrion`);
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
    if (d.roar) {
      for (const [name, max] of [["range", 100], ["maxDrag", 1e6], ["cooldown", 600], ["immunity", 600], ["interrupt", 30]] as const) {
        positive(d, `roar.${name}`, d.roar[name], max);
      }
      if (d.roar.immunity <= d.roar.interrupt) errors.push(`${d.id}: roar immunity must outlast its interrupt`);
    }
    if (d.alarm !== undefined) positive(d, "alarm", d.alarm, 1000);
    if (d.tamedWalkSpeed !== undefined) positive(d, "tamedWalkSpeed", d.tamedWalkSpeed, 100);
    if (d.tamedSwimSpeed !== undefined) positive(d, "tamedSwimSpeed", d.tamedSwimSpeed, 100);
    if (d.tamedSprintMul !== undefined) positive(d, "tamedSprintMul", d.tamedSprintMul, 8);
    if (d.drag !== undefined) positive(d, "drag", d.drag, 1e6);
    if (d.mass !== undefined) positive(d, "mass", d.mass, 1e6);
    if (d.size !== undefined && !BODY_SIZES.includes(d.size)) errors.push(`${d.id}: size is one of ${BODY_SIZES.join(", ")}`);
    if (d.eggChance !== undefined && !(d.eggChance >= 0 && d.eggChance <= 1)) errors.push(`${d.id}: eggChance must be from 0 to 1`);
    if (d.fistsTorpor !== undefined && !(d.fistsTorpor >= 0)) errors.push(`${d.id}: fistsTorpor must not be negative`);
    errors.push(...flyerFaults(d), ...creatureCombatFaults(d, input));
    drawnFaults(d, cx);
  },
  among(d, { errors }) {
    if (d.breeds && !(d.breeds.incubate > 0 && d.breeds.mature > 0)) errors.push(`${d.id}: breeds needs incubate and mature above 0`);
  },
  columns,
  fill(d, i, reg) {
    if (d.tag !== undefined) reg.tags.set(d.tag, [...(reg.tags.get(d.tag) ?? []), i]);
    reg.move[i] = moveParams(d);
    reg.combat[i] = d.combat ?? null;
    reg.vehicle[i] = d.vehicle ?? null;
    // A survivor's tamed numbers are its own. A creature once tamed stands on steeper ground, and may run at another
    // speed, on the ground and in the air.
    const m = reg.move[i]!;
    reg.tamedMove[i] = d.class === "creature" ? { ...m, walkSpeed: d.tamedWalkSpeed ?? m.walkSpeed, swimSpeed: d.tamedSwimSpeed ?? m.swimSpeed, sprintMul: d.tamedSprintMul ?? m.sprintMul, flySprintMul: d.fly?.tamedSprintMul ?? m.flySprintMul, slopeCos: TAMED_SLOPE_COS } : m;
    if (d.fly) reg.flies[i] = 1;
    reg.grabDrag[i] = d.grab?.drag ?? 0;
    reg.grabReach[i] = d.grab?.reach ?? 0;
    if (d.defendsEgg) reg.defendsEgg[i] = 1;
    reg.riderWeight[i] = d.riderWeight ?? 1;
    reg.biteStamina[i] = Math.round((d.bite?.stamina ?? 0) * STAMINA_UNITS);
    reg.rollDamage[i] = d.fly?.roll.damage ?? 0;
    reg.missileMul[i] = d.missiles ?? 1;
    reg.biteStructureMul[i] = d.structures ?? 1;
    reg.damage[i] = d.fists ?? 8;
    reg.meleeTorpor[i] = d.fistsTorpor ?? 0;
    reg.reach[i] = FIST_REACH;
    reg.alarm[i] = d.alarm ?? 0;
    reg.drag[i] = d.drag ?? 0;
    reg.mass[i] = d.mass ?? 0;
    reg.footBack[i] = d.footprint?.back ?? -d.radius;
    reg.footFront[i] = d.footprint?.front ?? d.radius;
    reg.footRadius[i] = d.footprint?.radius ?? d.radius;
    if (d.carriable) reg.carriable[i] = 1;
    reg.bodySize[i] = BODY_SIZES.indexOf(d.size ?? "medium");
    reg.eggChance[i] = d.eggChance ?? 0;
    reg.takes[i] = Float32Array.from(DAMAGE_TYPES, (t) => d.takes?.[t] ?? 1);
    const zones = new Float32Array(ZONE_COUNT).fill(1);
    for (const [group, v] of Object.entries(d.zones ?? {})) for (const z of ZONE_GROUPS[group]!) zones[z] = v;
    reg.zoneMul[i] = zones;
    reg.bodyRadius[i] = d.radius;
    reg.bodyHeight[i] = d.height;
  },
  link(d, i, reg) {
    reg.runAt[i] = d.walkSpeed * 1.5;
    reg.temper[i] = Math.max(0, ["flees", "defends", "hunts"].indexOf(d.temper ?? "flees"));
    reg.sight[i] = d.sight ?? 20;
    reg.taming[i] = d.taming ?? null;
    if (d.eats) reg.eats[i] = d.eats.flatMap((f) => [reg.index.get(f.item)!, f.food, f.affinity]);
    reg.leash[i] = d.leash ?? 60;
    reg.keeps[i] = d.keeps ?? 1;
    if (d.feces !== undefined) reg.feces[i] = reg.index.get(d.feces)!;
    if (d.breeds) {
      reg.breedEgg[i] = d.breeds.egg !== undefined ? reg.index.get(d.breeds.egg)! : 0;
      reg.incubateTicks[i] = Math.round(d.breeds.incubate * TICK_RATE);
      reg.matureTicks[i] = Math.round(d.breeds.mature * TICK_RATE);
      reg.birthScale[i] = d.breeds.scale ?? BIRTH_SCALE;
    }
    reg.colorSet[i] = d.regions ? compileColors(d.regions.map((r) => r && r.colors)) : WILD_SET;
    reg.mutationColors[i] = d.mutations ?? MUTATION_COLORS;
    // A bite is the species' melee weapon.
    if (d.bite) {
      reg.reach[i] = d.bite.reach;
      reg.weapon[i] = { kind: W_MELEE, hold: HOLD_HANDS, swingTicks: d.bite.ticks ?? 27, strikeTick: d.bite.lands ?? 11, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true };
    }
  },
};
