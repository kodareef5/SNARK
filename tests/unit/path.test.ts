import { expect, test } from "bun:test";
import { TICK_DT, YAW_UNITS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Body, MODE_WALK, stepBody, type MoveParams } from "../../shared/sim/character.ts";
import { GROUND_FREE, GROUND_SOLID, GROUND_STEEP, GROUND_WATER, PATH_BUDGET, PATH_FOUND, PATH_LEG, PATH_NONE, PATH_REACH, PATH_SHORT, PathFinder, groundAt } from "../../shared/world/path.ts";
import { PROVING_POOL, SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0 } from "../../shared/world/proving.ts";
import { slopeKind } from "../../content/slopes.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { flatWorld, provingWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

const survivor = (w: TestWorld): MoveParams => w.reg.move[w.kind("core:survivor")]!;
const finder = (w: TestWorld): PathFinder => new PathFinder(w, survivor(w));
const points = (f: PathFinder): number[][] => Array.from({ length: f.count }, (_, k) => [f.x[k]!, f.z[k]!]);

function lengthOf(f: PathFinder): number {
  let m = 0;
  for (let k = 1; k < f.count; k++) m += Math.hypot(f.x[k]! - f.x[k - 1]!, f.z[k]! - f.z[k - 1]!);
  return m;
}

/** Steps a body along the last way as a player holding forward would. Returns it where it stopped. */
function walk(w: TestWorld, f: PathFinder): Body {
  const p = survivor(w);
  const b = new Body();
  b.x = f.x[0]!;
  b.z = f.z[0]!;
  b.y = w.hf.heightAt(b.x, b.z);
  b.grounded = true;
  let next = 1;
  for (let tick = (lengthOf(f) / p.walkSpeed) * 45 + 90; tick > 0 && next < f.count; tick--) {
    const dx = f.x[next]! - b.x;
    const dz = f.z[next]! - b.z;
    if (Math.hypot(dx, dz) < 0.25) next++;
    else stepBody(w, b, 0, 127, Math.round((Math.atan2(dx, dz) / (2 * Math.PI)) * YAW_UNITS) & 0xffff, 0, 0, p, TICK_DT);
  }
  expect(next).toBe(f.count);
  return b;
}

test("open ground is crossed in one straight line", () => {
  const w = flatWorld();
  const f = finder(w);
  expect(f.find(20.2, 30.7, 50.4, 70.1)).toBe(PATH_FOUND);
  expect(points(f)).toEqual([[20.2, 30.7], [50.4, 70.1]]);
  // 30 cells diagonally and 10 straight on.
  expect(f.cost).toBe(30 * 14 + 10 * 10);
  expect(f.expanded).toBeLessThan(60);
  expect(f.find(20.2, 30.7, 20.4, 30.9)).toBe(PATH_FOUND);
  expect(points(f)).toEqual([[20.2, 30.7], [20.4, 30.9]]);
});

test("a wall is rounded by its nearer end, a body can walk the way, and the same world gives the same way", () => {
  const build = (): TestWorld => {
    const w = flatWorld();
    for (let i = 0; i < 8; i++) w.structs.add(w.kind("core:wall"), 41.5 + 3 * i, 1.5, 64, 0, 0, 1);
    return w;
  };
  const w = build();
  const f = finder(w);
  expect(f.find(48.3, 58, 48.6, 70)).toBe(PATH_FOUND);
  // The wall runs from x 40 to 64, so the west end is nearer. Around a post at that end the way would be 24.9 m.
  const best = Math.hypot(8.3, 6) + Math.hypot(8.6, 6);
  expect(lengthOf(f)).toBeGreaterThan(best);
  expect(lengthOf(f)).toBeLessThan(best * 1.12);
  expect(Math.min(...f.x.slice(0, f.count))).toBeLessThan(40);
  const b = walk(w, f);
  expect(Math.hypot(b.x - 48.6, b.z - 70)).toBeLessThan(0.3);
  expect(f.holds(1, f.x[0]!, f.z[0]!)).toBe(true);

  const again = points(f);
  f.find(1, 1, 100, 100);
  f.find(48.3, 58, 48.6, 70);
  expect(points(f)).toEqual(again);
  const other = finder(build());
  other.find(48.3, 58, 48.6, 70);
  expect([points(other), other.cost, other.expanded]).toEqual([again, f.cost, f.expanded]);
  expect(Number.isInteger(f.cost)).toBe(true);
});

test("a wall as thin as a cell's edge is not walked through, and a goal inside something moves to the nearest free cell", () => {
  const w = flatWorld();
  const f = finder(w);
  // The wall stands on the line between two columns of cells, whose middles are both free.
  w.structs.add(w.kind("core:wall"), 64, 1.5, 64, 16384, 0, 1);
  expect(groundAt(w, survivor(w), 63.5, 64.5)).toBe(GROUND_FREE);
  expect(groundAt(w, survivor(w), 64.5, 64.5)).toBe(GROUND_FREE);
  expect(f.find(63.5, 64.5, 64.5, 64.5)).toBe(PATH_FOUND);
  expect(lengthOf(f)).toBeGreaterThan(3);
  walk(w, f);

  w.structs.add(w.kind("core:block"), 30, 1, 30, 0, 0, 1);
  expect(groundAt(w, survivor(w), 30, 30)).toBe(GROUND_SOLID);
  expect(f.find(20.5, 30.5, 30, 30)).toBe(PATH_FOUND);
  const end = [f.x[f.count - 1]!, f.z[f.count - 1]!];
  expect(Math.hypot(end[0]! - 30, end[1]! - 30)).toBeLessThan(3);
  expect(groundAt(w, survivor(w), end[0]!, end[1]!)).toBe(GROUND_FREE);
  // The middle of an 8 m slab at knee height is further than 3 m from anywhere to stand. Lying on the ground it is a step up.
  const slab = w.structs.add(w.kind("core:slab"), 90, 1, 90, 0, 0, 1);
  expect(f.find(80.5, 80.5, 90, 90)).toBe(PATH_NONE);
  w.structs.remove(slab);
  w.structs.add(w.kind("core:slab"), 90, 0.25, 90, 0, 0, 1);
  expect(f.find(80.5, 80.5, 90, 90)).toBe(PATH_FOUND);
  expect(walk(w, f).y).toBe(0.5);
});

test("a search stops at its budget, and a goal nothing leads to gets the way to the nearest cell reached", () => {
  const w = flatWorld(4);
  sealedRoom(w, 128, 128);
  const f = finder(w);
  expect(f.find(100.5, 128.5, 128.5, 128.5)).toBe(PATH_SHORT);
  expect(f.expanded).toBe(PATH_BUDGET);
  // It ends against the outside of the nearest wall, which is the north one.
  expect([f.x[f.count - 1], f.z[f.count - 1]]).toEqual([128.5, 131.5]);
  f.budget = 40;
  expect(f.find(100.5, 128.5, 128.5, 128.5)).toBe(PATH_SHORT);
  expect(f.expanded).toBe(40);
  // From inside, the only cells are the room's own.
  f.budget = PATH_BUDGET;
  expect(f.find(128.5, 128.5, 100.5, 128.5)).toBe(PATH_SHORT);
  expect(f.expanded).toBeLessThan(40);
});

test("a search spread over many calls finds the way one call does", () => {
  const w = provingWorld();
  const f = finder(w);
  expect(f.find(288, 258, 288, 266)).toBe(PATH_FOUND);
  const whole = [points(f), f.cost, f.expanded];
  expect(f.begin(288, 258, 288, 266)).toBe(true);
  let calls = 1;
  while (!f.run(7)) calls++;
  expect(f.finish()).toBe(PATH_FOUND);
  expect([points(f), f.cost, f.expanded]).toEqual(whole);
  expect(calls).toBeGreaterThan(30);
});

test("a doorway off the metre grid is found when the finder knows doorways, by a body only a little narrower", () => {
  const w = flatWorld();
  const raptor = w.reg.move[w.kind("core:raptor")]!;
  // A wall across the ground with a doorframe in it, whose middle lies a quarter of a metre off every cell's middle.
  const wall = w.kind("core:wall_wood");
  for (let i = -4; i <= 4; i++) w.structs.add(i === 0 ? w.kind("core:doorframe_wood") : wall, 64.25 + 3 * i, 1.5, 64, 0, 0, 1);
  const f = new PathFinder(w, raptor);
  expect(f.find(64.25, 58, 64.25, 70)).toBe(PATH_FOUND);
  // Round the end of the wall, 13.5 m off.
  expect(lengthOf(f)).toBeGreaterThan(27);
  f.doorways = w.reg.doorway;
  expect(f.find(64.25, 58, 64.25, 70)).toBe(PATH_FOUND);
  expect(lengthOf(f)).toBeLessThan(12.5);
  const b = new Body();
  b.x = f.x[0]!;
  b.z = f.z[0]!;
  b.grounded = true;
  let next = 1;
  for (let tick = 0; tick < 300 && next < f.count; tick++) {
    const dx = f.x[next]! - b.x;
    const dz = f.z[next]! - b.z;
    if (Math.hypot(dx, dz) < 0.25) next++;
    else stepBody(w, b, 0, 127, Math.round((Math.atan2(dx, dz) / (2 * Math.PI)) * YAW_UNITS) & 0xffff, 0, 0, raptor, TICK_DT);
  }
  expect(Math.hypot(b.x - 64.25, b.z - 70)).toBeLessThan(0.3);
});

test("a goal beyond the grid is walked toward in legs", () => {
  const w = flatWorld(8);
  const f = finder(w);
  expect(f.find(100.5, 100.5, 400.5, 300.5)).toBe(PATH_LEG);
  const end = [f.x[f.count - 1]!, f.z[f.count - 1]!];
  expect(end[0]).toBe(100.5 + PATH_REACH);
  expect(Math.hypot(400.5 - end[0]!, 300.5 - end[1]!)).toBeLessThan(Math.hypot(300, 200) - 100);
  expect(f.expanded).toBeLessThan(200);
  // The next leg starts where this one ended.
  expect(f.find(end[0]!, end[1]!, 400.5, 300.5)).toBe(PATH_LEG);
  expect(f.find(330.5, 250.5, 400.5, 300.5)).toBe(PATH_FOUND);
});

test("a way stops holding when something is set down on it, and a cell to avoid is gone around", () => {
  const w = flatWorld();
  const f = finder(w);
  f.find(20.5, 20.5, 60.5, 20.5);
  expect(f.count).toBe(2);
  expect(f.holds(1, 30, 20.5)).toBe(true);
  const crate = w.structs.add(w.kind("core:crate"), 45, 0.5, 20.5, 0, 0, 1);
  expect(f.holds(1, 30, 20.5)).toBe(false);
  // Past the crate it holds again.
  expect(f.holds(1, 50, 20.5)).toBe(true);
  expect(f.find(30, 20.5, 60.5, 20.5)).toBe(PATH_FOUND);
  expect(f.count).toBeGreaterThan(2);
  expect(f.holds(1, 30, 20.5)).toBe(true);
  walk(w, f);

  w.structs.remove(crate);
  f.avoid(45.2, 20.9);
  f.find(20.5, 20.5, 60.5, 20.5);
  expect(f.count).toBeGreaterThan(2);
  f.forget();
  f.find(20.5, 20.5, 60.5, 20.5);
  expect(f.count).toBe(2);
});

test("on the proving ground a body walks every way found, round water, steep ground and everything built", () => {
  const w = provingWorld();
  const p = survivor(w);
  const f = finder(w);
  expect(groundAt(w, p, PROVING_POOL.x, PROVING_POOL.z)).toBe(GROUND_WATER);
  expect(groundAt(w, p, SLOPE_X0 + SLOPE_WIDTH * 5.5, SLOPE_Z0 + 3)).toBe(GROUND_STEEP);
  expect(f.find(256, 240, PROVING_POOL.x, PROVING_POOL.z)).toBe(PATH_NONE);
  // Into the house by its doorway, and up beside the 60 degree strip by the gentle ones.
  expect(f.find(256, 240, 240.5, 274.5)).toBe(PATH_FOUND);
  walk(w, f);
  expect(f.find(SLOPE_X0 + SLOPE_WIDTH * 5.5, SLOPE_Z0 - 4, SLOPE_X0 + SLOPE_WIDTH * 5.5, SLOPE_Z0 + 20)).toBe(PATH_FOUND);
  expect(walk(w, f).y).toBeGreaterThan(11.9);

  const rng = new Rng(11);
  const spot = (): [number, number] => {
    for (;;) {
      const x = rng.range(200, 310);
      const z = rng.range(215, 330);
      if (groundAt(w, p, x, z) === GROUND_FREE) return [x, z];
    }
  };
  let found = 0;
  for (let n = 0; n < 40; n++) {
    const [ax, az] = spot();
    const [bx, bz] = spot();
    const status = f.find(ax, az, bx, bz);
    if (status !== PATH_FOUND) continue;
    found++;
    const b = walk(w, f);
    expect(Math.hypot(b.x - bx, b.z - bz)).toBeLessThan(0.3);
    expect(b.mode).toBe(MODE_WALK);
  }
  expect(found).toBeGreaterThan(30);
});

test("the ground the way finder may walk ends where a body walking up to a block too high to step onto stops, and runs on over one it steps onto", () => {
  const wrong: string[] = [];
  for (const id of ["core:survivor", "core:dodo", "core:raptor", "core:parasaur"]) {
    const w = flatWorld();
    const p = w.reg.move[w.kind(id)]!;
    for (const top of [p.stepUp - 0.05, p.stepUp + 0.05]) {
      // A 2 m block sunk to its top, its south face at z = 63, walked at head on from the south.
      const block = w.structs.add(w.kind("core:block"), 64, top - 1, 64, 0, 0, 1);
      const b = new Body();
      [b.x, b.z, b.grounded] = [64, 61 - p.radius, true];
      for (let tick = 0; tick < 150; tick++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
      const stop = top > p.stepUp ? b.z : Infinity;
      if ((stop < 63) !== top > p.stepUp) wrong.push(`${id} at a block ${top.toFixed(2)} m up ended at ${b.z.toFixed(3)}`);
      for (let z = 62 - p.radius; z < 64; z += 0.01) {
        const free = groundAt(w, p, 64, z) === GROUND_FREE;
        if (z < stop - 0.02 && !free) wrong.push(`${id}, ${top.toFixed(2)} m: ${z.toFixed(2)} is not free short of where the body stops, ${stop.toFixed(3)}`);
        if (z > stop + 0.02 && free) wrong.push(`${id}, ${top.toFixed(2)} m: ${z.toFixed(2)} is free past where the body stops, ${stop.toFixed(3)}`);
      }
      w.structs.remove(block);
    }
  }
  expect(wrong).toEqual([]);
});

test("the ground the way finder may walk ends where a body walking up to a slope too steep to climb stops, not where the slope starts", () => {
  const w = { ...provingWorld(), structs: flatWorld(8).structs };
  const p = survivor(w);
  // Strip 5 is 60 degrees. Walking north at its foot, the body stops where its lower sphere meets the slope.
  const x = SLOPE_X0 + SLOPE_WIDTH * 5 + SLOPE_WIDTH / 2;
  const b = new Body();
  b.x = x;
  b.z = SLOPE_Z0 - 4;
  b.y = w.hf.heightAt(b.x, b.z);
  b.grounded = true;
  for (let tick = 0; tick < 60; tick++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
  const stop = b.z;
  expect(stop).toBeLessThan(SLOPE_Z0 - 0.1);
  const wrong: string[] = [];
  for (let z = SLOPE_Z0 - 1; z < SLOPE_Z0 + 1; z += 0.01) {
    const free = groundAt(w, p, x, z) === GROUND_FREE;
    if (z < stop - 0.02 && !free) wrong.push(`${z.toFixed(2)} is not free short of where the body stops, ${stop.toFixed(3)}`);
    if (z > stop + 0.02 && free) wrong.push(`${z.toFixed(2)} is free past where the body stops, ${stop.toFixed(3)}`);
  }
  expect(wrong).toEqual([]);
});

test("over sloped pieces the way finder may walk where a body steps onto them from the ground, and stops where a face too steep to stand on stops it", () => {
  const wrong: string[] = [];
  for (const id of ["core:survivor", "core:dodo", "core:raptor", "core:parasaur"]) {
    const w = flatWorld();
    const p = w.reg.move[w.kind(id)]!;
    // Up the rubble's middle: free while where the body touches it, standing on it, is no more than a step up, then not. On a
    // slope of 1.5 in 4 the lower sphere touches it r (1 - cos) above the feet.
    const rubble = w.kind(slopeKind("rubble"));
    const heap = w.structs.add(rubble, 64, w.reg.halfY[rubble]!, 64, 0, 0, 1);
    const touch = p.radius * (1 - 4 / Math.hypot(4, 1.5));
    for (let z = 61; z < 66; z += 0.05) {
      let y = 2;
      while (y > 0 && capsuleFree(w, 64, y - 0.002, z, p.radius, p.height)) y -= 0.002;
      const free = groundAt(w, p, 64, z) === GROUND_FREE;
      if (y + touch < p.stepUp - 0.02 && !free) wrong.push(`${id} on the rubble at ${z.toFixed(2)}, ${y.toFixed(3)} m up: not free`);
      if (y > p.stepUp + 0.02 && free) wrong.push(`${id} on the rubble at ${z.toFixed(2)}, ${y.toFixed(3)} m up: free`);
    }
    w.structs.remove(heap);
    // Into the slab leaning at 60 degrees: free short of where a body walking into it stops, and not past it.
    const slab = w.kind(slopeKind("slab60"));
    w.structs.add(slab, 64, w.reg.halfY[slab]!, 64, 0, 0, 1);
    const b = new Body();
    [b.x, b.z, b.grounded] = [64, 60 - p.radius, true];
    for (let tick = 0; tick < 150; tick++) stepBody(w, b, 0, 127, 0, 0, 0, p, TICK_DT);
    for (let z = 61.5 - p.radius; z < 64; z += 0.01) {
      const free = groundAt(w, p, 64, z) === GROUND_FREE;
      if (z < b.z - 0.02 && !free) wrong.push(`${id}: ${z.toFixed(2)} is not free short of where the body stops at the slab, ${b.z.toFixed(3)}`);
      if (z > b.z + 0.02 && free) wrong.push(`${id}: ${z.toFixed(2)} is free past where the body stops at the slab, ${b.z.toFixed(3)}`);
    }
  }
  expect(wrong).toEqual([]);
});
