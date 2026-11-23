// The walls a walker meets (stepOut.wallNx and the rest, shared/sim/character.ts), and a long body's footprint held clear
// of walls as its head is (MoveParams.endRadius): it slides along a wall, turns by a corner without swinging an end in,
// turns the long way round when the short way is shut, and is never thrown out of a wall it was put in.
import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, endDepth, headDepth, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const SKIN = 0.002;

function world(): TestWorld {
  return flatWorld(4);
}

/** Two storeys of wall pieces, 6 m tall, from (x0, z) to (x1, z) across +Z, or along +Z at x = x0 from z to x1 with `along`. */
function wall(w: TestWorld, x0: number, x1: number, z: number, along = false, low = false): void {
  const kind = w.kind("core:wall");
  for (let a = x0 + 1.5; a < x1; a += 3) {
    for (const y of low ? [0.7] : [1.5, 4.5]) w.structs.add(kind, along ? z : a, y, along ? a : z, along ? 16384 : 0, 0, 1);
  }
}

function body(w: TestWorld, name: string, x: number, z: number, yaw = 0): { b: Body; p: MoveParams } {
  const b = new Body();
  b.kind = w.kind(`core:${name}`);
  b.x = x; b.z = z; b.yaw = yaw; b.grounded = true;
  return { b, p: w.reg.move[b.kind]! };
}

/** The deepest any end of the footprint, or the head, is in a wall. */
function deepest(w: TestWorld, p: MoveParams, b: Body): number[] {
  return [headDepth(w, p, b.x, b.y, b.z, b.yaw), endDepth(w, p, b.x, b.y, b.z, b.yaw, true), endDepth(w, p, b.x, b.y, b.z, b.yaw, false)];
}

test("a survivor and a rex walking into a wall report its way out, how fast they press and how high; nothing in the open", () => {
  for (const [name, at] of [["survivor", (p: MoveParams) => p.height / 2], ["rex", (p: MoveParams) => p.headUp!]] as const) {
    const w = world();
    wall(w, 110, 146, 140);
    const { b, p } = body(w, name, 128, 128);
    let met = -1;
    for (let t = 0; t < 300; t++) {
      stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
      if (stepOut.wallInto > 0 && met < 0) met = t;
    }
    expect(met).toBeGreaterThan(0);
    // Its way out is back along -Z, it presses at its walking speed, and it touches at its side's middle, or its head.
    expect(stepOut.wallNx).toBeCloseTo(0, 6);
    expect(stepOut.wallNz).toBeCloseTo(-1, 6);
    expect(stepOut.wallInto).toBeCloseTo(p.walkSpeed, 4);
    expect(stepOut.wallY).toBeCloseTo(at(p), 4);

    const open = world();
    const o = body(open, name, 128, 128);
    for (let t = 0; t < 60; t++) {
      stepBody(open, o.b, 0, 127, 0, 0, 0, o.p, TICK_DT);
      expect([stepOut.wallNx, stepOut.wallNz, stepOut.wallInto, stepOut.wallY]).toEqual([0, 0, 0, 0]);
    }
  }
});

test("a rex walking at a low wall under its head slides along it at any angle, its footprint never deeper", () => {
  for (const degrees of [10, 20, 35, 60]) for (const side of [1, -1]) {
    const w = world();
    // Its top 2.2 m up: under the rex's head, so its footprint's front end is what meets it.
    wall(w, 80, 140, 128 + side * 6, true, true);
    const yaw = Math.round(((side * degrees) / 360) * 65536) & 0xffff;
    const { b, p } = body(w, "rex", 128, 92, yaw);
    let worst = 0, pressed = 0;
    for (let t = 0; t < 300; t++) {
      stepBody(w, b, 0, 127, yaw, 0, 0, p, TICK_DT);
      worst = Math.max(worst, ...deepest(w, p, b));
      if (stepOut.wallInto > 0) pressed++;
    }
    expect([degrees, side, worst]).toEqual([degrees, side, 0]);
    expect(pressed).toBeGreaterThan(0);
    // Ten seconds at its walk, the share of it along the wall: it slid on, and did not stick where it met it.
    const along = 2.8 * 10 * Math.cos((degrees * Math.PI) / 180);
    expect(b.z - 92).toBeGreaterThan(along * 0.8);
  }
});

test("a rex turning beside a corner does not swing its footprint into either wall", () => {
  const w = world();
  // Walls along x = 140 and z = 140, meeting at their corner; the rex stands 2 m from the first, facing along it.
  wall(w, 116, 140, 140);
  wall(w, 116, 140, 140, true);
  const { b, p } = body(w, "rex", 137.9, 132, 0);
  const start = deepest(w, p, b);
  // Facing -X its back end would be through the wall at x = 140.
  expect(endDepth(w, p, b.x, b.y, b.z, 49152, false)).toBeGreaterThan(0.2);
  const yaws: number[] = [];
  for (let t = 0; t < 240; t++) {
    stepBody(w, b, 0, 0, 49152, 0, 0, p, TICK_DT);
    deepest(w, p, b).forEach((d, k) => expect(d).toBeLessThanOrEqual(start[k]! + SKIN));
    yaws.push(b.yaw);
  }
  // It turned as far as its ends let it, and then held still there.
  expect(yaws[0]).not.toBe(0);
  expect(new Set(yaws.slice(120)).size).toBe(1);
});

test("a turn that would put a rex's head through a wall goes the long way round, steadily, to its look", () => {
  const w = world();
  wall(w, 110, 146, 140);
  // Facing +X along the wall, its flank 3 m from it. Its look is behind it and a little toward the wall: the short way
  // round swings its head through the wall, the long way is clear.
  const { b, p } = body(w, "rex", 128, 136.8, 16384);
  const look = 52000;
  const turns: number[] = [];
  for (let t = 0; t < 200; t++) {
    const was = b.yaw;
    stepBody(w, b, 0, 0, look, 0, 0, p, TICK_DT);
    turns.push(((b.yaw - was + 32768) & 0xffff) - 32768);
    expect(Math.max(...deepest(w, p, b))).toBe(0);
  }
  expect(b.yaw).toBe(look);
  // Every step of it the same way, the way away from the wall: it never swung back.
  expect(turns.every((d) => d >= 0)).toBe(true);
});

test("a rex put with its footprint in a wall stays where it was put, goes no deeper, and walks out", () => {
  const w = world();
  wall(w, 110, 146, 140, false, true);
  // Facing the low wall with its capsule clear of it and its front end half a metre in.
  const { b, p } = body(w, "rex", 128, 137.4, 0);
  const start = endDepth(w, p, b.x, b.y, b.z, b.yaw, true);
  expect(start).toBeGreaterThan(0.4);
  for (let t = 0; t < 60; t++) stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
  expect([b.x, b.z]).toEqual([128, 137.4].map(Math.fround));
  for (let t = 0; t < 90; t++) {
    stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
    expect(endDepth(w, p, b.x, b.y, b.z, b.yaw, true)).toBeLessThanOrEqual(start + SKIN);
  }
  // Not thrown back out either: it is where it was.
  expect(b.z).toBeGreaterThan(137.39);
  for (let t = 0; t < 90; t++) stepBody(w, b, 0, -127, 0, 0, 0, p, TICK_DT);
  expect(endDepth(w, p, b.x, b.y, b.z, b.yaw, true)).toBe(0);
});

test("a footprint's ends stand a step up: a raptor still climbs stairs onto a landing", () => {
  const w = world();
  const stairs = w.kind("core:stairs_wood");
  w.structs.add(stairs, 128, w.reg.halfY[stairs]!, 128, 0, 0, 1);
  const { b, p } = body(w, "raptor", 128, 120);
  expect(p.endRadius).toBeGreaterThan(0);
  let top = 0;
  for (let t = 0; t < 300; t++) {
    stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
    top = Math.max(top, b.y);
  }
  expect(top).toBeCloseTo(3, 1);
});
