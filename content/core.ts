// Colours are palette indices. See shared/pack/palette.ts.

import type { Def, NodeDef } from "../shared/content/defs.ts";
import { BUILDING_CONTENT } from "./building.ts";
import { crafted, crafting } from "./craft.ts";
import { CREATURES } from "./creatures/index.ts";
import type { ContentPack } from "../shared/content/packs.ts";

const id = (name: string): string => `core:${name}`;
/** Real minutes, as the hours of 140 seconds that spoiling is written in. */
const minutes = (n: number): number => (n * 60) / 140;

// Every piece of an armor tier has the same rating and durability, so a full set rates five times one piece.
const ARMOR_TIERS: readonly { tier: string; set: string; armor: number; uses: number; weight: number; colors: readonly [number, number, number] }[] = [
  { tier: "cloth", set: "cloth", armor: 10, uses: 25, weight: 0.4, colors: [1, 15, 225] },
  { tier: "hide", set: "hide", armor: 20, uses: 45, weight: 1.5, colors: [227, 228, 225] },
  { tier: "chitin", set: "hide", armor: 50, uses: 50, weight: 3, colors: [9, 4, 1] },
  { tier: "flak", set: "hide", armor: 100, uses: 120, weight: 4, colors: [2, 11, 6] },
];
const ARMOR_PIECES: readonly { slot: "head" | "torso" | "hands" | "legs" | "feet"; name: string; label: string }[] = [
  { slot: "head", name: "hat", label: "hat" },
  { slot: "torso", name: "shirt", label: "shirt" },
  { slot: "hands", name: "gloves", label: "gloves" },
  { slot: "legs", name: "pants", label: "pants" },
  { slot: "feet", name: "boots", label: "boots" },
];
const ARMOR: Def[] = ARMOR_TIERS.flatMap((t) =>
  ARMOR_PIECES.map((p): Def => ({ type: "item", class: "armor", id: id(`${t.tier}_${p.name}`), stack: 1, weight: t.weight, label: `${t.tier} ${p.label}`, color: t.colors[0], wear: { slot: p.slot, armor: t.armor, uses: t.uses, set: t.set, colors: t.colors } })),
);

const ATTACHMENTS = [id("scope"), id("silencer"), id("flashlight"), id("laser")];
const ARROWS = [id("arrow_stone"), id("arrow_tranq"), id("arrow_flame")];

const GEAR: Def[] = [
  { type: "item", class: "resource", id: id("hide"), stack: 200, weight: 0.01, color: 227 },
  { type: "item", class: "resource", id: id("chitin"), stack: 100, weight: 0.05, color: 9 },
  { type: "item", class: "resource", id: id("ore"), stack: 300, weight: 1, label: "metal ore", color: 4 },
  { type: "item", class: "resource", id: id("ingot"), stack: 300, weight: 1, label: "metal ingot", color: 2 },
  { type: "item", class: "resource", id: id("gunpowder"), stack: 100, weight: 0.1, color: 11 },
  { type: "item", class: "consumable", id: id("narcotic"), stack: 100, weight: 0.1, color: 9, dose: { torpor: 40, seconds: 8 } },

  { type: "item", class: "weapon", id: id("spear"), stack: 1, weight: 2, color: 3, weapon: { kind: "melee", damage: 30, type: "pierce", reach: 3, uses: 20, mesh: id("spear"), hold: "spear" } },
  // A bow does a quarter of the arrow's damage undrawn and all of it after 1.2 s of draw.
  { type: "item", class: "weapon", id: id("bow"), stack: 1, weight: 4, color: 3, weapon: { kind: "bow", ammo: ARROWS, power: 1, reload: 0.66, draw: 1.2, uses: 50, mesh: id("bow"), hold: "bow" } },
  // A stone arrow from a crossbow does 95.
  { type: "item", class: "weapon", id: id("crossbow"), stack: 1, weight: 6, color: 4, weapon: { kind: "gun", ammo: ARROWS, power: 95 / 55, reload: 2.6, uses: 100, wet: true, mesh: id("crossbow"), hold: "rifle" } },
  { type: "item", class: "weapon", id: id("rifle"), stack: 1, weight: 9, label: "long rifle", color: 228, weapon: { kind: "gun", ammo: [id("round_rifle"), id("dart_tranq"), id("dart_shock")], power: 1, reload: 4.5, uses: 70, fits: ATTACHMENTS, mesh: id("rifle"), hold: "rifle" } },
  { type: "item", class: "weapon", id: id("pistol"), stack: 1, weight: 3, color: 2, weapon: { kind: "gun", ammo: [id("round_pistol")], power: 1, clip: 6, reload: 2.2, interval: 0.35, uses: 60, fits: ATTACHMENTS, mesh: id("pistol"), hold: "pistol" } },
  { type: "item", class: "weapon", id: id("grenade"), stack: 10, weight: 1, color: 7, weapon: { kind: "thrown", damage: 788, type: "explosive", speed: 18, fuse: 5, blast: 5, uses: 1, mesh: id("grenade"), hold: "tool" } },

  { type: "item", class: "ammo", id: id("arrow_stone"), stack: 100, weight: 0.2, label: "stone arrow", color: 15, ammo: { damage: 55, type: "pierce", speed: 70, gravity: 9.81, recover: 0.5, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_tranq"), stack: 100, weight: 0.2, label: "tranquilizer arrow", color: 9, ammo: { damage: 20, type: "pierce", speed: 70, gravity: 9.81, torpor: { instant: 2, over: 2.5, seconds: 5 }, mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("arrow_flame"), stack: 100, weight: 0.2, label: "flame arrow", color: 3, ammo: { damage: 55, type: "fire", speed: 70, gravity: 9.81, buff: id("burning"), mesh: id("arrow") } },
  { type: "item", class: "ammo", id: id("round_rifle"), stack: 100, weight: 0.1, label: "rifle round", color: 6, ammo: { damage: 280, type: "bullet" } },
  { type: "item", class: "ammo", id: id("round_pistol"), stack: 100, weight: 0.05, label: "pistol round", color: 6, ammo: { damage: 100, type: "bullet" } },
  { type: "item", class: "ammo", id: id("dart_tranq"), stack: 100, weight: 0.2, label: "tranquilizer dart", color: 9, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 6, over: 2.5, seconds: 5 }, mesh: id("dart") } },
  { type: "item", class: "ammo", id: id("dart_shock"), stack: 100, weight: 0.2, label: "shock dart", color: 6, ammo: { damage: 26, type: "pierce", speed: 120, gravity: 9.81, torpor: { instant: 12, over: 5, seconds: 5 }, buff: id("stunned"), mesh: id("dart") } },

  { type: "item", class: "attachment", id: id("scope"), stack: 1, weight: 0.5, color: 11, attachment: "scope" },
  { type: "item", class: "attachment", id: id("silencer"), stack: 1, weight: 0.5, color: 11, attachment: "silencer" },
  { type: "item", class: "attachment", id: id("flashlight"), stack: 1, weight: 0.5, color: 6, attachment: "light" },
  { type: "item", class: "attachment", id: id("laser"), stack: 1, weight: 0.5, color: 8, attachment: "laser" },
  ...ARMOR,
];

type Needs = readonly (readonly [item: string, count: number])[];
/** How one thing is made, and the engram that unlocks it. */
function making(name: string, label: string, level: number, cost: number, count: number, seconds: number, needs: Needs): Def[] {
  return [
    crafting(id(name), { needs: needs.map(([item, n]) => ({ item: id(item), count: n })), seconds, xp: Math.max(1, Math.round(level / 3)), count }),
    { type: "engram", id: id(`engram-${name}`), label, level, cost, item: id(name) },
  ];
}

/** level and cost are the tier engram's level and points. */
const ARMOR_MAKING: Readonly<Record<string, { level: number; cost: number; needs: Readonly<Record<string, Needs>> }>> = {
  cloth: { level: 3, cost: 3, needs: { hat: [["fiber", 10]], shirt: [["fiber", 40]], gloves: [["fiber", 20]], pants: [["fiber", 50]], boots: [["fiber", 25], ["hide", 6]] } },
  hide: { level: 15, cost: 9, needs: { hat: [["hide", 15], ["fiber", 6]], shirt: [["hide", 20], ["fiber", 8]], gloves: [["hide", 10], ["fiber", 4]], pants: [["hide", 25], ["fiber", 10]], boots: [["hide", 12], ["fiber", 5]] } },
  chitin: { level: 37, cost: 18, needs: { hat: [["chitin", 15], ["hide", 7], ["fiber", 3]], shirt: [["chitin", 20], ["hide", 10], ["fiber", 4]], gloves: [["chitin", 10], ["hide", 5], ["fiber", 2]], pants: [["chitin", 25], ["hide", 12], ["fiber", 5]], boots: [["chitin", 12], ["hide", 6], ["fiber", 4]] } },
  flak: { level: 56, cost: 16, needs: { hat: [["ingot", 10], ["hide", 7], ["fiber", 3]], shirt: [["ingot", 13], ["hide", 10], ["fiber", 4]], gloves: [["ingot", 6], ["hide", 5], ["fiber", 2]], pants: [["ingot", 16], ["hide", 12], ["fiber", 5]], boots: [["ingot", 8], ["hide", 6], ["fiber", 4]] } },
};

// Trees, rocks and bushes. As in the reference game, every tree gives thatch and wood, the hatchet more wood; every rock gives
// stone and flint, the pick more flint; every bush is picked by hand for fibre and what it bears. A bigger kind gives more in
// all by taking more blows. Each grows at sizes through its range, turned every way. Until a kind names its variants it is
// drawn as the grey box of its `half`, with its `top` for a crown.
const TREE_YIELDS: NodeDef["yields"] = [{ item: "core:thatch", min: 2, max: 4 }, { item: "core:wood", min: 0, max: 1 }, { item: "core:wood", min: 1, max: 2, tool: true }];
const ROCK_YIELDS: NodeDef["yields"] = [{ item: "core:stone", min: 1, max: 2 }, { item: "core:flint", min: 1, max: 2, tool: true }];
const tree = (name: string, hits: number, half: NodeDef["half"], top: NonNullable<NodeDef["top"]>, size: NodeDef["size"]): NodeDef => ({ type: "node", id: id(name), mesh: "box", color: 3, half, top, hits, respawnHours: 2, material: "wood", yields: TREE_YIELDS, xp: 1, size });
const NODES: NodeDef[] = [
  // Hardwood hammock trees.
  tree("tree", 12, [0.3, 2, 0.3], { half: [1.4, 1.6, 1.4], color: 7 }, [0.8, 1.25]),
  tree("palm", 10, [0.2, 3.5, 0.2], { half: [1.6, 0.5, 1.6], color: 17 }, [0.8, 1.25]),
  // Strangler figs and banyans are the big trees, and take the most blows.
  tree("fig", 20, [0.5, 2.5, 0.5], { half: [3.2, 2, 3.2], color: 16 }, [0.85, 1.2]),
  tree("banyan", 30, [1, 3, 1], { half: [5, 2.5, 5], color: 7 }, [0.9, 1.2]),
  tree("mangrove", 8, [0.25, 1.4, 0.25], { half: [1.8, 1, 1.8], color: 12 }, [0.75, 1.2]),
  // Limestone boulders. Only these hold a little ore, as the rocks always have here.
  { type: "node", id: id("rock"), mesh: "box", color: 15, half: [0.9, 0.6, 0.8], hits: 10, respawnHours: 2, material: "stone", yields: [...ROCK_YIELDS, { item: "core:ore", min: 0, max: 1, tool: true }], xp: 1, size: [0.6, 1.5] },
  { type: "node", id: id("rubble"), mesh: "box", color: 2, half: [1.3, 0.45, 1], hits: 8, respawnHours: 2, material: "stone", yields: ROCK_YIELDS, xp: 1, size: [0.6, 1.4] },
  // A metal rock, darker and veined, which a player learns to spot. It is harder than limestone, and a pick gets its ore.
  { type: "node", id: id("metal_rock"), mesh: "box", color: 4, half: [1, 0.7, 0.9], hits: 15, respawnHours: 2, material: "stone", yields: [{ item: "core:stone", min: 1, max: 1 }, { item: "core:ore", min: 1, max: 3, tool: true }], xp: 1, size: [0.7, 1.4] },
  // Berry bushes.
  { type: "node", id: id("bush"), mesh: "box", color: 16, half: [0.5, 0.4, 0.5], soft: true, hits: 4, respawnHours: 1, yields: [{ item: "core:berry", min: 3, max: 6 }, { item: "core:fiber", min: 2, max: 5 }], xp: 0.5, size: [0.75, 1.25] },
  // Saw palmetto bears a few berries. A fern bears none.
  { type: "node", id: id("palmetto"), mesh: "box", color: 17, half: [0.7, 0.5, 0.7], soft: true, hits: 4, respawnHours: 1, yields: [{ item: "core:fiber", min: 3, max: 6 }, { item: "core:berry", min: 1, max: 3 }], xp: 0.5, size: [0.7, 1.3] },
  { type: "node", id: id("fern"), mesh: "box", color: 7, half: [0.45, 0.35, 0.45], soft: true, hits: 3, respawnHours: 1, yields: [{ item: "core:fiber", min: 3, max: 6 }], xp: 0.5, size: [0.7, 1.3] },
  // Sea grape is a berry bush of the shore. Creeper, a mass of vine, gives fibre and nothing else.
  { type: "node", id: id("seagrape"), mesh: "box", color: 12, half: [0.9, 0.8, 0.9], soft: true, hits: 4, respawnHours: 1, yields: [{ item: "core:berry", min: 3, max: 6 }, { item: "core:fiber", min: 2, max: 4 }], xp: 0.5, size: [0.75, 1.3] },
  { type: "node", id: id("creeper"), mesh: "box", color: 16, half: [0.8, 0.6, 0.5], soft: true, hits: 3, respawnHours: 1, yields: [{ item: "core:fiber", min: 4, max: 8 }], xp: 0.5, size: [0.7, 1.4] },
];

/** Levels are the reference game's. */
const MAKING: Def[] = [
  ...making("spear", "Spear", 2, 3, 1, 3, [["flint", 2], ["wood", 8], ["fiber", 12]]),
  ...making("narcotic", "Narcotic", 6, 6, 1, 4, [["berry", 5], ["meat", 1]]),
  ...making("bow", "Bow", 10, 11, 1, 6, [["wood", 15], ["fiber", 50]]),
  ...making("arrow_stone", "Stone arrow", 10, 0, 2, 2, [["thatch", 2], ["fiber", 2], ["flint", 1]]),
  ...making("ingot", "Smelting", 20, 6, 1, 6, [["ore", 2], ["wood", 1]]),
  ...making("arrow_tranq", "Tranquilizer arrow", 21, 8, 1, 3, [["arrow_stone", 1], ["narcotic", 1]]),
  ...making("gunpowder", "Gunpowder", 21, 2, 1, 2, [["flint", 1], ["stone", 1], ["wood", 1]]),
  ...making("crossbow", "Crossbow", 25, 12, 1, 10, [["ingot", 7], ["wood", 10], ["fiber", 35]]),
  ...making("flashlight", "Flashlight attachment", 25, 13, 1, 6, [["ingot", 20], ["stone", 10]]),
  ...making("scope", "Scope attachment", 30, 13, 1, 6, [["ingot", 40], ["stone", 20]]),
  ...making("arrow_flame", "Flame arrow", 31, 15, 2, 3, [["arrow_stone", 2], ["thatch", 4], ["fiber", 3], ["gunpowder", 1]]),
  ...making("pistol", "Pistol", 34, 15, 1, 12, [["ingot", 60], ["wood", 5], ["hide", 15]]),
  ...making("round_pistol", "Pistol round", 34, 6, 1, 2, [["ingot", 1], ["gunpowder", 6]]),
  ...making("rifle", "Long rifle", 35, 18, 1, 15, [["ingot", 95], ["wood", 20], ["hide", 25]]),
  ...making("round_rifle", "Rifle round", 35, 6, 1, 2, [["ingot", 2], ["gunpowder", 12]]),
  ...making("silencer", "Silencer attachment", 36, 13, 1, 6, [["ingot", 50], ["chitin", 20]]),
  ...making("grenade", "Grenade", 42, 20, 1, 8, [["fiber", 15], ["stone", 20], ["gunpowder", 30], ["hide", 5], ["ingot", 2]]),
  ...making("laser", "Laser attachment", 50, 24, 1, 6, [["ingot", 50], ["stone", 40]]),
  ...making("dart_tranq", "Tranquilizer dart", 62, 30, 1, 4, [["narcotic", 3], ["ingot", 2]]),
  ...making("dart_shock", "Shock dart", 96, 60, 1, 4, [["narcotic", 6], ["ingot", 4], ["gunpowder", 4]]),
  // Each piece of an armor tier has its own engram, at the tier's level and cost. They were one engram for all five once,
  // and a save that knew the set knows every piece.
  ...ARMOR_TIERS.flatMap((t): Def[] => {
    const m = ARMOR_MAKING[t.tier]!;
    return [
      ...ARMOR_PIECES.flatMap((p): Def[] => [
        crafting(id(`${t.tier}_${p.name}`), { needs: m.needs[p.name]!.map(([item, n]) => ({ item: id(item), count: n })), seconds: 5, xp: Math.round(m.level / 3) }),
        { type: "engram", id: id(`engram-${t.tier}_${p.name}`), label: `${t.tier[0]!.toUpperCase()}${t.tier.slice(1)} ${p.label}`, level: m.level, cost: m.cost, item: id(`${t.tier}_${p.name}`) },
      ]),
      { type: "rename", id: id(`engram-${t.tier}`), to: ARMOR_PIECES.map((p) => id(`engram-${t.tier}_${p.name}`)) },
    ];
  }),
];

/**
 * The reference game's survivor levels: the experience each of the 105 takes in all, fractions included, and the engram
 * points each gives. Levels past 105 are its ascensions, which are not built.
 */
const LEVELS: Def = (() => {
  const xp = [
    0, 5, 20, 40, 70, 120, 190, 270, 360, 450,
    550, 660, 780, 910, 1050, 1200, 1360, 1530, 1710, 1900,
    2100, 2310, 2530, 2760, 3000, 3250, 3510, 3780, 4060, 4350,
    4650, 4960, 5280, 5610, 5950, 6300, 6660, 7030, 7410, 7800,
    8200, 8610, 9030, 9460, 9900, 10350, 10810, 11280, 11760, 12250,
    12750, 13260, 13780, 14310, 14850, 15400, 15960, 16530, 17110, 17700,
    18850, 21078, 22448, 23908, 25462, 27498.96, 30248.86, 34786.19, 40004.11, 46804.82,
    54761.64, 63713.98, 73000, 85000, 98000, 112000, 127500, 144500, 163500, 184500,
    207500, 232570, 259896, 289681, 323189, 360886, 403318, 451484, 506186, 566358,
    632547, 705354, 785441.7, 873538.1, 971538.1, 1083538, 1213538, 1368538, 1558538, 1798538,
    2098538, 2468538, 2918538, 3458538, 4098538,
  ];
  // The first level that gives each number of points.
  const steps: readonly (readonly [level: number, points: number])[] = [[2, 8], [10, 12], [20, 16], [30, 20], [40, 24], [50, 28], [60, 40], [73, 50], [87, 60], [99, 70]];
  const engramPoints = xp.map((_, i) => steps.findLast(([level]) => i + 1 >= level)?.[1] ?? 0);
  return { type: "levels", id: id("levels"), xp, engramPoints };
})();

// Stats are [base, gain per wild level, gain per level an owner gives]. The creatures are in content/creatures.
const ALL: readonly Def[] = [
  {
    type: "species", class: "survivor",
    id: "core:survivor",
    mesh: "core:human",
    skeleton: "human",
    color: 8,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 4.5,
    sprintMul: 1.6,
    jumpSpeed: 7,
    food: { max: 100, perHour: 6 },
    waterPerHour: 9,
    slots: 40,
    equips: true,
    fists: 8,
    zones: { head: 3 },
    killXp: 10,
    // Knocked out at 200 torpor, and out for most of a minute.
    torporDrain: 4,
    stats: { health: [100, 0, 0.1], stamina: [100, 0, 0.1], oxygen: [100, 0, 0.2], food: [100, 0, 0.1], water: [100, 0, 0.1], weight: [100, 0, 0.1], melee: [1, 0, 0.05], speed: [1, 0, 0.015], torpidity: [200, 0, 0] },
  },
  // A practice target with a survivor's shape and zones.
  {
    type: "species", class: "target",
    id: "core:dummy",
    mesh: "core:mannequin",
    skeleton: "human",
    color: 3,
    radius: 0.4,
    height: 1.8,
    eyeHeight: 1.62,
    walkSpeed: 1,
    sprintMul: 1,
    jumpSpeed: 1,
    slots: 5,
    equips: true,
    still: true,
    zones: { head: 3 },
    stats: { health: [100000, 0, 0], torpidity: [200, 0, 0] },
    torporDrain: 4,
  },
  // Damage multipliers by material, as in the reference game. The tiers differ in what can harm them, not in health.
  { type: "material", id: "core:mat_thatch", takes: { melee: 1, fire: 4, explosive: 1 }, decayDays: 4 },
  { type: "material", id: "core:mat_wood", takes: { fire: 3, explosive: 1 }, decayDays: 8 },
  { type: "material", id: "core:mat_stone", takes: { explosive: 2.3325 }, decayDays: 12 },
  { type: "material", id: "core:mat_metal", takes: { explosive: 0.3008 }, decayDays: 16 },
  { type: "structure", class: "static", id: "core:block", mesh: "box", color: 2, half: [1, 1, 1], hp: 1000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:crate", mesh: "box", color: 3, half: [0.5, 0.5, 0.5], hp: 200, material: "core:mat_wood" },
  { type: "structure", class: "static", id: "core:foundation", mesh: "box", color: 4, half: [1.5, 0.15, 1.5], hp: 15000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:wall", mesh: "box", color: 5, half: [1.5, 1.5, 0.1], hp: 10000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:ceiling", mesh: "box", color: 4, half: [1.5, 0.1, 1.5], hp: 10000, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:pillar", mesh: "box", color: 6, half: [0.25, 3, 0.25], hp: 6250, material: "core:mat_stone" },
  { type: "structure", class: "static", id: "core:step", mesh: "box", color: 7, half: [1, 0.15, 0.5], hp: 400, material: "core:mat_wood" },
  // The plaza floor has no material, so nothing harms it.
  { type: "structure", class: "static", id: "core:slab", mesh: "box", color: 2, half: [4, 0.25, 4], hp: 4000 },
  ...BUILDING_CONTENT,
  ...CREATURES,
  { type: "prop", class: "projectile", id: "core:grenade_live", mesh: "core:grenade_thrown", color: 7, radius: 0.08, height: 0.12 },
  // Holds everything a survivor carried when it died.
  { type: "prop", class: "container", id: "core:cache", mesh: "box", color: 6, radius: 0.35, height: 0.5, slots: 60 },
  // Holds items dropped on the ground.
  { type: "prop", class: "container", id: "core:bag", mesh: "box", color: 3, radius: 0.22, height: 0.28, slots: 10 },
  { type: "buff", id: "core:burning", label: "Burning", color: 3, seconds: 8, health: -8 },
  { type: "buff", id: "core:tranquilized", label: "Tranquilized", color: 9, seconds: 5, again: "stack" },
  // A narcotic at work. Doses run one after another.
  { type: "buff", id: "core:drugged", label: "Drugged", color: 9, seconds: 8 },
  { type: "buff", id: "core:stunned", label: "Stunned", color: 6, seconds: 3, root: true },
  { type: "buff", id: "core:injured", label: "Injured", color: 8, speed: 0.8 },
  // What a meal mends comes at this rate. A piece of cooked meat is 8 health over five seconds.
  { type: "buff", id: "core:fed", label: "Fed", color: 12, seconds: 5, health: 1.6, good: true },
  { type: "buff", id: "core:god", label: "God", color: 14, immune: true, good: true },
  // A missed arrow that did not break. It stays where it landed until someone walks over it.
  { type: "prop", class: "projectile", id: "core:arrow_stuck", mesh: "core:arrow", color: 15, radius: 0.1, height: 0.1, pitched: true },
  { type: "item", class: "resource", id: "core:fiber", stack: 300, weight: 0.01, color: 7 },
  { type: "item", class: "resource", id: "core:stone", stack: 100, weight: 0.5, color: 15 },
  { type: "item", class: "consumable", id: "core:berry", stack: 100, weight: 0.1, spoilHours: minutes(10), eat: { food: 4, water: 2 }, color: 8 },
  { type: "item", class: "consumable", id: "core:meat", stack: 40, weight: 0.1, spoilHours: minutes(10), eat: { food: 25, health: 5 }, color: 3, label: "raw meat", cooks: { into: "core:meat_cooked", seconds: 20 } },
  { type: "item", class: "consumable", id: "core:meat_cooked", stack: 50, weight: 0.1, spoilHours: minutes(20), eat: { food: 35, health: 8 }, color: 3, label: "cooked meat" },
  { type: "item", class: "consumable", id: "core:waterskin", stack: 1, weight: 1, eat: { water: 60 }, label: "water skin", color: 14 },
  { type: "item", class: "resource", id: "core:wood", stack: 100, weight: 0.5, color: 3, fuel: 30 },
  { type: "item", class: "resource", id: "core:thatch", stack: 200, weight: 0.02, color: 18, fuel: 7.5 },
  { type: "item", class: "resource", id: "core:flint", stack: 100, weight: 0.05, color: 4 },
  { type: "item", class: "weapon", id: "core:pick", stack: 1, weight: 1, color: 2, tool: { on: "stone", power: 3, uses: 60 }, weapon: { kind: "melee", damage: 16, type: "melee", uses: 60, mesh: "core:pick", hold: "tool" } },
  { type: "item", class: "weapon", id: "core:hatchet", stack: 1, weight: 1, color: 5, tool: { on: "wood", power: 3, uses: 60 }, weapon: { kind: "melee", damage: 20, type: "melee", uses: 60, mesh: "core:hatchet", hold: "tool" } },
  ...GEAR,

  ...NODES,

  crafting("core:pick", { needs: [{ item: "core:stone", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 }),
  crafting("core:hatchet", { needs: [{ item: "core:flint", count: 1 }, { item: "core:wood", count: 1 }, { item: "core:thatch", count: 10 }], seconds: 2, xp: 2 }),
  crafting("core:waterskin", { needs: [{ item: "core:fiber", count: 20 }, { item: "core:thatch", count: 5 }], seconds: 4, xp: 3 }),
  { type: "engram", id: "core:engram-pick", label: "Stone pick", level: 1, cost: 0, item: "core:pick" },
  { type: "engram", id: "core:engram-hatchet", label: "Stone hatchet", level: 2, cost: 3, item: "core:hatchet" },
  { type: "engram", id: "core:engram-waterskin", label: "Water skin", level: 3, cost: 6, item: "core:waterskin" },
  ...MAKING,
  LEVELS,
];

export const CORE_CONTENT: readonly Def[] = crafted(ALL);

/** CORE_CONTENT as a pack, for stacking other packs on top. */
export const CORE_PACK: ContentPack = { name: "core", defs: CORE_CONTENT as readonly Def[] as unknown as ContentPack["defs"] };
