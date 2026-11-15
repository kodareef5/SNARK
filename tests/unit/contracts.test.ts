// The contracts the creature packages build on: in place, and doing nothing yet unless their package has been built.

import { expect, test } from "bun:test";
import { CORE_CONTENT, TAME_XP } from "../../content/core.ts";
import { DODO_EGG, DODO_EGG_FERTILE } from "../../content/creatures/dodo.ts";
import { AnimState, CUE_BITS, CUE_DEAD, CUE_HELD, CUE_OUT, CUE_TORPOR, LAYER_FLINCH, MATING_STEPS, STAGE_WORST, hurtStage } from "../../shared/anim/pose.ts";
import { defFaults } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import * as P from "../../shared/net/protocol.ts";
import { DEADLINE_BREED } from "../../server/breeding.ts";
import { DEADLINE_BUFF } from "../../server/buffs.ts";
import { DEADLINE_CORPSE } from "../../server/corpses.ts";
import { DEADLINE_DESPAWN } from "../../server/death.ts";
import { DEADLINE_FECES } from "../../server/feces.ts";
import { DEADLINE_NODE } from "../../server/harvest.ts";
import { DEADLINE_CRAFT } from "../../server/progression.ts";
import { DEADLINE_SPAWN } from "../../server/spawner.ts";
import { DEADLINE_FIRE } from "../../server/stations.ts";
import { DEADLINE_VITALS } from "../../server/survival.ts";
import { DEADLINE_TAME } from "../../server/taming.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const at = (id: string): number => reg.index.get(id)!;

test("the cue word keeps a knock-out where it was, and carries held, dead, hurt, decay and mating beside it", () => {
  const st = new AnimState();
  st.out = true;
  st.cue = CUE_TORPOR;
  st.cueStart = 200;
  st.layer = LAYER_FLINCH;
  st.layerStart = 17;
  const before = st.packCue();
  expect(before).toBe(CUE_OUT | (CUE_TORPOR << 1) | (200 << 4) | (LAYER_FLINCH << 12) | (17 << 14));
  Object.assign(st, { held: true, dead: true, hurt: STAGE_WORST, decay: 2, mating: MATING_STEPS });
  const word = st.packCue();
  expect(word & (CUE_HELD | CUE_DEAD)).toBe(CUE_HELD | CUE_DEAD);
  expect(word < 2 ** CUE_BITS && (word & ((1 << 22) - 1)) === before).toBe(true);
  const back = new AnimState();
  back.unpackCue(word);
  expect([back.out, back.cue, back.cueStart, back.layer, back.layerStart, back.held, back.dead, back.hurt, back.decay, back.mating]).toEqual([true, CUE_TORPOR, 200, LAYER_FLINCH, 17, true, true, STAGE_WORST, 2, MATING_STEPS]);
});

test("a hurt stage is a quarter of health wide, and never more than a glance shows", () => {
  expect([100, 76, 75, 74, 50, 49, 25, 24, 0].map((h) => hurtStage(h, 100))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
  expect(hurtStage(5, 0)).toBe(0);
});

test("the new codes are each one of their kind, and deadlines have kinds of their own", () => {
  const ops = Object.entries(P).filter(([k]) => k.startsWith("CMD_")).map(([, v]) => v);
  expect(new Set(ops).size).toBe(ops.length);
  // 14 is the cluster's, 15 the beds', 16 the flyers' (below).
  expect([P.CMD_CARRY, P.CMD_TAKE, P.PROTOCOL_VERSION]).toEqual([27, 28, 16]);
  const orders = [P.ORDER_STAY, P.ORDER_FOLLOW, P.ORDER_STANCE, P.ORDER_STANCE + 1, P.ORDER_STANCE + 2, P.ORDER_UNSADDLE, P.ORDER_MATE, P.ORDER_UNMATE, P.ORDER_WANDER, P.ORDER_ATTACK, P.ORDER_YOURS, P.ORDER_LAND];
  expect(new Set(orders).size).toBe(orders.length);
  expect(Math.max(...orders)).toBeLessThan(P.ORDER_LEVEL);
  expect(new Set([P.CARRY_PICK_UP, P.CARRY_DROP, P.CARRY_THROW, P.CARRY_GRAB, P.CARRY_RELEASE]).size).toBe(5);
  const kinds = [DEADLINE_VITALS, DEADLINE_DESPAWN, DEADLINE_NODE, DEADLINE_CRAFT, DEADLINE_BUFF, DEADLINE_FIRE, DEADLINE_TAME, DEADLINE_BREED, DEADLINE_SPAWN, DEADLINE_CORPSE, DEADLINE_FECES];
  expect(new Set(kinds).size).toBe(kinds.length);
});

test("the new columns change nothing for content that does not use them", () => {
  for (let i = 1; i < reg.defs.length; i++) {
    const d = reg.defs[i]!;
    // A tame stands on steeper ground than a wild one; past that, its numbers are its species' but for a tamed sprint, on
    // the ground and in the air.
    const sprints = d.type === "species" ? { ...(d.tamedSprintMul === undefined ? {} : { sprintMul: d.tamedSprintMul }), ...(d.fly?.tamedSprintMul === undefined ? {} : { flySprintMul: d.fly.tamedSprintMul }) } : {};
    if (d.type === "species") expect({ ...reg.tamedMove[i]!, slopeCos: 0 }).toEqual({ ...reg.move[i]!, slopeCos: 0, ...sprints });
    // The pteranodon is carried as 149 of drag weight by what can lift it, and its mass is 190.
    const dragged = ({ "core:pteranodon": [0, 149, 190, 0, 0] } as Record<string, number[]>)[d.id];
    if (d.id !== "core:dodo") expect([reg.alarm[i], reg.drag[i], reg.mass[i], reg.carriable[i], reg.eggChance[i]]).toEqual(dragged ?? [0, 0, 0, 0, 0]);
    expect(reg.drawSize[i]).toBe(1);
    if (!["core:survivor", "core:club", "core:pick"].includes(d.id)) expect(reg.meleeTorpor[i]).toBe(0);
    // Prime meat (content/corpses.ts) is what the young give in place of raw meat.
    if (d.id !== "core:meat") expect(reg.youngItem[i]).toBe(0);
    // Eggs, feces and prime meat lie on the ground for a time; nothing else declares one yet.
    const prime = d.id === "core:meat_prime" || d.id === "core:meat_prime_cooked";
    if (!(d.type === "item" && (d.class === "egg" || d.class === "feces")) && !prime) expect(reg.decomposeTicks[i]).toBe(0);
  }
});

test("every species that lays an egg leaves feces, and its egg is an item, fertilised or not", () => {
  const layers = reg.defs.filter((d) => d?.type === "species" && d.breeds?.egg !== undefined).map((d) => d!.id);
  expect(layers.sort()).toEqual(["core:dodo", "core:parasaur", "core:pteranodon", "core:raptor"]);
  const ids = (col: Uint16Array, i: number): string => (col[i] === 0 ? "" : reg.ids[col[i]!]!);
  expect(layers.map((id) => ids(reg.feces, at(id)))).toEqual(["core:feces_small", "core:feces_medium", "core:feces_small", "core:feces_small"]);
  expect(layers.map((id) => [ids(reg.propItem, reg.breedEgg[at(id)]!), ids(reg.propFertile, reg.breedEgg[at(id)]!)])).toEqual([
    ["core:dodo_egg", "core:dodo_egg_fertile"],
    ["core:parasaur_egg", "core:parasaur_egg_fertile"],
    ["core:pteranodon_egg", "core:pteranodon_egg_fertile"],
    ["core:raptor_egg", "core:raptor_egg_fertile"],
  ]);
  // Only an egg prop names items, and only a species leaves feces.
  for (let i = 1; i < reg.defs.length; i++) {
    const d = reg.defs[i]!;
    if (!(d.type === "prop" && d.class === "egg")) expect([reg.propItem[i], reg.propFertile[i]]).toEqual([0, 0]);
    if (!layers.includes(d.id)) expect(reg.feces[i]).toBe(0);
  }
  // A fertilised egg is one of a kind.
  const egg = CORE_CONTENT.find((d) => d.id === "core:egg_dodo")!;
  expect(compileContent(CORE_CONTENT.map((d): Def => (d === egg ? { ...egg, fertile: "core:dodo_egg" } as Def : d))).errors).toEqual(["core:egg_dodo: its fertile item must stack to 1"]);
});

test("prime meat from the young: an item given in place of another, and only one for each", () => {
  expect(reg.youngItem[at("core:meat")]).toBe(at("core:meat_prime"));
  const prime: Def = { type: "item", class: "consumable", id: "test:prime", stack: 40, eat: { food: 50 }, youngFor: "core:meat" };
  expect(compileContent([...CORE_CONTENT, prime]).errors).toEqual(['test:prime: core:meat_prime is already given in place of "core:meat"']);
});

test("the dodo's numbers: runs at 95.55 units a second tamed, weighs 25 to a carrier, may be carried, lays in place of 13% of its feces, and its egg is the extra small one, 11 cm tall", () => {
  const dodo = at("core:dodo");
  expect(reg.move[dodo]!.walkSpeed * reg.tamedMove[dodo]!.sprintMul).toBeCloseTo(0.9555, 6);
  expect(reg.move[dodo]!.walkSpeed * reg.move[dodo]!.sprintMul).toBeCloseTo(1.365, 6);
  expect({ ...reg.tamedMove[dodo]!, sprintMul: 0, slopeCos: 0 }).toEqual({ ...reg.move[dodo]!, sprintMul: 0, slopeCos: 0 });
  expect([reg.alarm[dodo], reg.drag[dodo], reg.mass[dodo], reg.carriable[dodo], reg.eggChance[dodo]]).toEqual([15, 25, 50, 1, Math.fround(0.13)]);
  const egg = at("core:egg_dodo");
  expect([(reg.defs[egg] as Extract<Def, { type: "prop" }>).mesh, reg.drawSize[egg]]).toEqual(["core:egg_xs", 1]);
  expect([reg.bodyRadius[egg], reg.bodyHeight[egg]].map((v) => Math.round(v! * 100) / 100)).toEqual([0.04, 0.11]);
});

test("the dodo's egg items are joined, and the tames' 88 levels are ready to be", () => {
  expect([defFaults(DODO_EGG), defFaults(DODO_EGG_FERTILE)]).toEqual([[], []]);
  const r = reg;
  const item = r.index.get(DODO_EGG.id)!;
  const fertile = r.index.get(DODO_EGG_FERTILE.id)!;
  expect([r.propItem[r.index.get("core:egg_dodo")!], r.propFertile[r.index.get("core:egg_dodo")!]]).toEqual([item, fertile]);
  // Eight days and thirty minutes, real time.
  expect([r.spoilTicks[item]! / GAME_HOUR_TICKS * 140, r.decomposeTicks[item]! / GAME_HOUR_TICKS * 140].map(Math.round)).toEqual([8 * 86400, 1800]);
  expect([r.stack[item], r.weight[item]]).toEqual([100, 3]);
  // Fertilised, one of a kind that spoils as slowly, and lies until it hatches.
  expect([r.stack[fertile], r.weight[fertile], r.spoilTicks[fertile], r.decomposeTicks[fertile]]).toEqual([1, 3, r.spoilTicks[item], 0]);

  expect(TAME_XP.length).toBe(89);
  expect(TAME_XP[88]).toBe(22213960);
  const levels = CORE_CONTENT.find((d) => d.type === "levels")!;
  expect(compileContent(CORE_CONTENT.map((d): Def => (d === levels ? { ...levels, tame: { xp: TAME_XP } } as Def : d))).errors).toEqual([]);
});

test("a feces item, and melee and fist torpor, compile where named, and are checked", () => {
  const dodo = CORE_CONTENT.find((d) => d.id === "core:dodo")!;
  const survivor = CORE_CONTENT.find((d) => d.id === "core:survivor")!;
  const pick = CORE_CONTENT.find((d) => d.id === "core:pick")!;
  const dung: Def = { type: "item", class: "feces", id: "test:dung", stack: 100 };
  const swap = (pairs: [Def, Def][]): Def[] => [...CORE_CONTENT.map((d) => pairs.find(([from]) => from === d)?.[1] ?? d), dung];
  const pickWeapon = (pick as Extract<Def, { type: "item" }>).weapon!;
  const made = compileContent(swap([
    [dodo, { ...dodo, feces: "test:dung" } as Def],
    [survivor, { ...survivor, fistsTorpor: 1.5 } as Def],
    [pick, { ...pick, weapon: { ...pickWeapon, torpor: 2 } } as Def],
  ]));
  expect(made.errors).toEqual([]);
  const r = made.registry!;
  expect([r.feces[r.index.get("core:dodo")!], r.meleeTorpor[r.index.get("core:survivor")!], r.meleeTorpor[r.index.get("core:pick")!]]).toEqual([r.index.get("test:dung")!, 1.5, 2]);
  expect(compileContent(swap([[dodo, { ...dodo, feces: "core:thatch", eggChance: 2, alarm: -1 } as Def]])).errors).toEqual([
    "core:dodo: alarm must be in (0, 1000], got -1",
    "core:dodo: eggChance must be from 0 to 1",
    'core:dodo: "core:thatch" is not an item/feces',
  ]);
});
