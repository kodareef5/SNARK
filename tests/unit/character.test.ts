import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, Body, stepBody, type MoveParams } from "../../shared/sim/character.ts";
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
    // 10 to 40 degrees: still on the strip, well up it, feet on the surface.
    const b = climb(strip);
    expect(b.z).toBeGreaterThan(SLOPE_Z0 + 20);
    expect(b.y).toBeGreaterThan(3);
    expect(Math.abs(b.y - w.hf.heightAt(b.x, b.z))).toBeLessThan(0.03);
  }
  const steep = climb(5); // 60 degrees: held at the foot
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
      // Out-of-range values on purpose: a hostile client is not limited to the UI.
      moveX = rng.int(513) - 256;
      moveZ = rng.int(513) - 256;
      yaw = rng.int(65536);
      buttons = rng.int(4);
    }
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    const inside = b.x > room.minX && b.x < room.maxX && b.z > room.minZ && b.z < room.maxZ && b.y >= -SKIN && b.y + p.height < room.maxY + SKIN;
    if (!inside || !capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) {
      throw new Error(`escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
    }
  }
});

test("fuzz: bodies roaming the proving ground are always in free space", () => {
  const w = provingWorld();
  const p = survivor(w);
  const spawns: [number, number][] = [[256, 240], [239, 268], [285, 280], [263, 274], [252, 305], [248, 260], [220, 286], [300, 258]];
  // Several seeds: one found a body a micrometre past the tolerance on a 40 degree slope.
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
        buttons = rng.int(4);
      }
      const px = b.x;
      const pz = b.z;
      stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      // Sprint speed is 7.2 m/s: 0.24 m per tick. Nothing may move a body faster sideways.
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
      // The wall spans x 276..300. Rounding either end is legal; being level with it between them is not.
      if (b.x > 276 && b.x < 300) expect(b.z).toBeLessThan(261.5 + SKIN);
    }
  }
});
