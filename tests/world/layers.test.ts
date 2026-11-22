// The way finder that climbs and swims: storeys up a stack of flights, the pool swum or walked round, goals nobody can stand
// on, falls it would not land from, and the same way every time.

import { expect, test } from "bun:test";
import { LayeredFinder } from "../../shared/world/layers.ts";
import { PATH_FOUND, PATH_SHORT } from "../../shared/world/path.ts";
import { flatWorld, provingWorld } from "../fixtures/world.ts";

const ways = (f: LayeredFinder): number[][] => f.x.map((x, k) => [Math.round(x * 10) / 10, Math.round(f.y[k]! * 10) / 10, Math.round(f.z[k]! * 10) / 10, f.swum[k] ? 1 : 0]);

test("up the proving ground's stairs onto the slab, and across the pool swimming or round it walking", () => {
  const w = provingWorld();
  const f = new LayeredFinder(w, w.reg.move[w.kind("core:survivor")]!);
  expect(f.find(256, 0, 240, 263, 3.6, 292.5)).toBe(PATH_FOUND);
  expect(f.y[f.count - 1]).toBeCloseTo(3.6, 1);
  // Every point of the way climbs no more than a step on the level between the points before it.
  for (let k = 1; k < f.count; k++) expect(f.y[k]! - f.y[k - 1]!).toBeLessThan(4);
  const first = JSON.stringify(ways(f));
  expect(f.find(256, 0, 240, 263, 3.6, 292.5)).toBe(PATH_FOUND);
  expect(JSON.stringify(ways(f))).toBe(first);

  expect(f.find(200, 0, 256, 148, NaN, 256)).toBe(PATH_FOUND);
  expect(f.swum.some((s) => s)).toBe(true);
  // Forbidden to swim, it wades round the pool's shallow rim.
  f.swim = false;
  expect(f.find(200, 0, 256, 148, NaN, 256)).toBe(PATH_FOUND);
  expect(f.swum.some((s) => s)).toBe(false);
  // The middle of the pool, unswum, cannot be reached.
  expect(f.find(200, 0, 256, 172, NaN, 256)).toBe(PATH_SHORT);
});

test("three storeys of flights and landings are climbed lane by lane, and a drop too far is not taken", () => {
  const w = flatWorld(4);
  const reg = w.reg;
  const flight = w.kind("core:zruin_flight_concrete");
  const landing = w.kind("core:zruin_landing_concrete");
  const floor = w.kind("core:zruin_floor8_concrete");
  // As the ruins lay a stair core: flights in two lanes 3 m apart, turning at each landing.
  const [cx, cz] = [128, 128];
  for (let f = 0; f < 3; f++) {
    const dir = f % 2 === 0 ? 1 : -1;
    const u = dir > 0 ? -1.5 : 1.5;
    w.structs.add(flight, cx + u, f * 4 + 2, cz - dir * 0.5, dir > 0 ? 0 : 32768, 0, 1000);
    w.structs.add(landing, cx, (f + 1) * 4 - 0.2, cz + dir * 3, 0, 0, 1000);
  }
  // A floor at the top beyond the last landing, with nothing under its far side but 12 m of air.
  w.structs.add(floor, cx, 11.8, cz + 3.75 + 4, 0, 0, 1000);
  const f = new LayeredFinder(w, reg.move[w.kind("core:survivor")]!);
  expect(f.find(cx - 1.5, 0, cz - 5, cx, 12, cz + 8)).toBe(PATH_FOUND);
  expect(Math.max(...f.y)).toBeGreaterThan(11.5);
  // Its points climb a storey at a time: none is reached by a jump of more than a step.
  for (let k = 1; k < f.count; k++) expect(Math.abs(f.y[k]! - f.y[k - 1]!)).toBeLessThan(4.5);
  expect(f.expanded).toBeLessThan(6000);
  // From the top floor straight down to the ground under it is a fall of 12 m, so the way goes back down the stairs.
  expect(f.find(cx, 12, cz + 8, cx, NaN, cz + 14)).toBe(PATH_FOUND);
  expect(Math.max(...f.y)).toBeGreaterThan(11);
  expect(f.y.filter((y) => y > 0.5 && y < 11).length).toBeGreaterThan(0);
});

test("a goal inside a pillar is reached beside it", () => {
  const w = provingWorld();
  const f = new LayeredFinder(w, w.reg.move[w.kind("core:survivor")]!);
  expect(f.find(256, 0, 240, 256, NaN, 300)).toBe(PATH_FOUND);
  expect(Math.hypot(f.x[f.count - 1]! - 256, f.z[f.count - 1]! - 300)).toBeLessThan(3);
  expect(f.expanded).toBeLessThan(500);
});
