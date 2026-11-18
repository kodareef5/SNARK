import { expect, test } from "bun:test";
import { GroundBodies } from "../../shared/sim/body-contact.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { flatWorld } from "../fixtures/world.ts";

test("ground capsules sweep through long travel, preserve tangent speed, and can back away", () => {
  const bodies = new GroundBodies(); bodies.add(8, 0, 0, 5, .8, 2);
  bodies.clip(0, 0, 0, 0, 0, 12, .6, 1.8, 0, 20);
  expect(bodies.result.hit).toBe(true);
  expect(bodies.result.z).toBeCloseTo(3.602, 8);
  expect(bodies.result.vz).toBeCloseTo(0, 8);
  bodies.clip(0, 0, bodies.result.z, 0, 0, 0, .6, 1.8, 0, -8);
  expect(bodies.result).toEqual({ x: 0, z: 0, vx: 0, vz: -8, hit: false });
  bodies.clip(0, 0, 3.602, 2, 0, 5, .6, 1.8, 4, 3);
  expect(bodies.result.x).toBeCloseTo(2, 8);
  expect(bodies.result.z).toBeCloseTo(3.602, 8);
  expect(bodies.result.vx).toBeCloseTo(4, 8);
  expect(bodies.result.vz).toBeCloseTo(0, 8);
});

test("initial overlap can escape without a shove, while inward motion cannot deepen it", () => {
  const bodies = new GroundBodies(); bodies.add(8, 0, 0, 0, .8, 2);
  bodies.clip(0, 0, -1, 0, 0, -.2, .6, 1.8, 0, 4);
  expect(bodies.result.z).toBe(-1); expect(bodies.result.vz).toBe(0);
  bodies.clip(0, 0, -1, 0, 0, -2, .6, 1.8, 0, -4);
  expect(bodies.result.z).toBe(-2); expect(bodies.result.vz).toBe(-4);
  bodies.clip(0, 0, 0, 0, 0, -1, .6, 1.8, 0, -4);
  expect(bodies.result.z).toBe(-1); expect(bodies.result.hit).toBe(false);
});

test("vertical capsule ends allow a body above, and corner results are independent of candidate traversal", () => {
  const bodies = new GroundBodies(); bodies.add(8, 0, 0, 5, .8, 2);
  bodies.clip(0, 2.1, 0, 0, 2.1, 12, .6, 1.8, 0, 20);
  expect(bodies.result.z).toBe(12); expect(bodies.result.hit).toBe(false);
  const a = new GroundBodies(), b = new GroundBodies();
  a.add(4, -1, 0, 5, 1, 2); a.add(9, 1, 0, 5, 1, 2);
  b.add(9, 1, 0, 5, 1, 2); b.add(4, -1, 0, 5, 1, 2);
  a.clip(0, 0, 0, 0, 0, 10, .6, 1.8, 0, 20);
  b.clip(0, 0, 0, 0, 0, 10, .6, 1.8, 0, 20);
  expect(a.result).toEqual(b.result);
  expect(a.result.z).toBeLessThan(4);
  expect(Math.hypot(a.result.vx, a.result.vz)).toBeLessThanOrEqual(20);
});

test("a crowded candidate list never drops the nearest blocker because of insertion order", () => {
  const first = new GroundBodies(), last = new GroundBodies();
  first.add(1, 0, 0, 3, .8, 2);
  for (let i = 0; i < 3000; i++) {
    first.add(i + 2, 1 + i % 50, 0, 10 + i % 30, .5, 2);
    last.add(i + 2, 1 + i % 50, 0, 10 + i % 30, .5, 2);
  }
  last.add(1, 0, 0, 3, .8, 2);
  for (const bodies of [first, last]) bodies.clip(0, 0, 0, 0, 0, 15, .6, 1.8, 0, 20);
  expect(first.result).toEqual(last.result); expect(first.result.z).toBeCloseTo(1.602, 8);
});

test("glancing around a body beside a thin wall rechecks static space and still allows escape", () => {
  const w = flatWorld(), p = w.reg.move[w.kind("core:survivor")]!, body = new Body();
  body.x = 63.6; body.y = 0; body.z = 60; body.grounded = true;
  for (let z = 57; z <= 69; z += 3) w.structs.add(w.kind("core:wall"), 65, 1.5, z, 16384, 0, 1);
  const bodies = new GroundBodies(); bodies.add(1, 64, 0, 64, .8, 2);
  let minimum = Infinity;
  for (let i = 0; i < 150; i++) {
    stepBody(w, body, -80, 127, 0, 0, 0, p, TICK_DT, bodies);
    expect(capsuleFree(w, body.x, body.y, body.z, p.radius, p.height)).toBe(true);
    minimum = Math.min(minimum, Math.hypot(body.x - 64, body.z - 64));
    expect(body.x).toBeLessThan(64.51);
  }
  expect(minimum).toBeGreaterThanOrEqual(p.radius + .8 - .003);
  const x = body.x, z = body.z;
  for (let i = 0; i < 60; i++) stepBody(w, body, 80, -127, 0, 0, 0, p, TICK_DT, bodies);
  expect(Math.hypot(body.x - x, body.z - z)).toBeGreaterThan(3);
});
