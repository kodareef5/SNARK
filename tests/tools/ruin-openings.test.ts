// What a street through a building leaves standing (tools/mapworld/ruin-openings.ts): a portal on piers under a
// building it passes through, a clean cut where nothing can carry the storeys over it, and no building where no wall is left.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUIN_SHAPES, ruinKind, type RuinShape } from "../../content/ruins.ts";
import { readPassages, type Passage } from "../../tools/mapworld/passages.ts";
import { clearCirculation } from "../../tools/mapworld/ruin-clearance.ts";
import { PORTAL_SPAN } from "../../tools/mapworld/ruin-openings.ts";
import type { RuinRecord } from "../../tools/mapworld/ruins.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";

const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

const piece = (shape: RuinShape, x: number, y: number, z: number, yaw = 0): StaticPiece => ({ kind: ruinKind(shape), x, y, z, yaw });
const shapeOf = (p: StaticPiece): RuinShape => p.kind.split("_")[1] as RuinShape;
const foot = (p: StaticPiece): number => p.y - RUIN_SHAPES[shapeOf(p)][1] / 2;
const top = (p: StaticPiece): number => p.y + RUIN_SHAPES[shapeOf(p)][1] / 2;

/**
 * A building of 4 m bays round (cx, cz), its floor at 0: walls round every storey, a fin inside at every second bay's
 * corner, a slab over every bay of each. The walls along x are turned 0, those along z a quarter.
 */
function block(cols: number, rows: number, storeys: number, cx = 128, cz = 128): StaticPiece[] {
  const out: StaticPiece[] = [], [w, d] = [cols * 4, rows * 4];
  for (let level = 0; level < storeys; level++) {
    for (let i = 0; i < cols; i++) for (const side of [-1, 1]) out.push(piece("wall4", cx - w / 2 + 2 + i * 4, level * 4 + 1.4, cz + (side * d) / 2));
    for (let j = 0; j < rows; j++) for (const side of [-1, 1]) out.push(piece("wall4", cx + (side * w) / 2, level * 4 + 1.4, cz - d / 2 + 2 + j * 4, 90));
    for (let i = 2; i < cols; i += 2) for (let j = 2; j < rows; j += 2) out.push(piece("fin4", cx - w / 2 + i * 4, level * 4 + 2, cz - d / 2 + j * 4));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) out.push(piece("floor4", cx - w / 2 + 2 + i * 4, level * 4 + 3.8, cz - d / 2 + 2 + j * 4));
  }
  return out;
}
const record = (pieces: readonly StaticPiece[], cols: number, rows: number, more: Partial<RuinRecord> = {}): RuinRecord =>
  ({ id: 1, firstPiece: 0, blocks: pieces.length, x: 128, y: 0, z: 128, yaw: 0, width: cols * 4, depth: rows * 4, height: 8, approaches: [], entries: [], rooms: [], escapes: [], routes: [], wings: [], falls: [], ...more }) as unknown as RuinRecord;
/** A street along x at `z`, or along z at `x`, right through the map's middle. */
const alongX = (z: number, width: number): Passage => ({ points: [{ x: 96, y: 0, z }, { x: 160, y: 0, z }], width });
const alongZ = (x: number, width: number): Passage => ({ points: [{ x, y: 0, z: 96 }, { x, y: 0, z: 160 }], width });

/** Metres on the plan from a piece's box to (x, z). */
function gap(p: StaticPiece, x: number, z: number): number {
  const [w, , d] = RUIN_SHAPES[shapeOf(p)], a = (p.yaw * Math.PI) / 180, [c, s] = [Math.cos(a), Math.sin(a)], [dx, dz] = [x - p.x, z - p.z];
  return Math.hypot(Math.max(Math.abs(dx * c - dz * s) - w / 2, 0), Math.max(Math.abs(dx * s + dz * c) - d / 2, 0));
}
/** The pieces overhead with nothing standing from the ground within 6 m, as the audit counts them. */
const hanging = (pieces: readonly StaticPiece[]): StaticPiece[] => {
  const standing = pieces.filter((p) => foot(p) <= 1.2 && top(p) >= 2.4);
  return pieces.filter((p) => foot(p) >= 2 && foot(p) <= 4.6 && !standing.some((s) => gap(p, s.x, s.z) <= 6));
};
const piers = (pieces: readonly StaticPiece[]): StaticPiece[] => pieces.filter((p) => shapeOf(p).startsWith("pier"));

test("a street through a wide building runs under it between piers: the storeys above stay and nothing hangs", () => {
  // 24 m square, two storeys; a street 6 m wide west to east through its middle.
  const pieces = block(6, 6, 2), r = record(pieces, 6, 6), upper = pieces.filter((p) => foot(p) >= 3).length;
  clearCirculation(pieces, [r], 0, [], [], [alongX(128, 6)]);
  const stood = piers(pieces);
  expect(stood.length).toBeGreaterThanOrEqual(4);
  // Each a metre outside the street's width, from the floor to the slab it carries.
  for (const p of stood) expect([Math.abs(Math.abs(p.z - 128) - 4.01) < 0.01, foot(p), top(p)]).toEqual([true, 0, 4]);
  expect(new Set(stood.map((p) => Math.sign(p.z - 128))).size).toBe(2);
  expect(pieces.filter((p) => foot(p) >= 3).length).toBe(upper);
  // A storey high under it, across the street's whole width.
  expect(pieces.filter((p) => Math.abs(p.z - 128) < 3 && foot(p) < 3.3 && top(p) > 0.38)).toEqual([]);
  expect(hanging(pieces)).toEqual([]);
  expect(r.blocks).toBe(pieces.length);
});

test("a street along a narrow building leaves no building: no piece, door, way or room", () => {
  // 40 by 8 m, one storey; a street 8.6 m wide along its length takes every wall.
  const pieces = block(10, 2, 1);
  const way = { street: { x: 128, y: 0, z: 100 }, door: { x: 128, y: 0, z: 124 }, core: { x: 128, y: 0, z: 128 }, ramp: 1 };
  const r = record(pieces, 10, 2, { approaches: [way], entries: [{ x: 128, y: 0, z: 124, yaw: 0, coreX: 128, coreZ: 128 }], rooms: [{ kind: "room", points: [{ x: 120, y: 0, z: 128 }, { x: 136, y: 0, z: 128 }] }] });
  clearCirculation(pieces, [r], 0, [], [], [alongX(128, 8.6)]);
  expect(pieces).toEqual([]);
  expect([r.blocks, r.approaches, r.entries, r.rooms, r.routes]).toEqual([0, [], [], [], []]);
});

test("a street too wide to span cuts a building through: nothing is left over it and both sides stand", () => {
  // 40 by 24 m, two storeys; a street 15.2 m wide south to north through its middle.
  const pieces = block(10, 6, 2), r = record(pieces, 10, 6);
  expect(15.2 + 0.92).toBeGreaterThan(PORTAL_SPAN);
  clearCirculation(pieces, [r], 0, [], [], [alongZ(128, 15.2)]);
  expect(pieces.filter((p) => Math.abs(p.x - 128) < 7.6 && top(p) > 0.38)).toEqual([]);
  for (const side of [-1, 1]) {
    const part = pieces.filter((p) => Math.sign(p.x - 128) === side);
    expect(part.filter((p) => shapeOf(p) === "wall4" && foot(p) === 0).length).toBeGreaterThan(8);
    expect(part.filter((p) => foot(p) >= 7).length).toBeGreaterThan(8);
    // The cut edge stands on piers of its own.
    expect(piers(part).length).toBeGreaterThanOrEqual(2);
  }
  expect(hanging(pieces)).toEqual([]);
});

test("a street that clips a building's side takes what is over it there, and the rest stands", () => {
  // 24 m square, two storeys; a street 8.6 m wide along its south wall, its middle a metre inside.
  const pieces = block(6, 6, 2), r = record(pieces, 6, 6);
  clearCirculation(pieces, [r], 0, [], [], [alongX(117, 8.6)]);
  // Nothing over the street at any storey, bar the slabs on the ground.
  expect(pieces.filter((p) => Math.abs(p.z - 117) < 4.3 && top(p) > 0.38)).toEqual([]);
  expect(pieces.filter((p) => foot(p) >= 7).length).toBeGreaterThan(20);
  expect(piers(pieces).every((p) => p.z > 117 + 4.3)).toBe(true);
  expect(hanging(pieces)).toEqual([]);
});

test("a stair in the street goes with its route, and a room over the cut with its floor", () => {
  const pieces = block(10, 6, 2);
  // A stair at the building's middle, and two rooms upstairs: one over the street, one in the east part.
  pieces.push(piece("flight", 126.5, 2, 127.5), piece("landing", 128, 3.8, 131));
  const r = record(pieces, 10, 6, {
    routes: [{ x: 128, y: 0, z: 128, yaw: 0, floors: 1 }],
    rooms: [{ kind: "room", points: [{ x: 126, y: 4, z: 122 }, { x: 130, y: 4, z: 122 }] }, { kind: "room", points: [{ x: 142, y: 4, z: 122 }, { x: 146, y: 4, z: 122 }] }],
  });
  clearCirculation(pieces, [r], 0, [], [], [alongZ(128, 15.2)]);
  expect(pieces.filter((p) => shapeOf(p) === "flight" || shapeOf(p) === "landing")).toEqual([]);
  expect(r.routes).toEqual([]);
  expect(r.rooms.map((room) => room.points[0]!.x)).toEqual([142]);
});

test("a building a street passes by is left as it was, and one with no passage is not settled", () => {
  const far = block(6, 6, 2), kept = far.length;
  clearCirculation(far, [record(far, 6, 6)], 0, [], [], [alongX(60, 8.6)]);
  expect(far.length).toBe(kept);
  const plain = block(6, 6, 2);
  clearCirculation(plain, [record(plain, 6, 6)], 0);
  expect(plain.length).toBe(kept);
});

test("a passage is kept clear as a way is, and knows every street's carriageway by it", () => {
  const source = mkdtempSync(join(tmpdir(), "snark-openings-"));
  folders.push(source);
  mkdirSync(join(source, "base"));
  const line = (id: string, coordinates: number[][], more: object): object => ({ geometry: { type: "LineString", coordinates }, properties: { id, width_m: 6, bridge: false, tunnel: false, mtfcc: "S1400", highway: "tertiary", ...more } });
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ features: [line("osm:1:0", [[0, 0], [40, 0]], { passage: true }), line("osm:2:0", [[20, -30], [20, 30]], {}), line("osm:3:0", [[0, 500], [40, 500]], {})] }));
  const growthRoutes: { points: { x: number; y: number; z: number }[]; width: number }[] = [];
  const [passage, none] = readPassages({ source, toLattice: (e, n) => [e, n], groundAt: () => 2, growthRoutes });
  expect(none).toBeUndefined();
  expect(growthRoutes.map((g) => [g.width, g.points.length, g.points[0]!.y])).toEqual([[6, 11, 2]]);
  // On the cross street 10 m off the passage, and beside it; not 6 m from any.
  expect([passage!.onStreet!(20, 10, 0.4), passage!.onStreet!(23.2, 10, 0.4), passage!.onStreet!(26, 10, 0.4), passage!.onStreet!(10, 3.2, 0.4)]).toEqual([true, true, false, true]);
});
