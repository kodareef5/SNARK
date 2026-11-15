// Minds for the air (planning/reference/flyers-plan.md, FL3), at ARK's numbers where it has them
// (assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md, sections 2, 4 and 8): wild pteranodons flying about their home,
// landing on open ground and taking off again, fleeing by air, leaving the water and defending their egg; tames that follow
// in the air and on foot, land on the whistle and hover when told to stay.

import { expect, test } from "bun:test";
import { AnimState, CUE_LAND, CUE_TAKEOFF } from "../../shared/anim/pose.ts";
import { CMD_ORDER, CMD_TAKE, ORDER_ALL, ORDER_FOLLOW, ORDER_LAND, ORDER_STAY, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { F_ALIVE, F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { coast, flock, spread, watch, watched } from "../fixtures/flyers.ts";
import { Harness } from "../fixtures/net.ts";

const TICKS = 30;

test("left 20 minutes, 100 wild pteranodons over the proving ground fly and land by turns, aloft 55 to 92% of the time, never inside anything, stuck or in the water", () => {
  const { h } = watched([[96, 96], [416, 96], [96, 416], [416, 416]]);
  const list = flock(h, 100, (rng) => [PROVING_POOL.x + rng.range(-60, 60), PROVING_POOL.z + rng.range(-60, 60)]);
  expect([list.length, h.host.creatures.awakeCount]).toEqual([100, 100]);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  // Each lands every few minutes, stays up no longer than its longest leg and approach, rests no longer than its longest rest,
  // and goes no higher than its highest cruise over the tallest thing there, the obelisk's 90 m.
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61, w.highest < 90 + 40 + 5]).toEqual([true, true, true]);
  h.host.shutdown();
}, 60_000);

test("left 20 minutes, 100 wild pteranodons over a coast of frame towers to 192 m go round and over them and land on the beach and the streets, never inside anything, stuck or in the sea", () => {
  const { h } = watched([[64, 64], [320, 64], [64, 320], [320, 320]], { map: coast() });
  const list = flock(h, 100, (rng) => [110 + rng.range(-10, 30), 192 + rng.range(-100, 100)]);
  expect(list.length).toBe(100);
  const w = watch(h, list, 20 * 60);
  const [low, high] = spread(w.aloft);
  expect([w.inside, w.stuck, w.wet, w.badLandings]).toEqual([0, 0, 0, 0]);
  expect([low >= 0.55, high <= 0.92]).toEqual([true, true]);
  expect(Math.min(...w.landings)).toBeGreaterThanOrEqual(5);
  expect([w.longestUp < 240, w.longestDown <= 61]).toEqual([true, true]);
  // The towers were in their way: they went round them.
  expect(h.host.creatures.mind.turned).toBeGreaterThan(100);
  h.host.shutdown();
}, 60_000);

/** Ada, an admin, on the proving ground's plaza, and a pteranodon put down `ahead` metres north of her. */
function plaza(ahead = 6, god = true) {
  const h = new Harness({}, 1, 30, { dev: true });
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  h.say(s, "tp 256 230");
  h.run(300);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  if (god) h.host.survival.gods.add(me.pid);
  const ents = h.world.ents;
  const her = h.ent(s);
  const e = h.host.spawnCreature("core:pteranodon", ents.x[her]!, ents.z[her]! + ahead, 5);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  const p = h.reg.move[ents.kind[e]!]!;
  const up = (): number => ents.y[e]! - groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius);
  const flat = (): number => Math.hypot(ents.x[e]! - ents.x[her]!, ents.z[e]! - ents.z[her]!);
  const cues = new Set<number>();
  const st = new AnimState();
  /** Runs `ms`, keeping the cues it shows and calling `each` every frame. */
  const run = (ms: number, each?: () => void): void =>
    h.run(ms, () => {
      st.unpack(0, ents.cue[e]!);
      cues.add(st.cue);
      each?.();
    });
  return { h, s, me, ents, her, e, rec, up, flat, cues, run, pilot: h.pilots[0]! };
}

test("struck on the ground, a wild pteranodon takes off at once and flies away sprinting and climbing, spending no stamina", () => {
  const { h, ents, her, e, up, flat, cues, run } = plaza();
  run(1000);
  expect([ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0]).toEqual([MODE_WALK, true]);
  h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
  let stamina = -1;
  let fastest = 0;
  run(1000, () => void (ents.mode[e] === MODE_FLYER && stamina < 0 && (stamina = ents.stamina[e]!)));
  expect([ents.mode[e], cues.has(CUE_TAKEOFF)]).toEqual([MODE_FLYER, true]);
  run(9000, () => void (fastest = Math.max(fastest, Math.hypot(ents.vx[e]!, ents.vz[e]!))));
  // Sprinting at its wild 16.5 m/s, it is far off and well up, and its stamina is as it was when it left the ground.
  expect([fastest > 15, flat() > 100, up() > 15, ents.stamina[e]]).toEqual([true, true, true, stamina]);
  h.host.shutdown();
});

test("a wild pteranodon whose egg is taken turns on the thief and bites her, though it flees from harm", () => {
  const { h, s, me, ents, her, e, run } = plaza(10, false);
  run(1500);
  const egg = h.host.eggs.lay(ents.kind[e]!, 0, ents.x[her]!, ents.y[her]!, ents.z[her]! + 1, 0)!;
  h.run(100);
  const health = h.host.survival.value(me, V_HEALTH);
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  s.command(CMD_TAKE, (w) => w.u32(h.host.records.entOf.get(egg.pid)!));
  run(400);
  expect([codes, h.host.creatures.mind.targetOf(e)]).toEqual([[RESULT_OK], her]);
  run(15000);
  expect([h.host.creatures.mind.bites > 0, h.host.survival.value(me, V_HEALTH) < health]).toEqual([true, true]);
  h.host.shutdown();
});

test("in the sea, put there or dropped there, a wild pteranodon takes off and flies for land, and lands on it", () => {
  const { h } = watched([[150, 192]], { map: coast() });
  const ents = h.world.ents;
  // One put down 80 m out, on the sea floor, whose home is the water; one dropped 10 m over the sea from its beach.
  const put = h.host.spawnCreature("core:pteranodon", 40, 160, 5);
  const [dropped] = flock(h, 1, () => [140, 220]);
  h.run(500);
  ents.setPosition(dropped!, 30, 10, 220);
  ents.mode[dropped!] = MODE_WALK;
  ents.flags[dropped!] = ents.flags[dropped!]! & ~F_GROUNDED;
  const w = watch(h, [put, dropped!], 90);
  // They were in the water a moment, and each set down on dry ground.
  expect([w.wet > 0, w.wet < 2 * TICKS, w.inside, w.badLandings, Math.min(...w.landings) >= 1]).toEqual([true, true, 0, 0, true]);
  h.host.shutdown();
});

test("a wild pteranodon in the air whose chunk goes to sleep is set down unhurt on the ground under it, and a tame is left in the air", () => {
  const { h, s, me, ents, e, rec, up } = plaza();
  const tame = h.host.spawnCreature("core:pteranodon", 270, 236, 5);
  const trec = h.host.records.byPid.get(ents.pid[tame]!)!;
  expect(h.host.taming.give(trec, me, 0.9, "forced")).toBe(true);
  h.run(300);
  for (const f of [e, tame]) {
    ents.mode[f] = MODE_FLYER;
    ents.flags[f] = ents.flags[f]! & ~F_GROUNDED;
    ents.setPosition(f, ents.x[f]!, ents.y[f]! + 30, ents.z[f]!);
  }
  // The tame is told to stay up there.
  s.command(CMD_ORDER, (w) => (w.u32(tame), w.u8(ORDER_STAY)));
  h.run(2000);
  const health = h.host.survival.value(rec, V_HEALTH);
  expect([ents.mode[e], up() > 10]).toEqual([MODE_FLYER, true]);
  // She goes far off, and their chunks sleep.
  h.say(s, "tp 40 470");
  h.run(1000);
  const tameUp = ents.y[tame]! - groundUnder(h.world.hf, ents.x[tame]!, ents.z[tame]!, 0.75);
  expect([(ents.flags[e]! & F_ALIVE) !== 0, h.host.creatures.isChunkAwake(ents.chunk[e]!), ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0, up() < 0.01, h.host.survival.value(rec, V_HEALTH), h.host.creatures.grounded]).toEqual([true, false, MODE_WALK, true, true, health, 1]);
  expect([ents.mode[tame], tameUp > 25]).toEqual([MODE_FLYER, true]);
  // Woken again, it rests a while and takes off.
  const off = h.host.creatures.tookOff;
  h.say(s, "tp 256 230");
  h.run(30000);
  expect(h.host.creatures.tookOff).toBeGreaterThan(off);
  h.host.shutdown();
});

test("a tame follows its owner through the air and on foot and takes wing when she is far; whistled down it lands where it is and stays down; told to stay up, it hovers, spending no stamina", () => {
  const { h, s, me, ents, her, e, rec, flat, cues, run, pilot } = plaza();
  expect(h.host.taming.give(rec, me, 0.9, "forced")).toBe(true);
  // Its stamina fills on the ground first, as a new body's does.
  run(8000);
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const order = (what: number, which = e): void => {
    s.command(CMD_ORDER, (w) => (w.u32(which), w.u8(what)));
    run(300);
  };
  order(ORDER_FOLLOW);
  let stamina = -1;
  const taking = (): void => void (ents.mode[e] === MODE_FLYER && stamina < 0 && (stamina = ents.stamina[e]!));
  const dy = (): number => Math.abs(ents.y[e]! - ents.y[her]!);
  // She flies up and over the plaza: it takes off and keeps behind and near her height.
  h.say(s, "fly");
  pilot.yaw = 0;
  pilot.pitch = 0.6;
  pilot.moveZ = 1;
  run(3000, taking);
  pilot.pitch = 0;
  pilot.moveZ = 0.4;
  pilot.yaw = Math.PI / 2;
  run(10000, taking);
  pilot.moveZ = 0;
  run(4000);
  expect([ents.mode[e], flat() < 14, dy() < 6, ents.y[her]! - groundUnder(h.world.hf, ents.x[her]!, ents.z[her]!, 0.4) > 15, cues.has(CUE_TAKEOFF), ents.stamina[e]]).toEqual([MODE_FLYER, true, true, true, true, stamina]);
  // She comes down and walks: it sets down near her and follows on foot.
  h.say(s, "walk");
  run(4000);
  pilot.yaw = -Math.PI / 2;
  pilot.moveZ = 0.5;
  run(6000);
  pilot.moveZ = 0;
  run(8000);
  expect([ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0, flat() < 10, cues.has(CUE_LAND)]).toEqual([MODE_WALK, true, true, true]);
  // Far from it, it takes wing to catch her up and sets down by her.
  h.say(s, "tp 256 330");
  let flew = false;
  run(30000, () => void (flew ||= ents.mode[e] === MODE_FLYER));
  expect([flew, ents.mode[e], flat() < 10]).toEqual([true, MODE_WALK, true]);
  // She flies up and hovers: it hovers by her. Whistled down, it comes straight down where it is, and stays down while she
  // flies about over it.
  h.say(s, "fly");
  pilot.yaw = 0;
  pilot.pitch = 1.2;
  pilot.moveZ = 0.6;
  run(3000);
  pilot.moveZ = 0;
  run(8000);
  expect(ents.mode[e]).toBe(MODE_FLYER);
  const [x0, z0] = [ents.x[e]!, ents.z[e]!];
  order(ORDER_LAND, ORDER_ALL);
  let down: readonly number[] = [];
  run(5000, () => void (down.length === 0 && ents.mode[e] === MODE_WALK && (down = [ents.x[e]!, ents.z[e]!])));
  // Down, it follows her on foot.
  expect([ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0, Math.hypot(down[0]! - x0, down[1]! - z0) < 0.5]).toEqual([MODE_WALK, true, true]);
  pilot.yaw = Math.PI;
  pilot.moveZ = 0.3;
  flew = false;
  run(6000, () => void (flew ||= ents.mode[e] === MODE_FLYER));
  pilot.moveZ = 0;
  expect(flew).toBe(false);
  // Told to follow, it flies to her again; told to stay, it holds where it is in the air.
  order(ORDER_FOLLOW);
  run(10000);
  expect([ents.mode[e], flat() < 14]).toEqual([MODE_FLYER, true]);
  order(ORDER_STAY);
  run(3000);
  const at = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  const held = ents.stamina[e]!;
  run(20000);
  expect([ents.mode[e], Math.hypot(ents.x[e]! - at[0]!, ents.y[e]! - at[1]!, ents.z[e]! - at[2]!) < 0.5, ents.stamina[e]]).toEqual([MODE_FLYER, true, held]);
  // Every order was taken. Only a flyer is told to land.
  const dodo = h.host.spawnCreature("core:dodo", ents.x[her]! + 2, ents.z[her]!, 1);
  expect(h.host.taming.give(h.host.records.byPid.get(ents.pid[dodo]!)!, me, 0.9, "forced")).toBe(true);
  order(ORDER_LAND, dodo);
  expect([codes.slice(0, -1).every((c) => c === RESULT_OK), codes.at(-1)]).toEqual([true, RESULT_INVALID]);
  h.host.shutdown();
});
