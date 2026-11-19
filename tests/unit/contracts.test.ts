// The contracts the creature packages build on: in place, and doing nothing yet unless their package has been built.

import { expect, test } from "bun:test";
import { CORE_CONTENT, TAME_XP } from "../../content/core.ts";
import { DODO_EGG, DODO_EGG_FERTILE } from "../../content/creatures/dodo.ts";
import { ANIM_FLYING, AnimState, BANK_STEP, BANK_STEPS, CLIMB_DIVE, CLIMB_DOWN, CLIMB_LEVEL, CLIMB_UP, CUE_BITS, CUE_DEAD, CUE_HELD, CUE_LAND, CUE_NONE, CUE_OUT, CUE_ROLL, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, FLY_SPEED_STEP, LAYER_FLINCH, MATING_STEPS, SPEED_MAX, STAGE_WORST, hurtStage } from "../../shared/anim/pose.ts";
import { RIG_CLIPS } from "../../shared/anim/rigs.ts";
import { FIELDS, classRow, defFaults } from "../../shared/content/classes.ts";
import type { Def, SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { slotsOf } from "../../shared/content/slots.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { BTN_SPRINT, Body, FLIGHT_TICKS_MAX, MODE_FLY, MODE_FLYER, MODE_GHOST, MODE_NONE, MODE_SWIM, MODE_WALK, STANCE_STAND, stepBody } from "../../shared/sim/character.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { HOLD_CARRY } from "../../shared/sim/weapon.ts";
import * as P from "../../shared/net/protocol.ts";
import { DEADLINE_BREED } from "../../server/breeding.ts";
import { DEADLINE_BUFF } from "../../server/buffs.ts";
import { DEADLINE_CAR } from "../../server/car-return.ts";
import { DEADLINE_CORPSE } from "../../server/corpses.ts";
import { DEADLINE_DESPAWN } from "../../server/death.ts";
import { DEADLINE_FECES } from "../../server/feces.ts";
import { DEADLINE_NODE } from "../../server/harvest.ts";
import { DEADLINE_CRAFT } from "../../server/progression.ts";
import { DEADLINE_SPAWN } from "../../server/spawner.ts";
import { DEADLINE_FIRE } from "../../server/stations.ts";
import { DEADLINE_VITALS } from "../../server/survival.ts";
import { DEADLINE_TAME } from "../../server/taming.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

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
  // 14 is the cluster's, 15 the beds', 16 the flyers' (below), 17 the stations wave's (tests/unit/stations-contracts.test.ts),
  // 18 the vehicles' (tests/integration/vehicle-contracts.test.ts), 34 creative mode's (tests/integration/creative.test.ts),
  // 35 the margin told against the tick due and the ticks given up (tests/integration/stalls.test.ts).
  expect([P.CMD_CARRY, P.CMD_TAKE, P.PROTOCOL_VERSION]).toEqual([27, 28, 35]);
  const orders = [P.ORDER_STAY, P.ORDER_FOLLOW, P.ORDER_STANCE, P.ORDER_STANCE + 1, P.ORDER_STANCE + 2, P.ORDER_UNSADDLE, P.ORDER_MATE, P.ORDER_UNMATE, P.ORDER_WANDER, P.ORDER_ATTACK, P.ORDER_YOURS, P.ORDER_LAND];
  expect(new Set(orders).size).toBe(orders.length);
  expect(Math.max(...orders)).toBeLessThan(P.ORDER_LEVEL);
  expect(new Set([P.CARRY_PICK_UP, P.CARRY_DROP, P.CARRY_THROW, P.CARRY_GRAB, P.CARRY_RELEASE]).size).toBe(5);
  const kinds = [DEADLINE_VITALS, DEADLINE_DESPAWN, DEADLINE_NODE, DEADLINE_CRAFT, DEADLINE_BUFF, DEADLINE_FIRE, DEADLINE_TAME, DEADLINE_BREED, DEADLINE_SPAWN, DEADLINE_CORPSE, DEADLINE_FECES, DEADLINE_CAR];
  expect(new Set(kinds).size).toBe(kinds.length);
});

test("the new columns change nothing for content that does not use them", () => {
  for (let i = 1; i < reg.defs.length; i++) {
    const d = reg.defs[i]!;
    // A tame stands on steeper ground than a wild one; past that, its numbers are its species' but for a tamed sprint, on
    // the ground and in the air.
    const sprints = d.type === "species" ? { ...(d.tamedWalkSpeed === undefined ? {} : { walkSpeed: d.tamedWalkSpeed }), ...(d.tamedSwimSpeed === undefined ? {} : { swimSpeed: d.tamedSwimSpeed }), ...(d.tamedSprintMul === undefined ? {} : { sprintMul: d.tamedSprintMul }), ...(d.fly?.tamedSprintMul === undefined ? {} : { flySprintMul: d.fly.tamedSprintMul }) } : {};
    if (d.type === "species") expect({ ...reg.tamedMove[i]!, slopeCos: 0 }).toEqual({ ...reg.move[i]!, slopeCos: 0, ...sprints });
    // The pteranodon is carried as 149 of drag weight by what can lift it, its mass is 190, and its kind takes fright with
    // it within 15 m. A vehicle's mass is its curb mass.
    const dragged = d.type === "species" && d.vehicle ? [0, 0, d.vehicle.spec.mass ?? 1100, 0, 0] : ({ "core:brachio": [0, 1100, 26000, 0, 0], "core:carbonemys": [12, 250, 800, 0, 0], "core:rex": [0, 550, 8300, 0, 0], "core:pteranodon": [15, 149, 190, 0, 0], "core:trike": [22, 300, 6000, 0, 0], "core:spino": [0, 550, 6200, 0, 0], "core:stego": [15, 250, 5000, 0, 0], "core:raptor": [0, 0, 150, 0, 0], "core:parasaur": [0, 0, 900, 0, 0], "core:grazer": [0, 0, 220, 0, 0] } as Record<string, number[]>)[d.id];
    if (d.id !== "core:dodo") expect([reg.alarm[i], reg.drag[i], reg.mass[i], reg.carriable[i], reg.eggChance[i]]).toEqual(dragged ?? [0, 0, 0, 0, 0]);
    expect(reg.drawSize[i]).toBe(1);
    if (!["core:survivor", "core:club", "core:pick"].includes(d.id)) expect(reg.meleeTorpor[i]).toBe(0);
    // Prime meat (content/corpses.ts) is what the young give in place of raw meat.
    if (d.id !== "core:meat") expect(reg.youngItem[i]).toBe(0);
    // Eggs, feces, prime meat and jerky (decomposesin 120, Cooked Meat Jerky, Prime Meat Jerky) lie on the ground for a time;
    // nothing else declares one yet.
    const prime = ["core:meat_prime", "core:meat_prime_cooked", "core:jerky", "core:jerky_prime"].includes(d.id);
    if (!(d.type === "item" && (d.class === "egg" || d.class === "feces")) && !prime) expect(reg.decomposeTicks[i]).toBe(0);
  }
});

test("every species that lays an egg leaves feces, and its egg is an item, fertilised or not", () => {
  const layers = reg.defs.filter((d) => d?.type === "species" && d.breeds?.egg !== undefined).map((d) => d!.id);
  expect(layers.sort()).toEqual(["core:brachio", "core:carbonemys", "core:dodo", "core:parasaur", "core:pteranodon", "core:raptor", "core:rex", "core:spino", "core:stego", "core:trike"]);
  const ids = (col: Uint16Array, i: number): string => (col[i] === 0 ? "" : reg.ids[col[i]!]!);
  expect(layers.map((id) => ids(reg.feces, at(id)))).toEqual(["core:feces_large", "core:feces_medium", "core:feces_small", "core:feces_medium", "core:feces_small", "core:feces_small", "core:feces_large", "core:feces_large", "core:feces_large", "core:feces_medium"]);
  expect(layers.map((id) => [ids(reg.propItem, reg.breedEgg[at(id)]!), ids(reg.propFertile, reg.breedEgg[at(id)]!)])).toEqual([
    ["core:brachio_egg", "core:brachio_egg_fertile"],
    ["core:carbonemys_egg", "core:carbonemys_egg_fertile"],
    ["core:dodo_egg", "core:dodo_egg_fertile"],
    ["core:parasaur_egg", "core:parasaur_egg_fertile"],
    ["core:pteranodon_egg", "core:pteranodon_egg_fertile"],
    ["core:raptor_egg", "core:raptor_egg_fertile"],
    ["core:rex_egg", "core:rex_egg_fertile"],
    ["core:spino_egg", "core:spino_egg_fertile"],
    ["core:stego_egg", "core:stego_egg_fertile"],
    ["core:trike_egg", "core:trike_egg_fertile"],
  ]);
  for (const id of layers) {
    const prop = reg.breedEgg[at(id)]!;
    const item = reg.defs[reg.propItem[prop]!]!;
    const fertile = reg.defs[reg.propFertile[prop]!]!;
    expect(item.type === "item" && (item.eat?.food ?? 0) > 0).toBe(true);
    expect(fertile.type === "item" && (fertile.eat?.food ?? 0) > 0).toBe(true);
    expect(reg.decomposeTicks[reg.propFertile[prop]!]).toBe(0);
  }
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

// The flyers' contracts (planning/reference/flyers-plan.md, FL0): the fields, codes and state FL1 to FL7 build on, each
// read by nothing until its package builds it.

test("the flyers' codes: a creature's own flight is mode 5 of a body's three bits, take-off and the roll are cues, a carry grabs and lets go, and a tame is told to land", () => {
  expect(MODE_FLYER).toBe(5);
  expect(new Set([MODE_NONE, MODE_WALK, MODE_SWIM, MODE_GHOST, MODE_FLY, MODE_FLYER]).size).toBe(6);
  expect(MODE_FLYER).toBeLessThan(8);
  expect([CUE_TAKEOFF, CUE_ROLL]).toEqual([4, 5]);
  expect(new Set([CUE_NONE, CUE_STARTLE, CUE_LAND, CUE_TORPOR, CUE_TAKEOFF, CUE_ROLL]).size).toBe(6);
  expect([P.CARRY_GRAB, P.CARRY_RELEASE, P.ORDER_LAND]).toEqual([3, 4, 11]);
  // Both counters of a body hold 10 bits, more than ARK's 10 s wait and 7 s between rolls.
  expect(FLIGHT_TICKS_MAX).toBe(1023);
  expect(FLIGHT_TICKS_MAX).toBeGreaterThan(Math.max(...reg.move.map((m) => Math.max(m?.regenWaitTicks ?? 0, m?.rollTicks ?? 0))));
  // A flyer carrying in its feet holds as a survivor holding a creature does.
  expect(HOLD_CARRY).toBe(7);
});

test("a body's flight counters travel with it, 20 bits after the rest, and every body today has none", () => {
  const a = new Body();
  a.regenWait = 300;
  a.rollWait = FLIGHT_TICKS_MAX;
  const w = new BitWriter(64);
  P.writeBody(w, a);
  // And after them the vehicles' bit for no vehicle and their bit for no seat: 380 without those.
  // Presence bits cover ground creature counters and Meridian flight state.
  expect(w.pos).toBe(384);
  const b = new Body();
  const r = new BitReader(w.bytes());
  P.readBody(r, b);
  expect([r.overflow, b.regenWait, b.rollWait, b.equals(a)]).toEqual([false, 300, FLIGHT_TICKS_MAX, true]);
  const c = new Body();
  c.copy(a);
  expect([c.regenWait, c.rollWait]).toEqual([300, FLIGHT_TICKS_MAX]);
  c.rollWait = 0;
  expect(c.equals(a)).toBe(false);
  // The entity store keeps them for the server, and stores what the step left.
  const ents = new EntityStore({ chunksX: 1, chunksZ: 1 }, 4);
  const e = ents.create(1, 1, 1, 1, 0);
  ents.storeBody(e, a);
  const back = new Body();
  ents.loadBody(e, back);
  expect([back.regenWait, back.rollWait]).toEqual([300, FLIGHT_TICKS_MAX]);
  expect([new Body().regenWait, new Body().rollWait, ents.regenWait[ents.create(1, 2, 1, 2, 0)], ents.rollWait[1]]).toEqual([0, 0, 0, 0]);
});

test("a flyer's pose packs its speed through the air, its bank and its climb in the motion bits, and every other body packs as it did", () => {
  // Every body that does not fly packs exactly as before: speed, direction, stance, swimming and airborne, the look, the action.
  const st = new AnimState();
  for (let k = 0; k < 2000; k++) {
    st.mode = k % 3 === 0 ? MODE_SWIM : k % 3 === 1 ? MODE_WALK : MODE_FLY;
    st.grounded = k % 5 !== 0;
    st.speed = k % 16;
    st.dir = (k * 7) % 16;
    st.stance = k % 3;
    st.pitch = (k % 63) - 31;
    st.setAction(k % 7, (k >> 3) % 8, k * 13);
    const old = (st.speed | (st.dir << 4) | (st.stance << 8) | (st.mode === MODE_SWIM ? 1 << 10 : 0) | (st.grounded ? 0 : 1 << 11) | ((st.pitch & 63) << 12) | (st.action << 18) | ((st.actionStart & 255) << 24)) >>> 0;
    expect(st.pack()).toBe(old);
    const back = new AnimState();
    back.unpack(old);
    expect([back.mode === MODE_FLYER, back.bank, back.climb, back.stance, back.dir]).toEqual([false, 0, CLIMB_LEVEL, st.stance, st.dir]);
  }
  // In flight: 2 m/s steps to 30, the way it travels against level, and how far it faces to the left of its travel.
  const fly = (vx: number, vy: number, vz: number, yaw: number): AnimState => {
    const f = new AnimState();
    f.mode = MODE_FLYER;
    f.setMotion(vx, vz, yaw, 0.3, vy);
    return f;
  };
  const level = fly(0, 0, 19, 0);
  expect([level.speed * FLY_SPEED_STEP, level.bank, level.climb, level.dir]).toEqual([20, 0, CLIMB_LEVEL, 0]);
  expect([fly(0, 6, 10, 0).climb, fly(0, -4, 10, 0).climb, fly(0, -15, 10, 0).climb, fly(0, 0, 0, 0).climb]).toEqual([CLIMB_UP, CLIMB_DOWN, CLIMB_DIVE, CLIMB_LEVEL]);
  expect(fly(0, 0, 40, 0).speed).toBe(SPEED_MAX);
  // Faced 3 steps to the left of where it goes, as when it turns left; to its right; past the most; and at no speed none.
  expect([fly(0, 0, 10, 3 * BANK_STEP).bank, fly(0, 0, 10, -2 * BANK_STEP).bank, fly(0, 0, 10, 20 * BANK_STEP).bank, fly(0, 0, 0, 1).bank]).toEqual([3, -2, BANK_STEPS, 0]);
  // It goes over the wire and back: flying in the stance bits, never grounded, standing, its look and action kept.
  const turning = fly(0, -4, 10, -5 * BANK_STEP);
  turning.setAction(2, 0, 77);
  const word = turning.pack();
  expect((word >>> 8) & 3).toBe(ANIM_FLYING);
  const back = new AnimState();
  back.unpack(word);
  expect([back.mode, back.grounded, back.stance, back.speed, back.bank, back.climb, back.pitch, back.action, back.actionStart]).toEqual([MODE_FLYER, false, STANCE_STAND, turning.speed, -5, CLIMB_DOWN, turning.pitch, 2, 77]);
  // The entity store poses a flyer with its vertical speed.
  const ents = new EntityStore({ chunksX: 1, chunksZ: 1 }, 4);
  const e = ents.create(1, 10, 50, 10, 0);
  ents.mode[e] = MODE_FLYER;
  ents.vy[e] = -15;
  ents.vz[e] = 10;
  ents.pose(e);
  back.unpack(ents.anim[e]!);
  expect([back.mode, back.climb]).toEqual([MODE_FLYER, CLIMB_DIVE]);
});

test("a flyer's clips are named among a rig's, each once, and asked for of a species that flies; a saddled model of one that has a skeleton", () => {
  const flight = ["take_off", "hover", "fly", "fly_fast", "glide", "dive", "attack_air", "barrel_roll", "grab", "carry", "release", "torpor_fall", "death_air"];
  expect(flight.every((c) => (RIG_CLIPS as readonly string[]).includes(c))).toBe(true);
  expect(new Set(RIG_CLIPS).size).toBe(RIG_CLIPS.length);
  const row = classRow("species/creature")!;
  expect([row.slots.flight!.keys, row.slots.flight!.when, row.slots.saddled!.from, row.slots.saddled!.when, row.slots.saddled!.fallback]).toEqual([flight, "fly", "{mesh}/saddled", "skeleton", ["#body"]]);
  const uses = slotsOf(CORE_CONTENT);
  expect(uses.filter((u) => u.slot === "flight").map((u) => u.owner).every((o) => o === "core:pteranodon")).toBe(true);
  expect(uses.filter((u) => u.slot === "flight").length).toBe(flight.length);
  expect(uses.filter((u) => u.slot === "saddled").map((u) => [u.owner, u.id]).sort()).toEqual([["core:brachio", "core:brachio/saddled"], ["core:carbonemys", "core:carbonemys/saddled"], ["core:dodo", "core:dodo/saddled"], ["core:parasaur", "core:parasaur/saddled"], ["core:pteranodon", "core:pteranodon/saddled"], ["core:raptor", "core:raptor/saddled"], ["core:rex", "core:rex/saddled"], ["core:spino", "core:spino/saddled"], ["core:stego", "core:stego/saddled"], ["core:trike", "core:trike/saddled"]]);
  expect(classRow("item/saddle")!.slots.worn!.from).toBe("{id}/worn");
});

test("flight remains exclusive to the pteranodon while the Stego also defends eggs and has a stamina-priced bite", () => {
  const ptera = at("core:pteranodon");
  const m = reg.move[ptera]!;
  expect([m.flies, m.flySpeed, m.flySprintMul, reg.tamedMove[ptera]!.flySprintMul, m.accelFly, m.flyTurnRate, m.staminaFly, m.staminaFlySprint, m.staminaRoll, m.staminaGrab, m.regenWaitTicks, m.rollBurst, m.rollTicks]).toEqual([true, 6, 2.75, 3.1625, 12, 728, 11, 200, 90000, 40000, 300, 10, 210]);
  const none = { flies: false, flySpeed: 0, flySprintMul: 0, accelFly: 0, flyTurnRate: 0, staminaFly: 0, staminaFlySprint: 0, staminaRoll: 0, staminaGrab: 0, regenWaitTicks: 0, rollBurst: 0, rollTicks: 0 };
  for (let i = 1; i < reg.defs.length; i++) {
    if (i === ptera) continue;
    if (reg.move[i]) expect([reg.ids[i], reg.move[i]!]).toMatchObject([reg.ids[i], none]);
    expect([reg.ids[i], reg.flies[i], reg.grabDrag[i], reg.grabReach[i], reg.defendsEgg[i], reg.riderWeight[i], reg.biteStamina[i], reg.rollDamage[i], reg.missileMul[i], reg.biteStructureMul[i]]).toEqual([reg.ids[i], 0, 0, 0, ["core:stego", "core:carbonemys"].includes(reg.ids[i]!) ? 1 : 0, 1, reg.ids[i] === "core:carbonemys" ? 6000 : ["core:stego", "core:rex", "core:spino", "core:brachio"].includes(reg.ids[i]!) ? 12000 : 0, 0, 1, 1]);
  }
  // ARK's roll does 50 to what it passes, and a rider weighs 0.85 on it (FL2).
  expect([reg.rollDamage[ptera], reg.riderWeight[ptera]]).toEqual([50, Math.fround(0.85)]);
  const def = CORE_CONTENT.find((d) => d.id === "core:pteranodon")! as SpeciesDef;
  const faults = (more: Partial<SpeciesDef>): string[] => compileContent(CORE_CONTENT.map((d): Def => (d === def ? ({ ...def, ...more } as Def) : d))).errors;
  expect(faults({ fly: { ...def.fly!, speed: 0, wait: 40, roll: { burst: -1, every: 0, damage: -1 } } })).toEqual([
    "core:pteranodon: fly.speed must be above 0 and at most 40, got 0",
    "core:pteranodon: fly.wait must be at least 0 and at most 34.1, got 40",
    "core:pteranodon: fly.roll.burst must be at least 0 and at most 40, got -1",
    "core:pteranodon: fly.roll.every must be above 0 and at most 34.1, got 0",
    "core:pteranodon: fly.roll.damage must be at least 0 and at most 1000000, got -1",
  ]);
  expect(faults({ grab: { drag: 0, reach: 5 }, riderWeight: 2, missiles: -1, tameBonus: { luck: [1, 0] } as SpeciesDef["tameBonus"], tamedHealth: 0 })).toEqual([
    "core:pteranodon: grab needs a drag above 0 and a reach above 0 and at most 100 m",
    "core:pteranodon: riderWeight must be from 0 to 1",
    "core:pteranodon: missiles must not be negative",
    "core:pteranodon: tameBonus.luck must name a stat and be [add >= 0, mult >= 0]",
    "core:pteranodon: tamedHealth must be above 0 and at most 10",
  ]);
});

test("the class table holds the flyers' fields as stubs, each waiting for its feature but `fly`, which the step reads, and `defendsEgg`, which the egg rule reads, and only a creature may declare them", () => {
  const s = FIELDS.species;
  expect(["fly", "grab", "defendsEgg", "riderWeight", "missiles", "structures", "tameBonus", "tamedHealth"].map((k) => [k, s[k]!.waits])).toEqual([
    ["fly", undefined], ["grab", "flyers"], ["defendsEgg", undefined], ["riderWeight", undefined], ["missiles", "flyers"], ["structures", "flyers"], ["tameBonus", "tameBonus"], ["tamedHealth", "tameBonus"],
  ]);
  // A ridden bite's stamina is spent (FL2).
  expect(s.bite!.stubs).toBeUndefined();
  const survivor = CORE_CONTENT.find((d) => d.id === "core:survivor")!;
  expect(defFaults({ ...survivor, fly: { speed: 1 } } as Def)).toEqual(['core:survivor: class species/survivor may not declare "fly"']);
});


test("tamed ground and water bases compile independently from wild locomotion and reject invalid authored speeds", () => {
  const base = CORE_CONTENT.find(d => d.id === "core:parasaur") as SpeciesDef;
  const make = (more: Partial<SpeciesDef>) => compileContent(CORE_CONTENT.map(d => d.id === base.id ? { ...base, ...more } : d));
  const changed = make({ tamedWalkSpeed: .765, tamedSwimSpeed: 1.35, tamedSprintMul: 2.104 / .765 });
  expect(changed.errors).toEqual([]);
  const kind = changed.registry!.index.get(base.id)!;
  const wild = changed.registry!.move[kind]!, tame = changed.registry!.tamedMove[kind]!;
  expect(wild).toEqual(reg.move[at(base.id)]!);
  expect([tame.walkSpeed, tame.swimSpeed, tame.walkSpeed * tame.sprintMul]).toEqual([.765, 1.35, 2.104]);
  for (const value of [0, -1, NaN, Infinity, 101]) for (const field of ["tamedWalkSpeed", "tamedSwimSpeed"] as const) {
    expect(make({ [field]: value }).errors.some(e => e.includes(field))).toBe(true);
  }
});

test("a slow walker can sprint above four times its base speed, with bounded finite wild and tame ratios", () => {
  const base = CORE_CONTENT.find(d => d.id === "core:parasaur") as SpeciesDef;
  const make = (more: Partial<SpeciesDef>) => compileContent(CORE_CONTENT.map(d => d.id === base.id ? { ...base, ...more } : d));
  const built = make({ walkSpeed: 1.5, sprintMul: 4.05, tamedWalkSpeed: 1.2, tamedSprintMul: 5.0625 });
  expect(built.errors).toEqual([]);
  const kind = built.registry!.index.get(base.id)!, w = flatWorld(4);
  for (const p of [built.registry!.move[kind]!, built.registry!.tamedMove[kind]!]) {
    const b = new Body(); b.x = b.z = 40; b.grounded = true;
    for (let i = 0; i < 90; i++) stepBody(w, b, 0, 127, 0, 0, BTN_SPRINT, p, TICK_DT);
    expect(b.vz).toBeCloseTo(6.075, 5);
    expect(b.grounded).toBe(true);
  }
  expect(make({ sprintMul: 8, tamedSprintMul: 8 }).errors).toEqual([]);
  for (const field of ["sprintMul", "tamedSprintMul"] as const) for (const value of [0, -.1, 8.001, NaN, Infinity]) {
    expect(make({ [field]: value }).errors.some(e => e.includes(field))).toBe(true);
  }
});
