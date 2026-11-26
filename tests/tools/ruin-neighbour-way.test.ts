// A way to a door and the neighbours' walls (tools/mapworld/ruin-access.ts, ruin-clearance.ts): the planner keeps a way
// off every other outline where it can, and a way a neighbour's wall still stands in is given up, not cleared through it.

import { expect, test } from "bun:test";
import { ruinKind, type RuinShape } from "../../content/ruins.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S } from "../../tools/mapworld/ground.ts";
import { know } from "../../tools/mapworld/known.ts";
import { accessPlanner, hugs, NEIGHBOUR_CLEAR } from "../../tools/mapworld/ruin-access.ts";
import { clearCirculation } from "../../tools/mapworld/ruin-clearance.ts";
import { Mason, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import type { RuinRecord } from "../../tools/mapworld/ruins.ts";
import type { Site, StaticPiece } from "../../tools/mapworld/statics.ts";

/** A rectangle's ring as its points' x and z. */
const ring = (x0: number, z0: number, x1: number, z1: number): number[] => [x0, z0, x1, z0, x1, z1, x0, z1, x0, z0];

test("a way hugs an outline it runs within half a metre of, or crosses; one further off does not", () => {
  const neighbour = [ring(10, 0, 20, 30)];
  expect(NEIGHBOUR_CLEAR).toBe(0.5);
  expect(hugs({ x: 9.7, z: -10 }, { x: 9.7, z: 40 }, neighbour)).toBe(true);
  expect(hugs({ x: 9.4, z: -10 }, { x: 9.4, z: 40 }, neighbour)).toBe(false);
  expect(hugs({ x: 0, z: 15 }, { x: 30, z: 15 }, neighbour)).toBe(true);
  // Past its corner by less than half a metre; and with no room asked, only a crossing counts.
  expect(hugs({ x: 0, z: 30.3 }, { x: 30, z: 30.3 }, neighbour)).toBe(true);
  expect(hugs({ x: 0, z: 30.3 }, { x: 30, z: 30.3 }, neighbour, 0)).toBe(false);
  expect(hugs({ x: 0, z: 29 }, { x: 30, z: 29 }, neighbour, 0)).toBe(true);
});

test("a door takes the street whose way keeps off a neighbour's wall; with no other street, the way along it", () => {
  // A door at 132, 148 on level ground, a street sample 24 m north of it and one 8 m west of that, and a neighbour whose
  // wall runs 0.4 m beside the straight way: none of its samples is on the way.
  const grid = gridAt([0, 0, 256, 256]), n = grid.nx * grid.nz;
  const at = (x: number, z: number): number => Math.round((grid.z1 - z) / 2) * grid.nx + Math.round((grid.x1 - x) / 2);
  const frame: Frame = { x: 128, z: 128, yaw: 0, c: 1, s: 0, width: 40, depth: 40, rings: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]] };
  const plan = (streets: readonly [number, number][], wall: number | null): { x: number; z: number } | null => {
    const surface = new Uint8Array(n), height = new Float32Array(n).fill(10), owner = new Int32Array(n).fill(-1);
    for (const [x, z] of streets) surface[at(x, z)] = S.STREET;
    if (wall !== null) for (let z = 152; z <= 168; z += 2) for (let x = Math.ceil(wall / 2) * 2; x <= 144; x += 2) owner[at(x, z)] = 1;
    const footprints = [null, { building: { rings: wall === null ? [] : [[[wall, 151], [144, 151], [144, 169], [wall, 169], [wall, 151]]] } }];
    const site = { ground: { grid, surface, height, water: new Uint8Array(n), heaps: { owner } }, groundAt: () => 10, footprints, toLattice: (e: number, north: number) => [e, north] } as unknown as Site;
    const m = new Mason(frame, 10);
    m.entries.push({ x: 132, y: 10, z: 148, yaw: 0, coreX: 132, coreZ: 144 });
    return accessPlanner(site, [], [], new Set())(m, 0)[0]?.street ?? null;
  };
  const both: [number, number][] = [[132, 172], [124, 172]];
  expect(plan(both, null)).toMatchObject({ x: 132, z: 172 });
  expect(plan(both, 132.4)).toMatchObject({ x: 124, z: 172 });
  // With 2 m between the way and the wall the nearer street is taken.
  expect(plan(both, 134)).toMatchObject({ x: 132, z: 172 });
  expect(plan([[132, 172]], 132.4)).toMatchObject({ x: 132, z: 172 });
});

const piece = (shape: RuinShape, x: number, y: number, z: number, yaw = 0): StaticPiece => ({ kind: ruinKind(shape), x, y, z, yaw });

test("a way a neighbour's wall stands in is given up with what was laid for it, and the wall stays", () => {
  // A house with a wall along x = 100 from z = 100 to 116, and a neighbour's way to its door up that wall.
  const house = (): StaticPiece[] => [0, 1, 2, 3].map((k) => { const p = piece("wall4", 100, 1.4, 102 + k * 4, 90); know(p, 0, k, 0); return p; });
  const records = (pieces: StaticPiece[], wayX: number): RuinRecord[] => {
    const way = { street: { x: wayX, y: 0, z: 90 }, door: { x: wayX, y: 0, z: 124 }, core: { x: wayX, y: 0, z: 128 }, ramp: 1 };
    // The slabs the planner laid along the way: pieces no tile placed.
    pieces.push(piece("floor4", wayX, -0.2, 106), piece("floor4", wayX, -0.2, 110));
    const a = { id: 1, firstPiece: 0, blocks: 4, x: 104, y: 0, z: 108, yaw: 0, width: 8, depth: 16, approaches: [], entries: [], rooms: [], escapes: [], routes: [] };
    const b = { id: 2, firstPiece: 4, blocks: 2, x: wayX, y: 0, z: 130, yaw: 0, width: 8, depth: 8, approaches: [way], entries: [], rooms: [], escapes: [], routes: [] };
    return [a, b] as unknown as RuinRecord[];
  };
  const along = house(), close = records(along, 99.6);
  clearCirculation(along, close, 0);
  expect(along.map((p) => p.kind.split("_")[1])).toEqual(["wall4", "wall4", "wall4", "wall4"]);
  expect([close[1]!.approaches, close[1]!.blocks]).toEqual([[], 0]);
  // Two metres off the wall the way stays, and so does everything else.
  const clear = house(), off = records(clear, 98);
  clearCirculation(clear, off, 0);
  expect([clear.length, off[1]!.approaches.length, off[1]!.blocks]).toEqual([6, 1, 2]);
});
