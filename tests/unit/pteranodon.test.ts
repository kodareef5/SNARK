// The pteranodon against the ARK wiki (ark.wiki.gg), read on 2026-11-15: its Pteranodon page, the page's taming
// table, its items' pages and the spawn data (assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md).

import { expect, test } from "bun:test";
import { DOOR_WIDTH } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { PTERANODON_EGG, PTERANODON_EGG_FERTILE } from "../../content/creatures/pteranodon.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Lists } from "../../server/settings/lists.ts";
import { spawnTables } from "../../server/settings/spawns.ts";
import { torporDrain, torporMax } from "../../server/survival.ts";
import { defFaults } from "../../shared/content/classes.ts";
import type { Def, SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { STAMINA_UNITS } from "../../shared/sim/character.ts";
import { Genome, statValue } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { narcoticsNeeded, piecesNeeded, proneHunger, tameSeconds } from "../../shared/sim/taming.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const kind = reg.index.get("core:pteranodon")!;
const ptera = reg.defs[kind] as SpeciesDef;
const def = (id: string): Def => CORE_CONTENT.find((d) => d.id === id && d.type !== "rename")!;

/** A wild one of a level, its points all in health: torpor counts every wild level alike. */
function wild(level: number): Genome {
  const g = new Genome();
  g.wild[0] = level - 1;
  return g;
}

test("a pteranodon is ARK's at level 1: health 210, stamina 150, oxygen 150, food 1,200, weight 120, torpor 120, a bite of 18, and no speed levels", () => {
  const stats = ptera.stats!;
  const names = ["health", "stamina", "oxygen", "food", "weight", "melee", "speed", "torpidity"] as const;
  expect(names.map((s) => stats[s]![0])).toEqual([210, 150, 150, 1200, 120, 1, 1, 120]);
  // A wild level adds 42 health, 7.5 stamina, 15 oxygen, 120 food, 2.4 kilograms, 5% to its bite and 7.2 torpor.
  const g = new Genome();
  g.wild.fill(1);
  const gain = (name: (typeof names)[number], stat: number): number => Math.round((statValue(stats[name]!, g, stat) - stats[name]![0]) * 1000) / 1000;
  expect([gain("health", 0), gain("stamina", 1), gain("oxygen", 2), gain("food", 3), gain("weight", 5), gain("melee", 6)]).toEqual([42, 7.5, 15, 120, 2.4, 0.05]);
  expect(torporMax(ptera, wild(2)) - torporMax(ptera, wild(1))).toBeCloseTo(7.2, 9);
  // Flyers have no speed levels, wild or tamed (ASE 256.0).
  expect([stats.speed![1], stats.speed![2]]).toEqual([0, 0]);
  // A tame's gains are the raw ones times ARK's defaults: health 0.15 x 0.2 and melee 0.075 x 0.17.
  expect([stats.health![2], stats.melee![2]]).toEqual([0.03, 0.01275]);
  // Its bite: 18 every 0.67 s for 5 stamina; its head takes three times; 12 experience a kill at level 1.
  expect([reg.damage[kind], reg.weapon[kind]!.swingTicks, reg.biteStamina[kind], reg.zoneMul[kind]![1], ptera.killXp]).toEqual([18, 20, 5 * STAMINA_UNITS, 3, 12]);
});

test("it walks at 260 units a second with no run, swims at 300, flies at 600 and sprints at 1,650 wild and 1,897.5 tamed", () => {
  const move = reg.move[kind]!;
  const tamed = reg.tamedMove[kind]!;
  expect([move.walkSpeed, move.sprintMul, move.swimSpeed, move.flySpeed]).toEqual([2.6, 1, 3, 6]);
  expect([move.flySpeed * move.flySprintMul, Math.round(tamed.flySpeed * tamed.flySprintMul * 1000) / 1000]).toEqual([16.5, 18.975]);
  // Its ground sprint is a walk, so it costs nothing; a walk costs 0.025 a second, a unit a tick.
  expect([move.staminaSprint, move.staminaWalk]).toEqual([0, 1]);
  // It stands on what any creature does: ARK's walkable angle, wild and tamed (D483).
  expect([move.slopeCos, tamed.slopeCos]).toEqual([0.71, 0.6]);
});

test("its stamina in the air: 150 lasts about 450 s flying and 25 s sprinting, none comes back for 10 s, a roll costs 90 every 7 s and a grab 40", () => {
  const move = reg.move[kind]!;
  const full = 150 * STAMINA_UNITS;
  // 0.325 a second is 10.8 units a tick, counted as 11: 0.33 a second, so 455 s where ARK's page gives 462.
  expect(move.staminaFly).toBe(11);
  expect(Math.round(full / move.staminaFly / TICK_RATE)).toBe(455);
  expect([full / move.staminaFlySprint / TICK_RATE, move.regenWaitTicks / TICK_RATE, move.staminaRoll / STAMINA_UNITS, move.rollTicks / TICK_RATE, move.staminaGrab / STAMINA_UNITS]).toEqual([25, 10, 90, 7, 40]);
  // It lifts 50 of drag weight within 5 m below it: a dodo (25) and a survivor's 35, not a raptor's 85.
  expect([reg.grabDrag[kind], reg.grabReach[kind], reg.drag[reg.index.get("core:dodo")!]]).toEqual([50, 5, 25]);
});

test("the wiki's taming table on raw meat and raw prime meat, from level 1 to 150: pieces, seconds, narcoberries and narcotics", () => {
  const p = ptera.taming!;
  // Knocked out it loses a third of a food a second, so a raw meat goes down every 150 s.
  expect(proneHunger(p)).toBeCloseTo(0.333333, 5);
  const table = (item: string) => {
    const food = ptera.eats!.find((f) => f.item === item)!;
    return [1, 30, 60, 90, 120, 150].map((level) => {
      const pieces = piecesNeeded(p, level, food.affinity, 1);
      const seconds = tameSeconds(p, pieces, food.food);
      const g = wild(level);
      const most = torporMax(ptera, g);
      const drain = torporDrain(ptera, g);
      return [level, pieces, seconds, narcoticsNeeded(most, drain, seconds, 7.5, 3), narcoticsNeeded(most, drain, seconds, 40, 8)];
    });
  };
  // The wiki counts each time a second longer: 17:31 for 1,050 s. Its raw meat column is this to the berry.
  expect(table("core:meat")).toEqual([
    [1, 7, 1050, 24, 5],
    [30, 15, 2250, 89, 19],
    [60, 24, 3600, 191, 40],
    [90, 33, 4950, 318, 68],
    [120, 42, 6300, 467, 102],
    [150, 51, 7650, 635, 140],
  ]);
  // Raw prime meat, but the wiki gives one narcoberry more at levels 30 and 60 (6 and 26).
  expect(table("core:meat_prime")).toEqual([
    [1, 3, 450, 2, 1],
    [30, 5, 750, 5, 2],
    [60, 8, 1200, 25, 6],
    [90, 11, 1650, 55, 12],
    [120, 14, 2100, 93, 20],
    [150, 17, 2550, 137, 30],
  ]);
  // Of ARK's foods those that exist, best first: Regular Kibble and raw mutton wait for their items.
  expect(ptera.eats!.map((f) => [f.item, f.food, f.affinity])).toEqual([
    ["core:meat_prime", 50, 150],
    ["core:meat_prime_cooked", 49.945, 75],
    ["core:meat", 50, 50],
    ["core:meat_cooked", 25, 25],
  ]);
});

test("its torpor wears off at the wiki's rate a second, and at level 1 it sleeps 6:40", () => {
  const rows = [1, 30, 60, 90, 120, 150].map((level) => Math.ceil(torporDrain(ptera, wild(level)) * 100 - 1e-9) / 100);
  expect(rows).toEqual([0.3, 0.5, 0.66, 0.79, 0.92, 1.04]);
  expect(torporMax(ptera, wild(1)) / torporDrain(ptera, wild(1))).toBeCloseTo(400, 9);
});

test("its small egg hatches in 5,999.52 s and the young grows up in 133,333.33; the egg is ARK's Pteranodon Egg, fertilised or not", () => {
  expect([reg.ids[reg.breedEgg[kind]!], reg.incubateTicks[kind], reg.matureTicks[kind]]).toEqual(["core:egg_pteranodon", Math.round(5999.52 * TICK_RATE), Math.round(133333.33 * TICK_RATE)]);
  expect([defFaults(PTERANODON_EGG), defFaults(PTERANODON_EGG_FERTILE)]).toEqual([[], []]);
  const item = reg.index.get(PTERANODON_EGG.id)!;
  const fertile = reg.index.get(PTERANODON_EGG_FERTILE.id)!;
  // Eight hours and thirty minutes, real time: weight 7, 35 food and 35 health eaten.
  expect([reg.spoilTicks[item]! / GAME_HOUR_TICKS * 140, reg.decomposeTicks[item]! / GAME_HOUR_TICKS * 140].map(Math.round)).toEqual([8 * 3600, 1800]);
  expect([reg.stack[item], reg.weight[item], PTERANODON_EGG.eat]).toEqual([100, 7, { food: 35, health: 35 }]);
  expect([reg.stack[fertile], reg.decomposeTicks[fertile], (def("core:egg_pteranodon") as Extract<Def, { type: "prop" }>).mesh]).toEqual([1, 0, "core:egg_s"]);
});

test("its saddle is ARK's: armour 25, weight 20, learned at 38 for 15 points, made in 10 s from 230 hide, 125 fiber and 75 chitin", () => {
  const saddle = reg.index.get("core:saddle_pteranodon")!;
  expect([reg.saddleFits[saddle], reg.saddleArmor[saddle], reg.weight[saddle], reg.stack[saddle]]).toEqual([kind, 25, 20, 1]);
  const recipe = reg.recipeOf[saddle]!;
  expect([...recipe].map((v, i) => (i % 2 === 0 ? reg.ids[v] : v))).toEqual(["core:hide", 230, "core:fiber", 125, "core:chitin", 75]);
  expect(def("core:saddle_pteranodon")).toMatchObject({ craft: { seconds: 10, xp: 43 } });
  expect(def("core:engram-saddle_pteranodon")).toMatchObject({ level: 38, cost: 15, item: "core:saddle_pteranodon" });
});

test("its beach entry is ARK's Ptero (1-2), weight 0.15, one certain and one at a half 2.5 m either side, at most a quarter of the beach, drawn now that it flies", () => {
  const beach = def("core:spawns_beach") as Extract<Def, { type: "spawns" }>;
  expect(beach.entries.find((e) => e.group.includes("core:pteranodon"))).toEqual({ name: "Ptero (1-2)", weight: 0.15, group: ["core:pteranodon", "core:pteranodon"], chances: [1, 0.5], offsets: [[0, 2.5], [0, -2.5]] });
  expect(beach.limits!.find((l) => l.species === "core:pteranodon")).toEqual({ species: "core:pteranodon", share: 0.25 });
  const { rules } = loadConfig({});
  const drawn = spawnTables(reg, rules, new Lists(rules, reg)).tables.get(reg.index.get("core:spawns_beach")!)!;
  expect([drawn.entries.length, drawn.entries[2]!.weight, drawn.limits.get(kind)]).toEqual([3, 0.15, 0.25]);
  // An entry or limit that waits for a feature is left out of the table until its package takes the wait away, as this one
  // waited for flight until FL3 of planning/reference/flyers-plan.md.
  const waiting = (w: { group?: readonly string[]; species?: string }) => w.group?.includes("core:pteranodon") || w.species === "core:pteranodon";
  const held = compileContent(CORE_CONTENT.map((d): Def => (d === beach ? { ...beach, entries: beach.entries.map((e) => (waiting(e) ? { ...e, waits: "flyers" as const } : e)), limits: beach.limits!.map((l) => (waiting(l) ? { ...l, waits: "flyers" as const } : l)) } : d))).registry!;
  const left = spawnTables(held, rules, new Lists(rules, held)).tables.get(held.index.get("core:spawns_beach")!)!;
  expect([left.entries.some((e) => e.kinds.includes(kind)), left.limits.has(kind), left.entries.length]).toEqual([false, false, 2]);
  // A wait names a feature.
  expect(compileContent(CORE_CONTENT.map((d): Def => (d === beach ? ({ ...beach, entries: [{ ...beach.entries[0]!, waits: "wings" }] } as unknown as Def) : d))).errors).toEqual(['core:spawns_beach: "wings" is not a feature an entry or limit may wait for']);
});

test("drawn on its own art, too wide for a doorway, flying from harm with its kind, and its other numbers", () => {
  expect([ptera.mesh, ptera.skeleton, ptera.tag, ptera.temper, ptera.alarm]).toEqual(["core:pteranodon", "pteranodon", "pteranodon", "flees", 15]);
  expect(2 * ptera.radius).toBeGreaterThan(DOOR_WIDTH);
  // As tall as it crouches, to the crest's top, with the eye where the model has it.
  expect([ptera.height, ptera.eyeHeight]).toEqual([2.06, 1.48]);
  // Six regions under ARK's names, the concept's colours first.
  expect(ptera.regions!.map((r) => r!.name)).toEqual(["Patterning", "Wing Base", "Face, Crest and Hands", "Inner Crest", "Wing Membrane", "Body"]);
  // Its egg rule, a rider's weight, missiles, its blows on structures, and carried as 149 of drag weight; its mass is 190.
  expect([reg.defendsEgg[kind], reg.riderWeight[kind], reg.missileMul[kind], reg.biteStructureMul[kind], reg.drag[kind], reg.mass[kind], reg.carriable[kind]]).toEqual([1, Math.fround(0.85), 1.5, Math.fround(0.4), 149, 190, 0]);
  // ARK's taming bonuses and a tame's base health of 0.9, for the package that builds them.
  expect([ptera.tameBonus, ptera.tamedHealth]).toEqual([{ health: [0.5, 0], food: [0, 0.15], melee: [0.65, 0.4], speed: [0.35, 0], torpidity: [0.5, 0] }, 0.9]);
});
