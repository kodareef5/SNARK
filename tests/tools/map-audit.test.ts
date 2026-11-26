import { expect, test } from "bun:test";
import { DEAD_DYES } from "../../content/docks.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { audit, bodiesSwum, poolsInPits, doorsOffGround, hullsInPieces, lakeWraps, offMap, openMap, piecesUnderGround, streetsThroughBuildings, sunkPools, swimming, twins, waterWalls, type Audited } from "../../tools/mapworld/audit.ts";
import { flatMap } from "../fixtures/map.ts";
import { builtSketch, SIDE_FRONT, Sketch } from "../fixtures/sketch.ts";

const CHUNKS = 4, SIDE = (CHUNKS * 64) / 2 + 1, [MIN_Y, STEP_Y] = [-32, 1 / 256];
const dims = { chunksX: CHUNKS, chunksZ: CHUNKS };
const units = (y: number): number => Math.round((y - MIN_Y) / STEP_Y);
/** The flat map's heights with the samples `low` picks set to `y`. */
const ground = (low: (x: number, z: number) => boolean, y: number): Uint16Array =>
  Uint16Array.from({ length: SIDE * SIDE }, (_, k) => units(low((k % SIDE) * 2, Math.floor(k / SIDE) * 2) ? y : 0));
const opened = (more: Partial<MapData>): Audited => openMap(writeMap(flatMap(CHUNKS, more)));
const sketched = (sketches: Sketch[], more: Partial<MapData> = {}): Audited => {
  const built = builtSketch(sketches, CHUNKS);
  return opened({ statics: built.statics, ...built.more, ...more });
};
const wall = (x: number, z: number, yaw = 0, kind = "core:zruin_wall4_concrete"): MapStatic => ({ kind, x, y: 1.4, z, yaw });
/** Squares of 2 m over the flat map, each a body's number from `of`. */
const lakes = (surfaces: number[], of: (i: number, j: number) => number): MapWater =>
  MapWater.fromGrid(dims, MIN_Y, STEP_Y, 2, surfaces.map((s, k) => ({ name: `Lake ${k + 1}`, level: units(s) })), Uint16Array.from({ length: 128 * 128 }, (_, k) => of(k % 128, Math.floor(k / 128))));

test("a map of one sound building passes every gate", () => {
  const s = new Sketch(2, 2, 4);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) s.slab(i, j, 1);
  s.edge("wall4", "concrete", 0, 0, SIDE_FRONT, 0);
  const checks = audit(sketched([s]));
  expect(checks.filter((c) => c.gate).map((c) => c.count)).toEqual([0, 0, 0, 0, 0]);
  expect(checks.map((c) => c.check)).toContain("water ending in a wall");
});

test("a piece placed twice is counted once; another turn or kind is not", () => {
  const c = twins(opened({ statics: [wall(10, 20), wall(10, 20), wall(10, 20, 16384), wall(10, 20, 0, "core:zruin_wall4_clay"), wall(14, 20)] }));
  expect([c.gate, c.count, c.of]).toEqual([true, 1, 5]);
});

test("a bent kerb makes each collision box once, and a wall placed twice is counted", () => {
  // A kerb a metre long on a curve: each of its two chords is a hair over its 0.5 m box, which once made a second a step apart.
  const kerb = { kind: "core:zzzzzbend_median_c", x: 100.2, y: 1.06, z: 101.92, yaw: 40539, bend: [483, 0, 4133, 1545, 0, 0, 300, 8246] };
  const c = twins(opened({ statics: [kerb, wall(10, 20), wall(10, 20)] }));
  expect([c.count, c.madeBoxesTwice]).toEqual([1, 0]);
  expect(c.of).toBeGreaterThan(3);
});

test("a piece moved off the map is counted", () => {
  const w = opened({ statics: [wall(10, 20), wall(40, 20)] });
  expect(offMap(w).count).toBe(0);
  w.map.statics.x[1] = -3;
  expect(offMap(w)).toMatchObject({ gate: true, count: 1, pieces: 1, buildings: 0 });
});

test("a lake run off a row's end into the next row wraps; one across the map does not", () => {
  const water = lakes([1, 1], (i, j) => ((i === 127 && j === 5) || (i === 0 && j === 6) ? 1 : j === 10 || j === 11 ? 2 : 0));
  const c = lakeWraps(opened({ water }));
  expect([c.count, c.bodies]).toEqual([1, 2]);
  expect((c.first as string[])[0]).toContain("Lake 1");
});

test("a hull in a wall is counted; one against a dock or in open water is not", () => {
  const hull = (x: number): MapStatic => ({ kind: `core:zzzzhull_belvedere_${DEAD_DYES[0]!.paint}`, x, y: 0, z: 100, yaw: 0 });
  // The hull's stern box is 10.5 m behind its middle, from 0.6 to 1.5 m up.
  const c = hullsInPieces(opened({ statics: [hull(50), { ...wall(50, 89.5), y: 1 }, hull(120), { kind: "core:zzzzdock_walk", x: 120, y: 1.2, z: 89.5, yaw: 0 }, hull(190)] }));
  expect([c.gate, c.count, c.hulls]).toEqual([true, 1, 3]);
});

test("water standing over the ground past its squares is a wall; a basin's is not", () => {
  const inside = (i: number, j: number, a: number): boolean => i >= a && i <= a + 5 && j >= a && j <= a + 5;
  const water = lakes([1, 0], (i, j) => (inside(i, j, 20) ? 1 : inside(i, j, 60) ? 2 : 0));
  // The second lake's bed is a metre down inside its squares' outer corners, which stay at its surface.
  const c = waterWalls(opened({ water, heights: ground((x, z) => x >= 122 && x <= 130 && z >= 122 && z <= 130, -1) }));
  expect(c).toMatchObject({ gate: false, count: 1, bodies: 2, byOverAMetre: 0, wallMetres: 48 });
});

test("a survivor swims in a pool 1.5 m deep and walks out; in a pit it is caught; in 0.5 m it wades", () => {
  // Three pools 8 m square, their water at the ground's level: beds of 1.5, 1.5 and 0.5 m, the second walled 3 m up.
  const at = [20, 60, 100], bed = [-1.5, -1.5, -0.5];
  const pool = (i: number, j: number, reach: number): number => at.findIndex((a) => i >= a - reach && i <= a + 4 + reach && j >= 20 - reach && j <= 24 + reach);
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)], inside = pool(i, j, 0);
    return units(inside >= 0 ? bed[inside]! : pool(i, j, 3) === 1 ? 3 : 0);
  });
  // Each pool's squares: those with a corner on one of its samples.
  const water = lakes([0, 0, 0], (i, j) => 1 + at.findIndex((a) => i >= a - 1 && i <= a + 4 && j >= 19 && j <= 24));
  const w = opened({ heights, water });
  expect(bodiesSwum(w).map((s) => [s.body, s.swims, s.out, Math.round(s.depth * 10) / 10])).toEqual([[1, true, true, 1.5], [2, true, false, 1.5], [3, false, true, 0.5]]);
  const c = swimming(w);
  expect(c).toMatchObject({ gate: true, count: 1, bodiesWithWater: 3, swimmable: 2, swimmableWalkedOut: 1, wading: 1, wadingNotWalkedOut: 0 });
  expect((c.first as string[])[0]).toContain("body 2");
});

test("a survivor climbs a ladder two samples wide out of a pit; a stair one sample wide leaves it caught", () => {
  // Two pools 16 m square in ground 3 m over their water. West of the first, two rows of steps 1.5 m apart; of the second, one.
  const at = [20, 60], rows = [[23, 24], [23]];
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)], p = at.findIndex((a) => i >= a && i <= a + 7 && j >= 20 && j <= 27);
    if (p < 0) return units(3);
    return units(rows[p]!.includes(j) && i - at[p]! < 2 ? 1.5 - (i - at[p]!) * 1.5 : -1.5);
  });
  const water = lakes([0, 0], (i, j) => 1 + at.findIndex((a) => i >= a - 1 && i <= a + 7 && j >= 19 && j <= 27));
  const w = opened({ heights, water });
  expect(bodiesSwum(w).map((s) => [s.body, s.swims, s.out])).toEqual([[1, true, true], [2, true, false]]);
  expect(swimming(w)).toMatchObject({ count: 1, swimmable: 2, swimmableWalkedOut: 1 });
});

test("two pools side by side, walled round, are both caught: the water of one is no way out of the other", () => {
  // Each 16 m square, one sample of rim between them just over their water, the ground round both 3 m up.
  const inA = (i: number, j: number): boolean => i >= 20 && i <= 27 && j >= 20 && j <= 27, inB = (i: number, j: number): boolean => i >= 29 && i <= 36 && j >= 20 && j <= 27;
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)];
    return units(inA(i, j) || inB(i, j) ? -1.5 : i === 28 && j >= 20 && j <= 27 ? 0.1 : 3);
  });
  // A's squares are those with a corner on one of its samples, and B's from the rim between them on.
  const water = lakes([0, 0], (i, j) => (j < 19 || j > 27 ? 0 : i >= 19 && i <= 27 ? 1 : i >= 28 && i <= 36 ? 2 : 0));
  const w = opened({ heights, water });
  expect(bodiesSwum(w).map((s) => [s.body, s.swims, s.out, s.touches])).toEqual([[1, true, false, 1], [2, true, false, 1]]);
  expect(swimming(w)).toMatchObject({ count: 2, swimmable: 2, swimmableWalkedOut: 0, touchingPairs: 1 });
});

test("a basin inside a tank is left through the tank's water and over its rim, or not at all", () => {
  // A basin 8 m square, a rim just over the water round it, a tank's water 6 m wide round that, and ground 3 m up.
  const basin = (i: number, j: number): boolean => i >= 60 && i <= 63 && j >= 30 && j <= 33;
  const rim = (i: number, j: number): boolean => !basin(i, j) && i >= 59 && i <= 64 && j >= 29 && j <= 34;
  const tank = (i: number, j: number): boolean => !basin(i, j) && !rim(i, j) && i >= 56 && i <= 67 && j >= 26 && j <= 37;
  const made = (ladder: boolean): Audited => {
    const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
      const [i, j] = [k % SIDE, Math.floor(k / SIDE)];
      // The ladder: two rows of the tank's west side, 1.5 m a step up to the ground.
      if (ladder && (j === 31 || j === 32) && (i === 56 || i === 57)) return units(i === 56 ? 1.5 : 0);
      return units(basin(i, j) || tank(i, j) ? -1.5 : rim(i, j) ? 0.1 : 3);
    });
    const water = lakes([0, 0], (i, j) => (i >= 59 && i <= 63 && j >= 29 && j <= 33 ? 1 : i >= 55 && i <= 67 && j >= 25 && j <= 37 ? 2 : 0));
    return opened({ heights, water });
  };
  expect(bodiesSwum(made(false)).map((s) => [s.body, s.swims, s.out, s.touches])).toEqual([[1, true, false, 1], [2, true, false, 1]]);
  expect(bodiesSwum(made(true)).map((s) => [s.body, s.swims, s.out])).toEqual([[1, true, true], [2, true, true]]);
});

test("a pool a building's walls stand round is caught, and the audit says a piece is in the way", () => {
  // A pool 8 m square in flat ground, and a square of walls 24 m a side round it.
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => units(k % SIDE >= 20 && k % SIDE <= 24 && Math.floor(k / SIDE) >= 20 && Math.floor(k / SIDE) <= 24 ? -1.5 : 0));
  const water = lakes([0], (i, j) => (i >= 19 && i <= 24 && j >= 19 && j <= 24 ? 1 : 0));
  const round = [34, 38, 42, 46, 50, 54].flatMap((d) => [wall(d, 32), wall(d, 56), wall(32, d, 16384), wall(56, d, 16384)]);
  expect(swimming(opened({ heights, water }))).toMatchObject({ count: 0, swimmable: 1, swimmableWalkedOut: 1 });
  const c = swimming(opened({ heights, water, statics: round }));
  expect(c).toMatchObject({ gate: true, count: 1, swimmable: 1, swimmableWalkedOut: 0, caughtByPieces: 1, clearMetres: 12 });
  expect((c.first as string[])[0]).toContain("out with no piece standing");
  // One wall away, it walks out between the rest.
  expect(swimming(opened({ heights, water, statics: round.slice(1) })).count).toBe(0);
});

test("a body is caught where one of its parts is, though its deepest water is walked out of", () => {
  // One body in two places 80 m apart: the first open and 1.6 m deep, the second 1.5 m deep and walled 3 m up.
  const at = [20, 60], bed = [-1.6, -1.5];
  const part = (i: number, j: number, reach: number): number => at.findIndex((a) => i >= a - reach && i <= a + 4 + reach && j >= 20 - reach && j <= 24 + reach);
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)], inside = part(i, j, 0);
    return units(inside >= 0 ? bed[inside]! : part(i, j, 3) === 1 ? 3 : 0);
  });
  const water = lakes([0], (i, j) => (at.some((a) => i >= a - 1 && i <= a + 4 && j >= 19 && j <= 24) ? 1 : 0));
  const w = opened({ heights, water });
  const [s] = bodiesSwum(w);
  expect([s!.body, s!.swims, s!.out, s!.parts.map((p) => p.out)]).toEqual([1, true, false, [true, false]]);
  expect(swimming(w)).toMatchObject({ count: 1, swimmable: 1, parts: 2, caughtByPieces: 0 });
});

test("a swum body whose rim stands over a metre above its water is a sunk pool", () => {
  // Two pools 8 m square: one in ground just over its water, one with ground 3.5 m up round it.
  const at = [20, 60];
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)], p = at.findIndex((a) => i >= a && i <= a + 4 && j >= 20 && j <= 24);
    return units(p >= 0 ? -1.5 : i > 50 ? 3.5 : 0.1);
  });
  const water = lakes([0, 0], (i, j) => 1 + at.findIndex((a) => i >= a - 1 && i <= a + 4 && j >= 19 && j <= 24));
  const c = sunkPools(opened({ heights, water }));
  expect(c).toMatchObject({ gate: false, count: 1, swimmable: 2, overThreeMetres: 1 });
  expect(c.deepest as string).toContain("body 2");
  expect(c.deepest as string).toContain("3.50 m over");
});

test("water more than a metre under the ground two corners out stands in a pit", () => {
  // Two pools 8 m square: one in ground level with its water, one with ground 3 m up round it.
  const at = [20, 60];
  const heights = Uint16Array.from({ length: SIDE * SIDE }, (_, k) => {
    const [i, j] = [k % SIDE, Math.floor(k / SIDE)], p = at.findIndex((a) => i >= a && i <= a + 4 && j >= 20 && j <= 24);
    return units(p >= 0 ? -1.5 : i > 50 ? 3 : 0.1);
  });
  const water = lakes([0, 0], (i, j) => 1 + at.findIndex((a) => i >= a - 1 && i <= a + 4 && j >= 19 && j <= 24));
  const c = poolsInPits(opened({ heights, water }));
  expect(c).toMatchObject({ gate: false, count: 1, bodies: 2 });
  expect(c.deepest as string).toContain("body 2");
  expect(c.deepest as string).toContain("3.00 m under");
});

test("a street along a building's wall is a run; one that only crosses it is not", () => {
  const s = new Sketch(3, 1, 4);
  for (let i = 0; i < 3; i++) s.edge("wall4", "concrete", i, 0, SIDE_FRONT, 0);
  const w = sketched([s]);
  const along = { xz: [80, 94, 112, 94], type: 6 }, far = { xz: [80, 140, 112, 140], type: 4 }, across = { xz: [96, 83, 96, 105], type: 6 };
  expect(streetsThroughBuildings(w, [along, far])).toMatchObject({ gate: false, count: 1, metres: 12, samplesBlocked: 6, byStreetType: [0, 0, 0, 0, 0, 0, 1] });
  expect(streetsThroughBuildings(w, [across])).toMatchObject({ count: 0, runsOfAnyLength: 1 });
  expect(streetsThroughBuildings(w).samples).toBe(0);
});

test("a ground-storey canopy over a drop is a door off the ground", () => {
  const sketches = [new Sketch(1, 1, 8), new Sketch(1, 1, 8, 200, 200)];
  for (const s of sketches) s.edge("zentry", "blue", 0, 0, SIDE_FRONT, 0, 2.82);
  sketches[1]!.edge("zentry", "blue", 0, 0, SIDE_FRONT, 1, 2.82);
  // A metre lower from 2 m in front of the first building's door.
  const c = doorsOffGround(sketched(sketches, { heights: ground((x, z) => x < 150 && z <= 90, -1) }));
  expect(c).toMatchObject({ gate: false, count: 1, doors: 2, floorAboveGround: 1, byOverAMetre: 0 });
});

test("a piece under the ground at every corner is counted; one that shows is not", () => {
  const sketches = [new Sketch(1, 1, 4), new Sketch(1, 1, 4, 200, 200)];
  for (const s of sketches) s.put("floor4", "concrete", 0, 0, -1);
  sketches[0]!.slab(0, 0, 1);
  // The second slab's west corners stand over ground a metre lower.
  const c = piecesUnderGround(sketched(sketches, { heights: ground((x) => x >= 190 && x <= 198, -1) }));
  expect(c).toMatchObject({ gate: false, count: 1, pieces: 3, atTheMiddle: 2, ofNoBuilding: 0 });
});

test("the tool prints a line a check and exits 1 where a gate fails", () => {
  const folder = mkdtempSync(join(tmpdir(), "snark-audit-"));
  try {
    const run = (name: string, statics: MapStatic[]): { exit: number; lines: { check?: string; ok?: boolean; count?: number }[] } => {
      writeFileSync(join(folder, name), writeMap(flatMap(CHUNKS, { statics })));
      const child = Bun.spawnSync(["bun", join(import.meta.dir, "../../tools/mapworld/audit.ts"), join(folder, name)], { stdout: "pipe", stderr: "pipe" });
      return { exit: child.exitCode, lines: new TextDecoder().decode(child.stdout).trim().split("\n").map((l) => JSON.parse(l)) };
    };
    const sound = run("sound.snmap", [wall(10, 20)]), twice = run("twice.snmap", [wall(10, 20), wall(10, 20)]);
    expect([sound.exit, twice.exit]).toEqual([0, 1]);
    expect(sound.lines.filter((l) => l.check).length).toBe(audit(opened({})).length);
    expect(twice.lines.find((l) => l.check === "pieces placed twice")).toMatchObject({ ok: false, count: 1 });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
