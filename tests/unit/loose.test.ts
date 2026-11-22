// A thing thrown (shared/sim/loose.ts) tumbles, strikes a wall, falls and comes to rest on the floor outside the wall, in
// a few seconds and the same every time, from every side.
import { expect, test } from "bun:test";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { LooseBody, looseShape } from "../../shared/sim/loose.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const wall = reg.index.get("core:wall")!;

/** Flat ground at y 0 and, if asked, a stone wall 3 m tall and 20 cm thick standing at (64, 64), turned `yaw`. */
function world(yaw = -1) {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  if (yaw >= 0) structs.add(wall, 64, 1.5, 64, yaw, 0, 1);
  return { hf, structs };
}

/** Throws `weight` at the wall's middle from 4 m off along `heading` radians, and steps it until it rests or 6 s pass. */
function throwAt(heading: number, weight: number) {
  // The wall faces the thrower: its long side square to the throw. Its yaw is in 65536ths of a turn.
  const w = world(Math.round((heading / (2 * Math.PI)) * 65536) & 0xffff);
  const dx = Math.sin(heading), dz = Math.cos(heading);
  const body = new LooseBody(looseShape(weight));
  body.throw(64 - dx * 4, 1.5, 64 - dz * 4, dx, 0.05, dz, 14, 0, 0, 0, 14);
  let ticks = 0;
  let lowest = Infinity;
  while (ticks < 180 && body.step(w)) {
    ticks++;
    lowest = Math.min(lowest, body.y);
  }
  // How far it is on the thrower's side of the wall's face: the wall's half thickness is 0.1.
  const front = -((body.x - 64) * dx + (body.z - 64) * dz) - 0.1;
  return { body, ticks, front, lowest };
}

test("a knife and a pistol thrown at a wall from eight sides bounce back and rest on the floor in front of it", () => {
  for (const weight of [1, 5, 12]) {
    for (let k = 0; k < 8; k++) {
      const { body, ticks, front } = throwAt((k / 8) * 2 * Math.PI, weight);
      // At rest, within three seconds.
      expect(ticks).toBeLessThan(90);
      expect(body.awake).toBe(false);
      // On the floor, lying: its middle about its radius up.
      expect(body.y).toBeGreaterThan(body.shape.radius * 0.5);
      expect(body.y).toBeLessThan(body.shape.radius * 2 + 0.02);
      // Never through the wall: on the thrower's side, clear of the face by its radius at least.
      expect(front).toBeGreaterThan(body.shape.radius * 0.9);
    }
  }
});

test("a thing thrown in the open flies, lands, slides and stops", () => {
  const w = world();
  const body = new LooseBody(looseShape(5));
  body.throw(64, 1.5, 40, 0, 0.3, 1, 10, 0, 0, 0, 10);
  let ticks = 0;
  while (ticks < 300 && body.step(w)) ticks++;
  expect(body.awake).toBe(false);
  // It went forward some metres, and lies on the ground.
  expect(body.z - 40).toBeGreaterThan(4);
  expect(body.z - 40).toBeLessThan(20);
  expect(body.y).toBeLessThan(body.shape.radius * 2 + 0.02);
});

test("the same throw comes to rest in the same place, to the bit", () => {
  const a = throwAt(0.7, 5), b = throwAt(0.7, 5);
  expect(a.ticks).toBe(b.ticks);
  expect(a.body.x).toBe(b.body.x);
  expect(a.body.y).toBe(b.body.y);
  expect(a.body.z).toBe(b.body.z);
});
