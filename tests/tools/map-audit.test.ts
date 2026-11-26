import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { audit, doorsOffGround, hullsInPieces, lakeWraps, offMap, openMap, piecesUnderGround, streetsThroughBuildings, twins, waterWalls, type Audited } from "../../tools/mapworld/audit.ts";
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
  expect(checks.filter((c) => c.gate).map((c) => c.count)).toEqual([0, 0, 0, 0]);
  expect(checks.map((c) => c.check)).toContain("water ending in a wall");
});

test("a piece placed twice is counted once; another turn or kind is not", () => {
  const c = twins(opened({ statics: [wall(10, 20), wall(10, 20), wall(10, 20, 16384), wall(10, 20, 0, "core:zruin_wall4_clay"), wall(14, 20)] }));
  expect([c.gate, c.count, c.of]).toEqual([true, 1, 5]);
});

test("a bent kerb's own collision box made twice is counted apart and fails nothing", () => {
  // A kerb a metre long on a curve: each of its two chords is a hair over its 0.5 m box, so takes two a step apart.
  const kerb = { kind: "core:zzzzzbend_median_c", x: 100.2, y: 1.06, z: 101.92, yaw: 40539, bend: [483, 0, 4133, 1545, 0, 0, 300, 8246] };
  const c = twins(opened({ statics: [kerb, wall(10, 20), wall(10, 20)] }));
  expect([c.count, c.madeBoxesTwice]).toEqual([1, 1]);
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
  const hull = (x: number): MapStatic => ({ kind: "core:zzzzhull_belvedere_232", x, y: 0, z: 100, yaw: 0 });
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
