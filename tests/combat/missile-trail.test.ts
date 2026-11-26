// A guided missile's smoke (client/core/missile-trail.ts): one leg while it flies straight, a new one each time its way
// has turned past a few degrees, and its last leg ended when it is gone.

import { expect, test } from "bun:test";
import { LEG_MS, LEG_TURN, MissileTrail, type TrailFire, type TrailSample } from "../../client/core/missile-trail.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), prop = reg.index.get("core:jet_missile_live")!;

/** A fire that writes down what it was asked. */
function fire(): TrailFire & { flown: number[]; ended: number[] } {
  const flown: number[] = [], ended: number[] = [];
  return { flown, ended, fly: (key) => void flown.push(key), at: () => {}, end: (key) => void ended.push(key) };
}

/** One missile at (x, y, z). */
const sample = (x: number, y: number, z: number, kind = prop): TrailSample => ({ count: 1, id: [5], gen: [1], kind: [kind], x: [x], y: [y], z: [z] });

test("a missile flying straight lays one leg, and its end when it is gone", () => {
  const trail = new MissileTrail(), f = fire();
  trail.retable(reg);
  for (let frame = 0; frame < 60; frame++) trail.trace(sample(100, 50, 100 + frame * 4), f, frame * 1000 / 60);
  expect(f.flown.length).toBe(1);
  trail.trace({ count: 0, id: [], gen: [], kind: [], x: [], y: [], z: [] }, f, 1000);
  expect(f.ended).toEqual(f.flown);
});

test("a turning missile starts a new leg once it has turned a few degrees, no oftener than its time", () => {
  const trail = new MissileTrail(), f = fire();
  trail.retable(reg);
  // Turning at 72 degrees a second for a second, at sixty frames.
  let x = 100, z = 100, heading = 0;
  for (let frame = 0; frame <= 60; frame++) {
    heading += (72 * Math.PI / 180) / 60;
    x += Math.sin(heading) * 4; z += Math.cos(heading) * 4;
    trail.trace(sample(x, 50, z), f, frame * 1000 / 60);
  }
  expect(f.flown.length).toBeGreaterThan(3);
  expect(f.flown.length).toBeLessThanOrEqual(1 + 1000 / LEG_MS + 1);
  // Each leg but the one flying was ended as the next began.
  expect(f.ended).toEqual(f.flown.slice(0, -1));
  expect(LEG_TURN).toBeCloseTo(Math.PI / 90, 6);
});

test("a body that is no missile lays no smoke", () => {
  const trail = new MissileTrail(), f = fire();
  trail.retable(reg);
  for (let frame = 0; frame < 10; frame++) trail.trace(sample(0, 0, frame, reg.index.get("core:dodo")!), f, frame * 16);
  expect([f.flown.length, trail.legs]).toEqual([0, 0]);
});
