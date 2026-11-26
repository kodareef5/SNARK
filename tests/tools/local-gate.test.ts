import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMap, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { readGrey, writeGrey } from "../../tools/map/png.ts";
import type { PartDiff } from "../../tools/maps/diff.ts";
import { REACH, below, midFootprint, placements, takeFootprint, takePool, tooFar } from "../../tools/maps/local-gate.ts";
import { unlikePlaces } from "../../tools/maps/unlike.ts";
import { wideMap } from "../fixtures/map.ts";

const square = (e: number, n: number, side: number, id: number) => ({ geometry: { type: "Polygon", coordinates: [[[e, n], [e + side, n], [e + side, n + side], [e, n + side], [e, n]]] }, properties: { id } });

test("the footprint taken out is the mid-size one nearest the cut's middle, whatever the file's order", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-gate-"));
  try {
    mkdirSync(join(dir, "base"));
    writeFileSync(join(dir, "map.json"), JSON.stringify({ bounds: [1000, 2000, 2000, 3000], frame: [10, 20] }));
    const rows = [square(1480, 2480, 10, 1), square(1470, 2470, 60, 2), square(1100, 2100, 25, 3), square(1560, 2560, 25, 4)];
    const find = (features: unknown[]) => { writeFileSync(join(dir, "base/buildings.geojson"), JSON.stringify({ features })); return midFootprint(dir); };
    // 1 is too small and 2 too large; 4 is nearer the middle than 3. Its place counts west from the east edge, north from the south.
    expect([find(rows).id, find([...rows].reverse()).id]).toEqual([4, 4]);
    expect([find(rows).x, find(rows).z, find(rows).area]).toEqual([10 * 64 + (2000 - 1572.5), 20 * 64 + (2572.5 - 2000), 625]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a part that differs far from the edit fails, one near it or clipped does not", () => {
  const row = (state: PartDiff["state"], from: number, clipped = false): PartDiff => ({ kind: "statics", col: 1, row: 1, state, clipped, inside: 0, from });
  const rows = [row("changed", 0), row("changed", 599), row("changed", 2423), row("same", 5000), row("changed", 3000, true), { ...row("changed", 4000), kind: "head" as const }];
  expect(tooFar(rows, (r) => r.from ?? 0).map((r) => r.from)).toEqual([2423]);
});

test("the gate cuts at the middle, then the most shore-like place, then the driest, then the rest of the spread", () => {
  // A city of 255 chunks with water along its east: an inner rectangle's share falls from the east column to the west.
  const wet = (col: number): number => Math.max(0, (2110 - col) / 100);
  const places = placements([2036, 2021], [255, 255], wet);
  expect(places.map((p) => p.name)).toEqual(["middle", "shore", "inland", "ws", "em", "wm", "en", "mn", "wn"]);
  expect(places.slice(0, 3)).toEqual([{ name: "middle", col: 2144, row: 2128 }, { name: "shore", col: 2080, row: 2064 }, { name: "inland", col: 2144, row: 2064 }]);
  // Every outer rectangle is the city's, on whole sectors; with no water known there is no shore, and the first of the spread is as dry as any.
  for (const p of places) expect([p.col % 16, p.row % 16, p.col - 16 >= 2036, p.col + 64 <= 2036 + 255]).toEqual([0, 0, true, true]);
  expect(placements([2036, 2021], [255, 255]).map((p) => p.name).slice(0, 3)).toEqual(["middle", "inland", "ms"]);
  // A city too small for the spread has its middle alone, and one too small for an outer rectangle none.
  expect(placements([2048, 2048], [96, 96]).map((p) => p.name)).toEqual(["middle"]);
  expect(placements([2048, 2048], [64, 64])).toEqual([]);
});

test("a footprint taken out leaves the list, the mask's samples it alone covered and its label", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-gate-"));
  try {
    mkdirSync(join(dir, "base"));
    mkdirSync(join(dir, "blocks"));
    writeFileSync(join(dir, "map.json"), JSON.stringify({ bounds: [1000, 2000, 1200, 2200], frame: [10, 20] }));
    // 7 covers 1041..1081 by 2041..2081, off the samples' own lines; 8 overlaps its east quarter; 9 stands apart.
    const boxes = [[1041, 2041, 40], [1071, 2031, 30], [1151, 2151, 20]];
    writeFileSync(join(dir, "base/buildings.geojson"), JSON.stringify({ features: boxes.map(([e, n, side], k) => square(e!, n!, side!, 7 + k)) }));
    writeFileSync(join(dir, "blocks/labels.json"), JSON.stringify({ 7: { name: "Seven" }, 8: { name: "Eight" } }));
    const inBox = (e: number, n: number, [x, y, side]: number[]): boolean => e > x! && e < x! + side! && n > y! && n < y! + side!;
    const burn = (which: number[][]): Uint8Array => Uint8Array.from({ length: 101 * 101 }, (_, k) => (which.some((b) => inBox(1000 + (k % 101) * 2, 2200 - Math.floor(k / 101) * 2, b)) ? 1 : 0));
    const samples = (mask: Uint8Array): number => mask.reduce((n, v) => n + v, 0);
    writeFileSync(join(dir, "base/buildings.png"), writeGrey(101, 101, burn(boxes)));
    const edit = takeFootprint(dir, 7);
    expect([edit.x, edit.z, Math.round(edit.radius)]).toEqual([10 * 64 + (1200 - 1061), 20 * 64 + (2061 - 2000), 28]);
    expect((JSON.parse(readFileSync(join(dir, "base/buildings.geojson"), "utf8")) as { features: { properties: { id: number } }[] }).features.map((f) => f.properties.id)).toEqual([8, 9]);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, "blocks/labels.json"), "utf8")) as object)).toEqual(["8"]);
    // The mask is the one a burn of the two footprints left would give: 8 keeps what it shared with 7.
    const mask = readGrey(new Uint8Array(readFileSync(join(dir, "base/buildings.png"))), "buildings.png");
    expect(Array.from(mask.data)).toEqual(Array.from(burn(boxes.slice(1))));
    expect(edit.what).toContain(`${samples(burn(boxes)) - samples(burn(boxes.slice(1)))} samples`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the pool taken out is the one nearest the middle that stands apart from the footprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-gate-"));
  try {
    mkdirSync(join(dir, "base"));
    writeFileSync(join(dir, "map.json"), JSON.stringify({ bounds: [0, 0, 4000, 4000], frame: [0, 0] }));
    const pool = (e: number, n: number, id: string, kind = "pool") => ({ ...square(e, n, 10, 0), properties: { id, kind } });
    const file = join(dir, "base/perched_water.geojson"), write = (features: unknown[]): void => writeFileSync(file, JSON.stringify({ features }));
    const left = (): string[] => (JSON.parse(readFileSync(file, "utf8")) as { features: { properties: { id: string } }[] }).features.map((f) => f.properties.id);
    // The footprint at the middle (lattice 2000, 2000): b is nearer the middle than c, a too near the footprint, d a pond.
    write([pool(1990, 2100, "a"), pool(500, 2000, "b"), pool(300, 300, "c"), pool(3400, 2000, "d", "pond")]);
    expect([takePool(dir, 2000, 2000)!.what, left()]).toEqual(["pool b (100 m²)", ["a", "c", "d"]]);
    // None stands apart: the farthest goes. No pool: nothing does.
    write([pool(1990, 2100, "a"), pool(1990, 2400, "e"), pool(3400, 2000, "d", "pond")]);
    expect([takePool(dir, 2000, 2000)!.what, left()]).toEqual(["pool e (100 m²)", ["a", "d"]]);
    write([pool(3400, 2000, "d", "pond")]);
    expect(takePool(dir, 2000, 2000)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a piece and a vehicle moved are told with their places, and fail past the reach where a part would not", () => {
  const base = { ...wideMap(), vehicles: [{ kind: "core:compact", x: 3000.5, z: 500.25, yaw: 90 }] }, list = base.statics as readonly MapStatic[];
  const at = list.findIndex((s) => s.x > 1100 && s.x < 1900 && s.z > 300 && s.z < 700), piece = { ...list[at]!, x: list[at]!.x + 1 / 512 };
  const heights = base.heights.slice();
  heights[100 * (70 * 32 + 1) + 400]!++;
  const moved = { ...base, heights, statics: list.map((s, k) => (k === at ? piece : s)), vehicles: [{ ...base.vehicles[0]!, x: 3001 }] };
  const [a, b] = [parseMap(writeMap(base), false), parseMap(writeMap(moved), false)];
  expect(unlikePlaces(a, a)).toEqual([]);
  const rows = unlikePlaces(a, b), [fx, fz] = [2040 * 64, 2050 * 64];
  expect(rows.map((r) => `${r.kind} ${r.x - fx} ${r.z - fz} ${r.what.slice(0, 6)}`).sort()).toEqual([`piece ${list[at]!.x} ${piece.z} only a`, `piece ${piece.x} ${piece.z} only b`, "vehicle 3000.5 500.25 only a", "vehicle 3001 500.25 only b", "height 800 200 a 2.51"].sort());
  // From an edit beside the piece, the vehicle is past the reach and the piece is not.
  const bad: string[] = [], far = Math.round(Math.hypot(3001 - piece.x, 500.25 - piece.z));
  const lines = below(rows, (x, z) => Math.hypot(x - fx - piece.x, z - fz - piece.z), "wide edited", bad);
  const deep = Math.round(Math.hypot(800 - piece.x, 200 - piece.z));
  expect(lines.filter((l) => !l.startsWith(" "))).toEqual(["piece: 2 differ, the farthest 0 m; 0 at 600 m or more", `height: 1 differ, the farthest ${deep} m; ${deep >= REACH ? 1 : 0} at 600 m or more`, `vehicle: 2 differ, the farthest ${far} m; 2 at 600 m or more`]);
  expect(bad.at(-1)).toBe(`wide edited: 2 vehicles differ ${REACH} m or more away, the farthest ${far} m`);
});
