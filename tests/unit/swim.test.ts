import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, Body, MF_NO_JUMP, MF_NO_SPRINT, MF_ROOTED, MF_WINDED, MODE_SWIM, MODE_WALK, STAMINA_UNITS, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { flatWorld, provingWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
const NORTH = 0;
const EAST = 49152; // yaw units: facing -X
const WEST = 16384; // facing +X
const DOWN = -12000;
const UP = 12000;

const survivor = (w: TestWorld): MoveParams => w.reg.move[w.kind("core:survivor")]!;

function bodyAt(w: TestWorld, x: number, z: number): Body {
  const b = new Body();
  b.x = x;
  b.z = z;
  b.y = w.hf.heightAt(x, z);
  b.grounded = true;
  return b;
}

test("a body wades in, floats, dives where it looks, surfaces, and walks out", () => {
  const w = provingWorld();
  const p = survivor(w);
  const floatY = PROVING_SEA_LEVEL - p.height * 0.75;
  // Start on the plaza east of the pool and walk toward its centre.
  const b = bodyAt(w, PROVING_POOL.x + 34, PROVING_POOL.z);
  let switches = 0;
  const step = (moveZ: number, yaw: number, pitch: number, buttons = 0): void => {
    const mode = b.mode;
    stepBody(w, b, 0, moveZ, yaw, pitch, buttons, p, TICK_DT);
    if (b.mode !== mode) switches++;
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in solid at ${b.x}, ${b.y}, ${b.z}`);
    // A swimmer never rises above where it floats, unless the bottom itself is higher
    // (a body that has just walked in may still be a ground probe above the slope).
    if (b.mode === MODE_SWIM) expect(b.y).toBeLessThanOrEqual(Math.max(floatY, w.hf.heightAt(b.x, b.z) + 0.03) + 1e-4);
  };

  let ticks = 0;
  while (b.mode === MODE_WALK && ticks++ < 600) step(FWD, EAST, 0);
  expect(b.mode).toBe(MODE_SWIM);
  // It started to swim when the water reached about 70% of its height.
  expect(PROVING_SEA_LEVEL - b.y).toBeGreaterThan(p.height * 0.7);
  expect(PROVING_SEA_LEVEL - b.y).toBeLessThan(p.height * 0.7 + 0.15);
  expect(b.grounded).toBe(false);

  // Level swimming over deep water: at the float line, at swim speed.
  for (let i = 0; i < 150; i++) step(FWD, EAST, 0);
  expect(w.hf.heightAt(b.x, b.z)).toBeLessThan(-4);
  expect(b.y).toBeCloseTo(floatY, 3);
  expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(p.swimSpeed, 3);
  expect(b.vy).toBe(0);

  // Looking down and swimming forward dives to the bottom; letting go stays there (no sinking, no bobbing up).
  for (let i = 0; i < 240; i++) step(FWD, EAST, DOWN);
  expect(b.y).toBeLessThan(-5);
  expect(b.y - w.hf.heightAt(b.x, b.z)).toBeLessThan(0.5);
  for (let i = 0; i < 60; i++) step(0, EAST, DOWN);
  const depth = b.y;
  for (let i = 0; i < 60; i++) step(0, EAST, 0);
  expect(b.y).toBe(depth);
  expect([b.vx, b.vy, b.vz]).toEqual([0, 0, 0]);

  // Jump rises; the surface stops it.
  for (let i = 0; i < 300; i++) step(0, EAST, 0, BTN_JUMP);
  expect(b.y).toBeCloseTo(floatY, 3);
  // Looking up cannot lift a swimmer out of the water.
  for (let i = 0; i < 60; i++) step(FWD, WEST, UP);
  expect(b.y).toBeLessThanOrEqual(floatY + 1e-4);

  // Swim back to the shallows: it stands up and walks at walking speed.
  ticks = 0;
  while (b.mode === MODE_SWIM && ticks++ < 900) step(FWD, WEST, 0);
  expect(b.mode).toBe(MODE_WALK);
  expect(b.grounded).toBe(true);
  for (let i = 0; i < 90; i++) step(FWD, WEST, 0);
  expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(4.2);
  expect(b.y).toBeGreaterThan(PROVING_SEA_LEVEL);
  // In, and out: two changes of mode, with no flapping at the waterline.
  expect(switches).toBe(2);
});

test("sprinting drains stamina, exhaustion ends the sprint until a quarter is back, and jumping has a price", () => {
  const w = flatWorld(8);
  const p = survivor(w);
  const b = bodyAt(w, 20, 20);
  const cap = b.staminaMax * STAMINA_UNITS;
  const speeds: number[] = [];
  let windedAt = -1;
  let recoveredAt = -1;
  for (let i = 0; i < 900; i++) {
    stepBody(w, b, 0, FWD, NORTH, 0, BTN_SPRINT, p, TICK_DT);
    speeds.push(Math.hypot(b.vx, b.vz));
    expect(Number.isInteger(b.stamina)).toBe(true);
    expect(b.stamina).toBeGreaterThanOrEqual(0);
    expect(b.stamina).toBeLessThanOrEqual(cap);
    if (windedAt < 0 && (b.mflags & MF_WINDED) !== 0) windedAt = i;
    if (windedAt >= 0 && recoveredAt < 0 && (b.mflags & MF_WINDED) === 0) recoveredAt = i;
  }
  // 100 points at 5 a second: twenty seconds of sprint.
  expect(windedAt).toBe(Math.ceil(cap / p.staminaSprint) - 1);
  expect(speeds[windedAt - 1]).toBeCloseTo(p.walkSpeed * p.sprintMul, 3);
  // Winded: sprint is held but the body only walks, and recovers a quarter before it can sprint again.
  expect(speeds[windedAt + 30]).toBeCloseTo(p.walkSpeed, 3);
  expect(recoveredAt - windedAt).toBe(Math.ceil(cap / 4 / p.staminaRegen));
  expect(speeds[recoveredAt + 30]).toBeCloseTo(p.walkSpeed * p.sprintMul, 3);

  // A jump costs a fixed amount, and without that much there is no jump.
  const j = bodyAt(w, 40, 40);
  stepBody(w, j, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
  expect(j.grounded).toBe(false);
  expect(j.stamina).toBe(cap - p.staminaJump);
  const tired = bodyAt(w, 60, 60);
  tired.stamina = p.staminaJump - p.staminaRegen - 1;
  stepBody(w, tired, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
  expect(tired.grounded).toBe(true);
  expect(tired.y).toBe(0);
});

test("server-set modifiers change speed and stamina; restrictions stop sprinting, jumping, or moving", () => {
  const w = flatWorld(8);
  const p = survivor(w);
  const run = (set: (b: Body) => void, buttons: number): Body => {
    const b = bodyAt(w, 100, 100);
    set(b);
    for (let i = 0; i < 60; i++) stepBody(w, b, 0, FWD, NORTH, 0, buttons, p, TICK_DT);
    return b;
  };
  expect(Math.hypot(run(() => {}, 0).vz)).toBeCloseTo(p.walkSpeed, 4);
  expect(run((b) => (b.speedQ = 1500), 0).vz).toBeCloseTo(p.walkSpeed * 1.5, 4);
  expect(run((b) => (b.speedQ = 400), 0).vz).toBeCloseTo(p.walkSpeed * 0.4, 4);
  expect(run((b) => (b.mflags = MF_NO_SPRINT), BTN_SPRINT).vz).toBeCloseTo(p.walkSpeed, 4);
  const noJump = run((b) => (b.mflags = MF_NO_JUMP), BTN_JUMP);
  expect(noJump.y).toBe(0);
  expect(noJump.stamina).toBe(100 * STAMINA_UNITS);
  const rooted = run((b) => {
    b.mflags = MF_ROOTED;
    b.y = 3;
    b.grounded = false;
  }, BTN_SPRINT | BTN_JUMP);
  expect([rooted.x, rooted.z]).toEqual([100, 100]); // cannot walk
  expect(rooted.y).toBe(0); // still falls
  // A lowered cap takes the surplus at once.
  const capped = run((b) => (b.staminaMax = 40), 0);
  expect(capped.stamina).toBe(40 * STAMINA_UNITS);
});

test("landing reports how fast the body was falling; landing in water reports nothing", () => {
  const w = provingWorld();
  const p = survivor(w);
  const b = bodyAt(w, 256, 240);
  b.y = 10;
  b.grounded = false;
  let reported = 0;
  let reports = 0;
  for (let i = 0; i < 120; i++) {
    stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
    if (stepOut.landSpeed > 0) {
      reported = stepOut.landSpeed;
      reports++;
    }
  }
  expect(reports).toBe(1);
  expect(b.grounded).toBe(true);
  // v = sqrt(2 g h), within one tick of gravity.
  expect(reported).toBeGreaterThan(Math.sqrt(2 * p.gravity * 10) - p.gravity * TICK_DT);
  expect(reported).toBeLessThan(Math.sqrt(2 * p.gravity * 10) + p.gravity * TICK_DT);

  const diver = bodyAt(w, PROVING_POOL.x, PROVING_POOL.z);
  diver.y = 12;
  diver.grounded = false;
  let deepest = 0;
  for (let i = 0; i < 300; i++) {
    stepBody(w, diver, 0, 0, 0, 0, 0, p, TICK_DT);
    expect(stepOut.landSpeed).toBe(0);
    deepest = Math.min(deepest, diver.y);
  }
  expect(diver.mode).toBe(MODE_SWIM);
  // The water took the speed off: it went under, but came to rest above the bottom.
  expect(deepest).toBeLessThan(PROVING_SEA_LEVEL - 2.5);
  expect([diver.vx, diver.vy, diver.vz]).toEqual([0, 0, 0]);
  expect(diver.y - w.hf.heightAt(diver.x, diver.z)).toBeGreaterThan(0.5);
});

test("fuzz: no input swims a body out of a flooded sealed room, into solid space, or above the water", () => {
  const w = flatWorld(4);
  w.hf.seaLevel = 2.6; // the whole world is under 2.6 m of water; the room's ceiling is at 3
  const p = survivor(w);
  const room = sealedRoom(w, 100, 100);
  const floatY = w.hf.seaLevel - p.height * 0.75;
  for (let seed = 1; seed <= 6; seed++) {
    const rng = new Rng(seed);
    const b = bodyAt(w, 100 + rng.range(-2, 2), 100 + rng.range(-2, 2));
    let moveX = 0;
    let moveZ = 0;
    let yaw = 0;
    let pitch = 0;
    let buttons = 0;
    let swam = 0;
    for (let i = 0; i < 3000; i++) {
      if (rng.int(12) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        pitch = rng.int(32769) - 16384;
        buttons = rng.int(4);
      }
      stepBody(w, b, moveX, moveZ, yaw, pitch, buttons, p, TICK_DT);
      if (b.mode === MODE_SWIM) swam++;
      if (b.x < room.minX - 0.5 || b.x > room.maxX + 0.5 || b.z < room.minZ - 0.5 || b.z > room.maxZ + 0.5) throw new Error(`seed ${seed} escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`seed ${seed} in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      expect(b.y).toBeLessThanOrEqual(floatY + 1e-4);
      expect(b.y).toBeGreaterThanOrEqual(-0.002);
    }
    expect(swam).toBeGreaterThan(2900);
  }
});

test("fuzz: bodies thrown around the proving pool stay in free space through every change of mode", () => {
  const w = provingWorld();
  const p = survivor(w);
  let changes = 0;
  for (let seed = 11; seed <= 16; seed++) {
    const rng = new Rng(seed);
    const b = bodyAt(w, PROVING_POOL.x + rng.range(-30, 30), PROVING_POOL.z + rng.range(-30, 30));
    let moveX = 0;
    let moveZ = FWD;
    let yaw = 0;
    let pitch = 0;
    let buttons = 0;
    for (let i = 0; i < 4000; i++) {
      if (rng.int(25) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        // Mostly back toward the pool, so the waterline is crossed again and again.
        yaw = rng.int(3) === 0 ? rng.int(65536) : Math.round((Math.atan2(PROVING_POOL.x - b.x, PROVING_POOL.z - b.z) / (2 * Math.PI)) * 65536) & 0xffff;
        pitch = rng.int(32769) - 16384;
        buttons = rng.int(4);
      }
      const mode = b.mode;
      stepBody(w, b, moveX, moveZ, yaw, pitch, buttons, p, TICK_DT);
      if (b.mode !== mode) changes++;
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`seed ${seed} in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z} mode ${b.mode}`);
    }
  }
  expect(changes).toBeGreaterThan(12);
});
