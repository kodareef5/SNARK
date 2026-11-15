import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_PRONE, BTN_SPRINT, Body, MODE_FLY, MODE_GHOST, MODE_SWIM, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceEye, stanceHeight, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree } from "../../shared/world/collide.ts";
import { SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0 } from "../../shared/world/proving.ts";
import { flatWorld, provingWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
const NORTH = 0; // yaw 0 faces +Z

function survivor(w: TestWorld): MoveParams {
  return w.reg.move[w.kind("core:survivor")]!;
}

function bodyAt(w: TestWorld, x: number, z: number): Body {
  const b = new Body();
  b.x = x;
  b.z = z;
  b.y = w.hf.heightAt(x, z);
  b.grounded = true;
  return b;
}

function run(w: TestWorld, b: Body, ticks: number, moveX: number, moveZ: number, yaw: number, buttons = 0): void {
  const p = survivor(w);
  for (let i = 0; i < ticks; i++) stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
}

test("walks forward at walk speed and strafes to its right", () => {
  const w = flatWorld();
  const b = bodyAt(w, 64, 20);
  run(w, b, 60, 0, FWD, NORTH);
  expect(b.z - 20).toBeGreaterThan(8.5);
  expect(b.z - 20).toBeLessThan(9.01);
  expect(b.x).toBe(64);
  expect(b.y).toBe(0);
  expect(b.grounded).toBe(true);
  run(w, b, 30, FWD, 0, NORTH);
  expect(b.x).toBeLessThan(62); // facing +Z, right is -X
});

test("stops at a wall and rests against it", () => {
  const w = flatWorld();
  w.structs.add(w.kind("core:wall"), 64, 1.5, 30, 0, 0, 1);
  const b = bodyAt(w, 64, 20);
  run(w, b, 200, 0, FWD, NORTH, BTN_SPRINT);
  const face = 30 - 0.1 - 0.4;
  expect(b.z).toBeLessThanOrEqual(face + SKIN);
  expect(b.z).toBeGreaterThan(face - 0.01);
});

test("jump reaches the expected height and lands", () => {
  const w = flatWorld();
  const b = bodyAt(w, 64, 64);
  let apex = 0;
  const p = survivor(w);
  for (let i = 0; i < 60; i++) {
    stepBody(w, b, 0, 0, 0, 0, i === 0 ? BTN_JUMP : 0, p, TICK_DT);
    apex = Math.max(apex, b.y);
  }
  expect(apex).toBeGreaterThan(1.05); // v^2 / 2g = 1.225 m, less the discrete step
  expect(apex).toBeLessThan(1.23);
  expect(b.y).toBeCloseTo(0, 5);
  expect(b.grounded).toBe(true);
});

test("jumps onto a 1 m ledge and stands on it steadily", () => {
  const w = flatWorld();
  w.structs.add(w.kind("core:slab"), 64, 0.75, 27, 0, 0, 1); // top at 1 m, near face at z = 23
  const b = bodyAt(w, 64, 20);
  const p = survivor(w);
  run(w, b, 22, 0, FWD, NORTH);
  expect(b.z).toBeLessThan(22.61); // too tall to step onto
  for (let i = 0; i < 30; i++) stepBody(w, b, 0, FWD, NORTH, 0, i === 0 ? BTN_JUMP : 0, p, TICK_DT);
  let groundedTicks = 0;
  for (let i = 0; i < 90; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, 0, p, TICK_DT);
    if (b.grounded) groundedTicks++;
    expect(Math.abs(b.y - 1)).toBeLessThan(0.021);
  }
  expect(groundedTicks).toBe(90);
  stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect(b.vy).toBeGreaterThan(5); // can jump again from the ledge
});

test("climbs walkable slopes and is stopped by steep ones", () => {
  const w = provingWorld();
  const climb = (strip: number): Body => {
    const b = bodyAt(w, SLOPE_X0 + SLOPE_WIDTH * strip + 4, SLOPE_Z0 - 3);
    run(w, b, 150, 0, FWD, NORTH, BTN_SPRINT);
    return b;
  };
  for (const strip of [0, 1, 2, 3]) {
    // Strips 0 to 3 are 10 to 40 degrees.
    const b = climb(strip);
    expect(b.z).toBeGreaterThan(SLOPE_Z0 + 20);
    expect(b.y).toBeGreaterThan(3);
    expect(Math.abs(b.y - w.hf.heightAt(b.x, b.z))).toBeLessThan(0.03);
  }
  const steep = climb(5); // Strip 5 is 60 degrees.
  expect(steep.z).toBeLessThan(SLOPE_Z0 + 1);
  expect(steep.y).toBeLessThan(1.5);
});

test("walks up the staircase onto the slab", () => {
  const w = provingWorld();
  const b = bodyAt(w, 263, 273);
  run(w, b, 150, 0, FWD, NORTH);
  expect(b.y).toBeGreaterThan(3.55);
  expect(b.y).toBeLessThan(3.65);
  expect(b.grounded).toBe(true);
});

test("fuzz: no input sequence leaves a sealed room or enters solid space", () => {
  const w = flatWorld();
  const room = sealedRoom(w, 64, 64);
  const p = survivor(w);
  const rng = new Rng(2026);
  const b = bodyAt(w, 64, 64);
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let buttons = 0;
  for (let i = 0; i < 30000; i++) {
    if (rng.int(12) === 0) {
      // Out of range on purpose. A hostile client is not limited to the UI.
      moveX = rng.int(513) - 256;
      moveZ = rng.int(513) - 256;
      yaw = rng.int(65536);
      // Every button, the stance ones included. Getting up and down must not open a way out.
      buttons = rng.int(1024);
    }
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    const height = stanceHeight(p, b.stance);
    const inside = b.x > room.minX && b.x < room.maxX && b.z > room.minZ && b.z < room.maxZ && b.y >= -SKIN && b.y + height < room.maxY + SKIN;
    if (!inside || !capsuleFree(w, b.x, b.y, b.z, p.radius, height)) {
      throw new Error(`escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
    }
  }
});

test("fuzz: bodies roaming the proving ground are always in free space", () => {
  const w = provingWorld();
  const p = survivor(w);
  const spawns: [number, number][] = [[256, 240], [239, 268], [285, 280], [263, 274], [252, 305], [248, 260], [220, 286], [300, 258]];
  // Several seeds, because one found a body a micrometre past the tolerance on a 40 degree slope.
  for (const seed of [77, 78, 79, 80]) {
  const rng = new Rng(seed);
  for (const [sx, sz] of spawns) {
    const b = bodyAt(w, sx, sz);
    expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
    let moveX = 0;
    let moveZ = FWD;
    let yaw = rng.int(65536);
    let buttons = 0;
    for (let i = 0; i < 4000; i++) {
      if (rng.int(20) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = rng.int(4) | (rng.int(5) === 0 ? BTN_CROUCH : 0) | (rng.int(9) === 0 ? BTN_PRONE : 0);
      }
      const px = b.x;
      const pz = b.z;
      stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) throw new Error(`in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      // Sprint speed is 7.2 m/s, 0.24 m per tick. Nothing may move a body faster horizontally.
      expect(Math.hypot(b.x - px, b.z - pz)).toBeLessThan(0.3);
    }
  }
  }
});

test("the 0.2 m wall cannot be crossed from any angle", () => {
  const w = provingWorld();
  const p = survivor(w);
  const rng = new Rng(404);
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = bodyAt(w, rng.range(279, 298), rng.range(256, 260));
    const yaw = (rng.int(12000) - 6000) & 0xffff; // roughly northward
    for (let i = 0; i < 120; i++) {
      stepBody(w, b, rng.int(255) - 127, FWD, yaw, 0, BTN_SPRINT | (rng.int(3) === 0 ? BTN_JUMP : 0), p, TICK_DT);
      // The wall spans x 276 to 300. Going round either end is legal. Being level with it between them is not.
      if (b.x > 276 && b.x < 300) expect(b.z).toBeLessThan(261.5 + SKIN);
    }
  }
});

test("crouching and lying prone shorten the body and slow it; it rises only where there is room", () => {
  const w = flatWorld();
  const p = survivor(w);
  expect([stanceHeight(p, STANCE_STAND), stanceHeight(p, STANCE_CROUCH), stanceHeight(p, STANCE_PRONE)].map((v) => +v.toFixed(3))).toEqual([1.8, 1.2, 0.8]);
  expect(stanceEye(p, STANCE_STAND)).toBe(1.62);
  expect(stanceEye(p, STANCE_CROUCH)).toBeCloseTo(1.08, 5);
  expect(stanceEye(p, STANCE_PRONE)).toBeCloseTo(0.36, 5);

  // The ceiling's underside is 1.4 m up, too low to stand under and high enough to crouch.
  const ceiling = w.kind("core:ceiling");
  w.structs.add(ceiling, 64, 1.5, 30, 0, 0, 1);
  const b = bodyAt(w, 64, 24);
  run(w, b, 120, 0, FWD, NORTH);
  expect(b.z).toBeLessThan(28.2); // standing, it is stopped at the edge
  const z0 = b.z;
  run(w, b, 30, 0, FWD, NORTH, BTN_CROUCH);
  expect(b.stance).toBe(STANCE_CROUCH);
  // Half the walking speed, 2.25 m in a second, give or take the step it was held short by.
  expect(b.z - z0).toBeGreaterThan(2.0);
  expect(b.z - z0).toBeLessThan(2.4);
  // Under the ceiling it stays crouched with the key released, and jumping and sprinting do nothing more.
  run(w, b, 10, 0, 0, NORTH, BTN_CROUCH);
  expect(b.z).toBeGreaterThan(28.6);
  expect(b.z).toBeLessThan(31.4);
  run(w, b, 20, 0, 0, NORTH);
  expect(b.stance).toBe(STANCE_CROUCH);
  run(w, b, 5, 0, 0, NORTH, BTN_JUMP | BTN_CROUCH);
  expect(b.y).toBe(0);
  const z1 = b.z;
  run(w, b, 10, 0, FWD, NORTH, BTN_CROUCH | BTN_SPRINT);
  expect(b.z - z1).toBeLessThan(0.76);
  run(w, b, 200, 0, FWD, NORTH);
  expect(b.z).toBeGreaterThan(32);
  expect(b.stance).toBe(STANCE_STAND);

  // The first ceiling is 1.0 m up, so only prone fits. The second is 1.4 m up.
  w.structs.add(ceiling, 80, 1.1, 30, 0, 0, 1);
  w.structs.add(ceiling, 80, 1.5, 33, 0, 0, 1);
  const c = bodyAt(w, 80, 27.5);
  run(w, c, 60, 0, FWD, NORTH, BTN_CROUCH);
  expect(c.z).toBeLessThan(28.2);
  const z2 = c.z;
  run(w, c, 60, 0, FWD, NORTH, BTN_PRONE);
  expect(c.stance).toBe(STANCE_PRONE);
  // A fifth of the walking speed is 0.9 m/s, so 1.8 m in two seconds.
  expect(c.z - z2).toBeGreaterThan(1.6);
  expect(c.z - z2).toBeLessThan(1.95);
  run(w, c, 30, 0, 0, NORTH);
  expect(c.stance).toBe(STANCE_PRONE);
  run(w, c, 110, 0, FWD, NORTH, BTN_PRONE);
  expect(c.z).toBeGreaterThan(32.2);
  expect(c.z).toBeLessThan(33.8);
  run(w, c, 2, 0, 0, NORTH);
  expect(c.stance).toBe(STANCE_CROUCH);
  run(w, c, 200, 0, FWD, NORTH);
  expect(c.stance).toBe(STANCE_STAND);

  // Going down is immediate, even in the air. A swimmer has no stance.
  const d = bodyAt(w, 100, 100);
  stepBody(w, d, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  stepBody(w, d, 0, 0, NORTH, 0, BTN_PRONE, p, TICK_DT);
  expect(d.stance).toBe(STANCE_PRONE);
  expect(d.y).toBeGreaterThan(0.2);
  const pool = provingWorld();
  const e = bodyAt(pool, 178, 256);
  e.y = -4;
  e.mode = MODE_SWIM;
  e.grounded = false;
  e.stance = STANCE_CROUCH;
  stepBody(pool, e, 0, 0, NORTH, 0, BTN_PRONE, survivor(pool), TICK_DT);
  expect(e.mode).toBe(MODE_SWIM);
  expect(e.stance).toBe(STANCE_STAND);
});

test("a body with a turn rate comes round to where it is asked to look at that rate, by the short way, and goes where it faces", () => {
  const w = flatWorld();
  // 90 degrees a second, rounded to whole yaw units per tick as the registry does.
  const rate = Math.round(65536 / 4 / 30);
  const p: MoveParams = { ...survivor(w), turnRate: rate, strafe: false };
  const b = bodyAt(w, 64, 64);
  const step = (ticks: number, moveX: number, moveZ: number, yaw: number): void => {
    for (let i = 0; i < ticks; i++) stepBody(w, b, moveX, moveZ, yaw, 0, 0, p, TICK_DT);
  };
  step(1, 0, 0, 16384);
  expect(b.yaw).toBe(rate);
  step(14, 0, 0, 16384);
  expect(b.yaw).toBe(rate * 15);
  step(30, 0, 0, 16384);
  expect(b.yaw).toBe(16384);
  step(3, 0, 0, 65536 - 10000);
  expect(b.yaw).toBe(16384 - rate * 3);
  b.yaw = 100;
  step(1, 0, 0, 65436);
  expect(b.yaw).toBe(65436);
  b.yaw = 0;
  step(30, 127, 0, 0);
  expect([b.x, b.z]).toEqual([64, 64]);
  step(1, 0, FWD, 30000);
  expect(b.vz).toBeGreaterThan(0);
  expect(b.yaw).toBe(rate);
  // A survivor has no turn rate and faces where it looks at once. So does any body in ghost mode.
  const s = bodyAt(w, 64, 64);
  stepBody(w, s, 0, 0, 40000, 0, 0, survivor(w), TICK_DT);
  expect(s.yaw).toBe(40000);
  expect(survivor(w).turnRate).toBe(0);
  expect(survivor(w).strafe).toBe(true);
  b.mode = MODE_GHOST;
  step(1, 0, 0, 50000);
  expect(b.yaw).toBe(50000);
});

test("a ghost or a flyer holding sprint starts at five times its speed, gains 150 m/s a second to 600 and no more, and lets go back to 12 at once", () => {
  const w = flatWorld(16);
  const p = survivor(w);
  for (const mode of [MODE_GHOST, MODE_FLY]) {
    const b = bodyAt(w, 512, 512);
    b.y = 40;
    b.mode = mode;
    const speed = (): number => Math.hypot(b.vx, b.vy, b.vz);
    const speeds: number[] = [];
    // Round and round, level, with nothing in the way: turning keeps the speed.
    for (let t = 0; t < 150; t++) {
      stepBody(w, b, 0, FWD, (t * 512) & 0xffff, 0, BTN_SPRINT, p, TICK_DT);
      speeds.push(speed());
    }
    expect(speeds[0]).toBeCloseTo(60, 3);
    expect(speeds[30]).toBeCloseTo(60 + 150, 2);
    expect(speeds.findIndex((v) => v > 599.99)).toBe(108);
    expect(Math.max(...speeds)).toBeLessThan(600.001);
    // Rising as it goes is no faster.
    stepBody(w, b, 0, FWD, 0, 0, BTN_SPRINT | BTN_JUMP, p, TICK_DT);
    expect(speed()).toBeLessThan(600.001);
    stepBody(w, b, 0, FWD, 0, 0, 0, p, TICK_DT);
    expect(speed()).toBeCloseTo(12, 4);
    // Stopping, it starts again from five times its speed.
    stepBody(w, b, 0, 0, 0, 0, BTN_SPRINT, p, TICK_DT);
    stepBody(w, b, 0, FWD, 0, 0, BTN_SPRINT, p, TICK_DT);
    expect([mode, speed()]).toEqual([mode, expect.closeTo(60, 3)]);
  }
});
