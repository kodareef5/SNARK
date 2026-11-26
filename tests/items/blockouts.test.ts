// The things blocked out (content/items/blockouts.ts, content/creatures/trilobite.ts): each a real item under ARK's
// name with ARK's stack, weight, level, engram points, station and recipe, read from ark.wiki.gg on 2026-11-21, a plain
// box in the hand and a swatch in the bag. The older contract tests pass over them; their numbers are held here.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { BLOCKED_OUT } from "../../content/items/blockouts.ts";
import { starterBook } from "../../content/supply/starter.ts";
import type { Def, EngramDef, ItemDef, SpeciesDef, StructureDef } from "../../shared/content/defs.ts";
import { CLASSES } from "../../shared/content/classes.ts";
import { catalogOf } from "../../shared/supply/catalog.ts";
import { BLOCKOUT_MESH } from "../../tools/pack/blockout.ts";
import { iconSubjects } from "../../tools/pack/icons.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const byId = new Map(CORE_CONTENT.map((d) => [d.id, d] as const));
const item = (name: string): ItemDef => byId.get(`core:${name}`) as ItemDef;
const engram = (name: string): EngramDef | undefined => byId.get(`core:engram-${name}`) as EngramDef | undefined;

// Name, class, stack, weight, engram level and points, where it is made, in how many seconds, how many a making gives,
// and of what.
const ROWS: readonly (readonly [string, string, number, number, number | null, number | null, string, number | null, number | null, string])[] = [
  ["pelt", "resource", 200, 0.5, null, null, "", null, null, ""],
  ["organic_polymer", "resource", 20, 0.25, null, null, "", null, null, ""],
  ["angler_gel", "resource", 100, 0.01, null, null, "", null, null, ""],
  ["stimberry", "consumable", 100, 0.1, null, null, "", null, null, ""],
  ["round_advanced", "ammo", 100, 0.1, 55, 8, "fabricator", 1, 3, "1 ingot, 3 gunpowder"],
  ["round_advanced_rifle", "ammo", 100, 0.1, 58, 8, "fabricator", 1, 2, "1 ingot, 9 gunpowder"],
  ["round_advanced_sniper", "ammo", 100, 0.2, 83, 16, "fabricator", 1, 2, "2 ingot, 12 gunpowder"],
  ["arrow_metal", "ammo", 100, 0.4, 79, 35, "fabricator", 5, 1, "3 thatch, 3 fiber, 3 ingot, 1 paste, 1 polymer"],
  ["grappling_hook", "ammo", 10, 1, 47, 40, "smithy", 1, 1, "3 arrow_stone, 1 paste, 9 ingot, 2 thatch, 35 fiber"],
  ["c4", "ammo", 100, 0.1, 65, 12, "fabricator", 5, 1, "60 gunpowder, 10 crystal, 5 paste, 50 fiber, 5 hide, 5 polymer, 5 electronics"],
  ["torch", "weapon", 1, 1, 1, 0, "hand", 5, 1, "1 flint, 1 wood, 1 stone"],
  ["pike", "weapon", 1, 10, 25, 10, "smithy", 5, 1, "10 ingot, 10 wood, 20 hide"],
  ["sword", "weapon", 1, 5, 30, 11, "smithy", 5, 1, "50 ingot, 1 wood, 15 hide"],
  ["pick_metal", "weapon", 1, 2, 20, 6, "smithy", 5, 1, "1 ingot, 1 wood, 10 hide"],
  ["hatchet_metal", "weapon", 1, 2, 20, 6, "smithy", 5, 1, "8 ingot, 1 wood, 10 hide"],
  ["sickle", "weapon", 1, 2, 30, 12, "smithy", 5, 1, "18 ingot, 4 wood, 16 hide"],
  ["prod", "weapon", 1, 6, 95, 60, "fabricator", 5, 1, "120 polymer, 130 ingot, 120 electronics, 70 paste, 120 crystal, 15 angler_gel"],
  ["bow_compound", "weapon", 1, 12, 79, 40, "fabricator", 5, 1, "95 polymer, 85 ingot, 75 paste"],
  ["pistol_fabricated", "weapon", 1, 2.5, 55, 18, "fabricator", 5, 1, "35 polymer, 20 ingot, 30 paste"],
  ["shotgun_pump", "weapon", 1, 15, 55, 18, "fabricator", 15, 1, "30 ingot, 55 polymer, 45 paste"],
  ["rifle_assault", "weapon", 1, 10, 58, 24, "fabricator", 5, 1, "60 polymer, 35 ingot, 50 paste"],
  ["rifle_sniper", "weapon", 1, 25, 83, 36, "fabricator", 15, 1, "115 polymer, 80 ingot, 110 paste"],
  ["spyglass", "instrument", 1, 0.5, 7, 2, "hand", 5, 1, "5 wood, 10 hide, 10 fiber, 2 crystal"],
  ["compass", "instrument", 1, 0.5, 8, 5, "hand", 5, 1, "5 ore, 5 flint, 30 fiber"],
  ["magnifying_glass", "instrument", 1, 0.5, 25, 16, "hand", 5, 1, "15 wood, 20 hide, 20 fiber, 30 crystal, 15 obsidian, 8 ingot"],
  ["radio", "instrument", 1, 0.5, 51, 8, "smithy", 5, 1, "40 ingot, 40 crystal, 40 sparkpowder"],
  ["gps", "instrument", 1, 0.5, 52, 21, "fabricator", 5, 1, "5 polymer, 20 electronics"],
  ["fur_hat", "armor", 1, 4, 23, 14, "smithy", 5, 1, "56 pelt, 10 ingot, 7 hide, 3 fiber"],
  ["fur_shirt", "armor", 1, 12, 23, 16, "smithy", 5, 1, "80 pelt, 13 ingot, 10 hide, 4 fiber"],
  ["fur_gloves", "armor", 1, 2, 23, 12, "smithy", 5, 1, "40 pelt, 6 ingot, 5 hide, 2 fiber"],
  ["fur_pants", "armor", 1, 12, 23, 16, "smithy", 5, 1, "96 pelt, 16 ingot, 12 hide, 5 fiber"],
  ["fur_boots", "armor", 1, 4, 23, 12, "smithy", 5, 1, "48 pelt, 8 ingot, 6 hide, 4 fiber"],
  ["ghillie_hat", "armor", 1, 4, 33, 13, "hand", 5, 1, "5 organic_polymer, 7 hide, 3 fiber"],
  ["ghillie_shirt", "armor", 1, 8, 33, 11, "hand", 5, 1, "6 organic_polymer, 10 hide, 4 fiber"],
  ["ghillie_gloves", "armor", 1, 2, 33, 11, "hand", 5, 1, "3 organic_polymer, 5 hide, 2 fiber"],
  ["ghillie_pants", "armor", 1, 8, 33, 11, "hand", 5, 1, "8 organic_polymer, 12 hide, 5 fiber"],
  ["ghillie_boots", "armor", 1, 2, 33, 11, "hand", 5, 1, "4 organic_polymer, 6 hide, 4 fiber"],
  ["riot_hat", "armor", 1, 6, 98, 40, "fabricator", 5, 1, "50 polymer, 25 silica_pearls, 7 hide, 3 fiber, 35 crystal"],
  ["riot_shirt", "armor", 1, 14, 98, 40, "fabricator", 5, 1, "70 polymer, 40 silica_pearls, 10 hide, 4 fiber"],
  ["riot_gloves", "armor", 1, 3, 98, 40, "fabricator", 5, 1, "25 polymer, 15 silica_pearls, 5 hide, 2 fiber"],
  ["riot_pants", "armor", 1, 14, 98, 40, "fabricator", 5, 1, "70 polymer, 40 silica_pearls, 12 hide, 5 fiber"],
  ["riot_boots", "armor", 1, 5, 98, 40, "fabricator", 5, 1, "30 polymer, 18 silica_pearls, 6 hide, 4 fiber"],
  ["scuba_mask", "armor", 1, 0.5, 81, 25, "fabricator", 5, 1, "15 hide, 6 fiber, 10 crystal, 3 silica_pearls"],
  ["scuba_tank", "armor", 1, 20, 81, 35, "fabricator", 5, 1, "20 hide, 8 fiber, 14 ingot, 3 polymer"],
  ["scuba_leggings", "armor", 1, 2, 81, 35, "fabricator", 5, 1, "40 hide, 4 fiber, 2 ingot, 40 polymer"],
  ["scuba_flippers", "armor", 1, 0.5, 81, 20, "fabricator", 5, 1, "12 hide, 5 fiber, 12 chitin, 6 paste, 4 silica_pearls"],
  ["piece_standing_torch", "structure", 3, 4, 7, 6, "hand", 5, 1, "8 thatch, 1 flint, 1 stone, 3 wood"],
  ["piece_cooking_pot", "structure", 100, 4, 8, 9, "hand", 10, 1, "75 stone, 15 thatch, 10 wood, 5 flint"],
  ["piece_fireplace", "structure", 3, 4, 28, 15, "hand", 5, 1, "450 stone, 120 wood, 80 thatch, 20 flint"],
  ["piece_generator", "structure", 100, 5, 49, 24, "fabricator", 5, 1, "25 ingot, 10 electronics"],
  ["piece_refrigerator", "structure", 1, 4, 60, 20, "fabricator", 5, 1, "120 ingot, 15 polymer, 25 crystal, 10 electronics"],
  ["piece_air_conditioner", "structure", 1, 4, 61, 21, "fabricator", 5, 1, "80 ingot, 15 electronics, 5 polymer, 15 crystal"],
  ["piece_grinder", "structure", 1, 4, 64, 45, "fabricator", 5, 1, "3200 ingot, 2000 crystal, 800 paste, 600 oil, 600 polymer"],
  ["piece_forge_industrial", "structure", 1, 50, 80, 90, "fabricator", 5, 1, "2500 ingot, 250 crystal, 600 paste, 400 oil, 400 polymer"],
  ["piece_chemistry_bench", "structure", 1, 4, 82, 65, "fabricator", 5, 1, "250 ingot, 250 paste, 100 sparkpowder, 250 crystal, 250 polymer, 250 electronics"],
  ["piece_cooker_industrial", "structure", 1, 4, 89, 60, "fabricator", 15, 1, "300 polymer, 1800 ingot, 450 paste, 300 oil"],
  ["stimulant", "consumable", 100, 0.1, 11, 6, "mortar", 1, 1, "5 stimberry, 2 sparkpowder"],
  ["water_jar", "consumable", 1, 5, 26, 12, "hand", 5, 1, "7 paste, 5 hide, 2 crystal"],
  ["canteen", "consumable", 1, 2, 54, 24, "fabricator", 5, 1, "10 polymer, 2 hide, 4 paste, 1 ingot"],
];

test("every blocked-out thing is the item ARK has: its stack, weight, level, points, station and recipe", () => {
  expect(BLOCKED_OUT.map((id) => id.slice(5))).toEqual(ROWS.map((r) => r[0]));
  for (const [name, cls, stack, weight, level, cost, at, seconds, count, needs] of ROWS) {
    const d = item(name), e = engram(name);
    const made = d.craft ? [d.craft.at?.slice(5) ?? "hand", d.craft.seconds, d.craft.count ?? 1, d.craft.needs.map((n) => `${n.count} ${n.item.slice(5)}`).join(", ")] : ["", null, null, ""];
    expect([name, d.class, d.stack, d.weight, e?.level ?? null, e?.cost ?? null, ...made]).toEqual([name, cls, stack, weight, level, cost, at, seconds, count, needs]);
    // What it is made of is in the game, what it comes after is an engram the game has, and it has a name to show.
    for (const n of d.craft?.needs ?? []) expect([name, byId.has(n.item)]).toEqual([name, true]);
    for (const r of e?.requires ?? []) expect([name, r, byId.get(r)?.type]).toEqual([name, r, "engram"]);
    expect([name, (d.label ?? name).length > 0, e === undefined || e.label.length > 0]).toEqual([name, true, true]);
  }
  // Fifty-nine: fifty-two of the fifty-four the starter drop book once waited for (the raft is a vehicle that is built
  // on, and the rocket launcher has a model now), four things they are made of, and three that the blocked-out bow and
  // guns fire.
  expect(ROWS.length).toBe(59);
  expect(Object.keys(starterBook().future)).toEqual(["core:raft_assembly"]);
});

test("held items and placed shapes use their declared asset slots", () => {
  const blocked = new Set(BLOCKED_OUT);
  const held = BLOCKED_OUT.map((id) => byId.get(id) as ItemDef).filter((d) => d.weapon);
  for (const d of held) expect(d.weapon!.mesh, d.id).toBe(d.id === "core:prod" ? BLOCKOUT_MESH : d.id);
  // The box is no picture: with it in the pack, no thing that is held as it has an icon drawn, so each keeps its swatch.
  expect(iconSubjects(reg.defs, (mesh) => mesh === BLOCKOUT_MESH).filter((s) => blocked.has(s.owner)).map((s) => s.owner)).toEqual([]);
  // Ten are set down, each a structure of one box, with ARK's health, slots and days to decay.
  const things = BLOCKED_OUT.map((id) => byId.get(id) as ItemDef).filter((d) => d.places);
  const body = (d: ItemDef): StructureDef => byId.get(d.places![0]!) as StructureDef;
  expect(things.map((d) => [d.id.slice(11), body(d).class, body(d).mesh, body(d).hp, body(d).slots ?? 0, body(d).decayDays])).toEqual([
    ["standing_torch", "station", "shape", 500, 8, 4],
    ["cooking_pot", "station", "shape", 500, 12, 16],
    ["fireplace", "station", "shape", 100, 3, 48],
    ["generator", "container", "shape", 1000, 8, 16],
    ["refrigerator", "container", "shape", 1000, 80, 16],
    ["air_conditioner", "station", "shape", 1000, 0, 8],
    ["grinder", "station", "shape", 2500, 120, 16],
    ["forge_industrial", "station", "shape", 27000, 100, 18],
    ["chemistry_bench", "station", "shape", 2500, 100, 16],
    ["cooker_industrial", "station", "shape", 13000, 80, 48],
  ]);
  const hearths = new Set(["core:standing_torch", "core:cooking_pot", "core:fireplace"]);
  for (const d of things) {
    const s = body(d);
    expect(CORE_CONTENT.some((x) => x.type === "item" && x.craft?.at === s.id)).toBe(false);
    expect(s.keeps ?? 1).toBe(1);
    expect(s.lights, s.id).toBe(hearths.has(s.id) ? `${s.id}_lit` : undefined);
    if (s.lights) expect(byId.get(s.lights)).toMatchObject({ lit: true, lights: s.id, half: s.half, cooks: false });
  }
});

test("what they do today: the arms strike and fire by ARK's numbers, the armour is ARK's, and what is eaten and drunk works", () => {
  const w = (name: string) => item(name).weapon!;
  // Struck with: damage, torpor for each point of it, and uses.
  expect(["torch", "pike", "sword", "pick_metal", "hatchet_metal", "sickle", "prod"].map((n) => [n, w(n).kind, w(n).damage, w(n).torpor ?? 0, w(n).uses])).toEqual([
    ["torch", "melee", 10, 0, 40], ["pike", "melee", 50, 0, 267], ["sword", "melee", 90, 0, 233], ["pick_metal", "melee", 32, 0.5, 533], ["hatchet_metal", "melee", 40, 0, 533], ["sickle", "melee", 50, 0, 533], ["prod", "melee", 1, 400, 1],
  ]);
  expect([item("pick_metal").tool, item("hatchet_metal").tool, item("sickle").tool]).toEqual([{ on: "stone", power: 5, uses: 533 }, { on: "wood", power: 5, uses: 533 }, undefined]);
  // Fired: what a shot does (its round's damage times the weapon's power, and its pellets), the magazine, the reload, shots a second, uses.
  const shot = (name: string): (string | number | boolean)[] => {
    const round = item(w(name).ammo![0]!.slice(5)).ammo!;
    return [name, Math.round(round.damage * (w(name).power ?? 1) * 100) / 100, w(name).pellets ?? round.pellets ?? 1, w(name).clip ?? 1, w(name).reload ?? 0, Math.round((1 / (w(name).interval ?? Infinity)) * 100) / 100, w(name).auto === true, w(name).uses];
  };
  expect(["pistol_fabricated", "shotgun_pump", "rifle_assault", "rifle_sniper"].map(shot)).toEqual([
    ["pistol_fabricated", 50, 1, 13, 1.45, 5, false, 2100],
    ["shotgun_pump", 46, 14, 6, 4.3, 0.91, false, 300],
    ["rifle_assault", 47, 1, 40, 2.18, 10, true, 800],
    ["rifle_sniper", 165, 1, 8, 4.24, 3.3, false, 70],
  ]);
  // The compound bow is 1.35 times an arrow: 74.25 with a stone one (ARK shows 75), 175.5 with a metal one, which it alone takes.
  const bow = w("bow_compound");
  expect([bow.kind, bow.power, 130 * bow.power!, bow.ammo!.includes("core:arrow_metal"), item("bow").weapon!.ammo!.includes("core:arrow_metal"), bow.uses]).toEqual(["bow", 1.35, 175.5, true, false, 550]);
  // Every round a blocked-out gun fires is made; the hook and the charge are taken by nothing yet.
  const fired = new Set(CORE_CONTENT.flatMap((d) => (d.type === "item" && d.weapon?.ammo ? d.weapon.ammo : [])));
  expect(["round_advanced", "round_advanced_rifle", "round_advanced_sniper", "arrow_metal", "grappling_hook", "c4"].map((n) => [n, fired.has(`core:${n}`), item(n).craft !== undefined])).toEqual([
    ["round_advanced", true, true], ["round_advanced_rifle", true, true], ["round_advanced_sniper", true, true], ["arrow_metal", true, true], ["grappling_hook", false, true], ["c4", false, true],
  ]);
  // Armour: ARK's rating and durability, drawn as hide is.
  const worn = (name: string) => item(name).wear!;
  expect(["fur_shirt", "ghillie_shirt", "riot_shirt", "scuba_mask", "scuba_tank", "scuba_leggings", "scuba_flippers"].map((n) => [n, worn(n).slot, worn(n).armor, worn(n).uses, worn(n).set])).toEqual([
    ["fur_shirt", "torso", 40, 120, "hide"], ["ghillie_shirt", "torso", 32, 45, "hide"], ["riot_shirt", "torso", 115, 120, "hide"],
    ["scuba_mask", "head", 0, 45, "hide"], ["scuba_tank", "torso", 0, 45, "hide"], ["scuba_leggings", "legs", 5, 50, "hide"], ["scuba_flippers", "feet", 0, 45, "hide"],
  ]);
  // The stimulant wakes and dries, the berry it is made of likewise, and the jar and canteen hold two and three drinks.
  expect([item("stimulant").use, item("stimberry").use, item("stimberry").eat, item("water_jar").use, item("canteen").use]).toEqual([
    { adds: [{ stat: "torpidity", amount: -40 }, { stat: "water", amount: -15 }] },
    { adds: [{ stat: "water", amount: -10 }, { stat: "torpidity", amount: -10 }, { stat: "stamina", amount: 5 }] },
    { food: 1.5 },
    { holds: { water: 200, each: 100 } },
    { holds: { water: 300, each: 100 } },
  ]);
  // The instruments are a class of their own that waits: made, carried, and nothing in the hand yet.
  const row = CLASSES.find((c) => c.id === "item/instrument")!;
  expect([row.status, row.waits, ["spyglass", "compass", "magnifying_glass", "radio", "gps"].map((n) => item(n).class)]).toEqual(["partial", "instruments", Array(5).fill("instrument")]);
});

test("chitin has a source: the trilobite, a box on the beach, and the drop book counts every blocked-out thing", () => {
  const t = byId.get("core:trilobite") as SpeciesDef;
  // ARK's: 160 health and a fifth more a wild level, 450 food, 150 weight, 50 torpidity, no attack to speak of, 4 xp.
  expect([t.mesh, t.temper, t.stats!.health, t.stats!.food![0], t.stats!.weight![0], t.stats!.torpidity![0], t.killXp, t.drag]).toEqual(["box", "flees", [160, 0.2, 0.054], 450, 150, 50, 4, 30]);
  expect(t.drops!.map((d) => [d.item.slice(5), d.weight, d.favoured])).toEqual([["chitin", 6, "wood"], ["meat", 3, "stone"], ["silica_pearls", 0.5, "stone"], ["oil", 0.5, "wood"]]);
  // It is the only body that gives chitin, and the beach's table has it five together.
  const givers = CORE_CONTENT.filter((d): d is SpeciesDef => d.type === "species" && (d.drops ?? []).some((x) => x.item === "core:chitin")).map((d) => d.id);
  const beach = byId.get("core:spawns_beach") as Extract<Def, { type: "spawns" }>;
  expect([givers, beach.entries.find((e) => e.group[0] === "core:trilobite")?.group.length, beach.limits?.find((l) => l.species === "core:trilobite")?.share]).toEqual([["core:trilobite"], 5, 0.15]);
  // The bush gives the stimberry the stimulant is made of.
  const bush = byId.get("core:bush") as Extract<Def, { type: "node" }>;
  expect(bush.yields.some((y) => y.item === "core:stimberry")).toBe(true);
  // Loot may be any of them, and those that are made by hand, at a smithy or a fabricator may be blueprints.
  const catalog = catalogOf(reg);
  for (const id of BLOCKED_OUT) expect([id, catalog.byId.has(id)]).toEqual([id, true]);
});
