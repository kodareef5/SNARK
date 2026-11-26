// A street yields where its line runs through a building's footprint (tools/mapworld/streets/yield.ts): it shifts
// sideways, narrows or ends at the wall, the same for every reader of the roads and whatever else the data holds.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Site } from "../../tools/mapworld/statics.ts";
import { roadIndex } from "../../tools/mapworld/street-cars.ts";
import { readStreetGraph } from "../../tools/mapworld/street-graph.ts";
import { readRuns } from "../../tools/mapworld/streets/fit.ts";
import { readFootprints, readRoads, yieldRoads, type RoadFeature } from "../../tools/mapworld/streets/yield.ts";

const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

type Rect = readonly [west: number, south: number, east: number, north: number];
/** A service way 5.3 m wide, as the street data writes one. */
const road = (id: string, line: number[][], more: Record<string, unknown> = {}): RoadFeature => ({
  geometry: { type: "LineString", coordinates: line },
  properties: { id, mtfcc: "S1640", highway: "service", lanes: 1, width_m: 5.3, bridge: false, tunnel: false, ...more },
});
const block = (id: number, [w, s, e, n]: Rect): object => ({ type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });

/** A work folder of these roads and footprints, the footprints numbered from 1. */
function folder(roads: readonly RoadFeature[], blocks: readonly Rect[], labels?: Record<string, object>): string {
  const source = mkdtempSync(join(tmpdir(), "snark-yield-"));
  folders.push(source);
  mkdirSync(join(source, "base"));
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features: roads.map((r) => ({ type: "Feature", ...r })) }));
  writeFileSync(join(source, "base/buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features: blocks.map((b, k) => block(k + 1, b)) }));
  if (labels) { mkdirSync(join(source, "blocks")); writeFileSync(join(source, "blocks/labels.json"), JSON.stringify(labels)); }
  return source;
}

const same = (e: number, n: number): [number, number] => [e, n];
const runsOf = (f: RoadFeature): number[][][] => (f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]]);
/** The least distance from a line to a rectangle, 0 inside it, looked at every quarter metre. */
function gap(line: number[][], [w, s, e, n]: Rect): number {
  let least = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1] as [number, number], [bx, bz] = line[i] as [number, number], steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 4);
    for (let k = 0; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps;
      least = Math.min(least, Math.hypot(Math.max(w - x, 0, x - e), Math.max(s - z, 0, z - n)));
    }
  }
  return least;
}

const STREET = [[0, 0], [100, 0]];
/** A building whose north wall stands 2 m past the street's line, and one the street runs through the middle of. */
const BESIDE: Rect = [30, -20, 70, 2], ACROSS: Rect = [30, -20, 70, 20];

test("a street 2 m inside a footprint is shifted clear, its ends where they were", () => {
  const source = folder([road("osm:1:0", STREET)], [BESIDE]);
  const [run, more] = readRuns(source, same);
  expect(more).toBeUndefined();
  const line = Array.from({ length: run!.xz.length / 2 }, (_, k) => [run!.xz[k * 2]!, run!.xz[k * 2 + 1]!]);
  expect(line[0]).toEqual([0, 0]);
  expect(line.at(-1)).toEqual([100, 0]);
  // Its whole width clear of the wall, by a shift no greater than the six metres a line may move.
  expect(gap(line, BESIDE)).toBeGreaterThanOrEqual(2.65 - 0.02);
  expect(Math.max(...line.map((p) => Math.abs(p[1]!)))).toBeLessThanOrEqual(6);
  expect(run!.half).toBe(2.65);
  expect(run!.yielded).toBe("shifted");
});

test("the fit, the street graph and the parked cars read one yielded line", () => {
  const source = folder([road("osm:1:0", STREET)], [BESIDE]);
  const line = runsOf(readRoads(source)[0]!)[0]!;
  expect(gap(line, BESIDE)).toBeGreaterThan(2.6);
  const ends = (segments: readonly { ax: number; az: number; bx: number; bz: number }[]): number[][] => [[segments[0]!.ax, segments[0]!.az], ...segments.map((s) => [s.bx, s.bz])];
  expect(ends(readStreetGraph(source, same).segments)).toEqual(line);
  expect(ends(roadIndex({ source, toLattice: same } as unknown as Site).segments)).toEqual(line);
  expect(Array.from(readRuns(source, same)[0]!.xz)).toEqual(line.flat());
});

test("a street that cannot clear a building ends at the wall on each side", () => {
  const source = folder([road("osm:1:0", STREET)], [ACROSS]);
  const [f] = readRoads(source);
  const [west, east, none] = runsOf(f!);
  expect(none).toBeUndefined();
  expect(f!.properties.yielded).toBe("cut");
  // Half a metre short of each wall, and nothing between.
  expect(west![0]).toEqual([0, 0]);
  expect(west!.at(-1)![0]).toBeCloseTo(29.5, 1);
  expect(east![0]![0]).toBeCloseTo(70.5, 1);
  expect(east!.at(-1)).toEqual([100, 0]);
  expect(gap([...west!], ACROSS)).toBeGreaterThanOrEqual(0.49);
  expect(gap([...east!], ACROSS)).toBeGreaterThanOrEqual(0.49);
  // Each end is a dead end of the graph, and what stands along the far part keeps its metres along the whole piece.
  const graph = readStreetGraph(source, same);
  expect(graph.nodeAt(29.5, 0)?.ways.length).toBe(1);
  expect(graph.nodeAt(70.5, 0)?.ways.length).toBe(1);
  expect(graph.segments.map((s) => Math.round(s.along))).toEqual([0, 71]);
  expect(roadIndex({ source, toLattice: same } as unknown as Site).segments.map((s) => Math.round(s.from))).toEqual([0, 71]);
});

test("a street clear of buildings is untouched, bit for bit", () => {
  const clear = [[0.1234567890123, 10.000000000001], [33.3333333333333, 10.1], [100.7, 9.87654321]];
  const source = folder([road("osm:1:0", clear), road("osm:2:0", STREET)], [BESIDE]);
  const written = (JSON.parse(readFileSync(join(source, "base/roads.geojson"), "utf8")) as { features: RoadFeature[] }).features;
  const read = readRoads(source);
  expect(JSON.stringify(read[0])).toBe(JSON.stringify(written[0]));
  expect(JSON.stringify(read[1])).not.toBe(JSON.stringify(written[1]));
  expect([...yieldRoads(written, readFootprints(source)).changed.keys()]).toEqual([1]);
  const run = readRuns(source, same)[0]!;
  expect(Array.from(run.xz)).toEqual(clear.flat());
  expect(run.yielded).toBeNull();
});

test("a folder with no footprints gives its roads as they are written", () => {
  const source = folder([road("osm:1:0", STREET)], []);
  rmSync(join(source, "base/buildings.geojson"));
  expect(runsOf(readRoads(source)[0]!)).toEqual([STREET]);
});

test("an alley between two buildings moves to the middle and narrows to the room there", () => {
  // Walls 4 m apart, the line a metre inside the southern one.
  const south: Rect = [30, -20, 70, 1], north: Rect = [30, 5, 70, 25];
  const [f] = readRoads(folder([road("osm:1:0", STREET)], [south, north]));
  const line = runsOf(f!)[0]!;
  expect(gap(line, south)).toBeCloseTo(2, 1);
  expect(gap(line, north)).toBeCloseTo(2, 1);
  expect(f!.properties.width_m).toBe(4);
  expect(f!.properties.yielded).toBe("shifted narrowed");
});

test("a street squeezed past a wall for a short way keeps its width", () => {
  const south: Rect = [45, -20, 55, 1], north: Rect = [45, 5, 55, 25];
  const [f] = readRoads(folder([road("osm:1:0", STREET)], [south, north]));
  expect(gap(runsOf(f!)[0]!, south)).toBeCloseTo(2, 1);
  expect(f!.properties.width_m).toBe(5.3);
  expect(f!.properties.yielded).toBe("shifted");
});

test("a junction in a wall moves clear with every street that meets there", () => {
  // Three ways meet 0.3 m inside the north wall of a building.
  const wall: Rect = [40, -30, 80, 0.3];
  const read = readRoads(folder([road("osm:1:0", [[0, 0], [50, 0]]), road("osm:2:0", [[50, 0], [50, 60]]), road("osm:3:0", [[50, 0], [100, 0]])], [wall]));
  const [a, b, c] = read.map((f) => runsOf(f)[0]!);
  expect(a!.at(-1)).toEqual(b![0]!);
  expect(c![0]).toEqual(b![0]!);
  expect(b![0]![0]).toBeCloseTo(50, 6);
  expect(b![0]![1]).toBeCloseTo(1.8, 6);
  for (const line of [a!, b!, c!]) expect(gap(line, wall)).toBeGreaterThanOrEqual(1.5 - 0.02);
  expect(a![0]).toEqual([0, 0]);
  expect(c!.at(-1)).toEqual([100, 0]);
});

test("a street marked bridge, tunnel or passage is left as it is", () => {
  for (const mark of [{ bridge: true }, { tunnel: true }, { passage: true }, { tunnel_kind: "building_passage" }]) {
    const read = readRoads(folder([road("osm:1:0", STREET, mark)], [ACROSS]));
    expect(runsOf(read[0]!)).toEqual([STREET]);
    expect(read[0]!.properties.yielded).toBeUndefined();
  }
});

test("a street that meets a passage at a building's wall stays joined to it", () => {
  // The passage starts on the wall; the street reaches it from outside.
  const read = readRoads(folder([road("osm:1:0", [[0, 0], [30, 0]]), road("osm:1:1", [[30, 0], [70, 0]], { passage: true })], [ACROSS]));
  expect(runsOf(read[0]!)).toEqual([[[0, 0], [30, 0]]]);
  expect(runsOf(read[1]!)).toEqual([[[30, 0], [70, 0]]]);
});

test("a way that meets a parking structure is left as it is", () => {
  for (const label of [{ kind: "parking_garage", primary_use: "Unclassified" }, { kind: "office", primary_use: "Parking" }]) {
    const source = folder([road("osm:1:0", STREET)], [ACROSS], { "1": label });
    expect(runsOf(readRoads(source)[0]!)).toEqual([STREET]);
  }
});

test("a street yields the same whatever other rows and footprints the data holds", () => {
  const street = road("osm:5:0", [[0, 0], [100, 0]]);
  const alone = yieldRoads([street], [{ rings: [[[30, -20], [70, -20], [70, 2], [30, 2], [30, -20]]], parking: false }]).changed.get(0)!;
  // More streets before it, in another order, and buildings far off, as a wider cut holds.
  const others = [road("osm:9:0", [[0, 500], [100, 500]]), road("osm:8:0", [[300, 0], [300, 90]])];
  const far = [[1000, 1000, 1040, 1040], [30, 480, 70, 502], BESIDE].map(([w, s, e, n]) => ({ rings: [[[w!, s!], [e!, s!], [e!, n!], [w!, n!], [w!, s!]]], parking: false }));
  const wider = yieldRoads([...others, street], far);
  expect(JSON.stringify(wider.changed.get(2))).toBe(JSON.stringify(alone));
});

test("a run after a cut keeps its number and its metres when another cut is made before it", () => {
  const first: Rect = [20, -20, 30, 20], second: Rect = [60, -20, 70, 20];
  const last = (blocks: Rect[]) => readRuns(folder([road("osm:1:0", STREET)], blocks), same).at(-1)!;
  const [one, two] = [last([second]), last([first, second])];
  expect(two.run).toBe(one.run);
  expect(Array.from(two.xz)).toEqual(Array.from(one.xz));
  expect(readRuns(folder([road("osm:1:0", STREET)], [first, second]), same).map((r) => r.run)).toEqual([0, 31000, 71000]);
});

test("a piece wholly inside a building is dropped, and its row stays in its place", () => {
  const source = folder([road("osm:1:0", [[40, 0], [60, 0]]), road("osm:2:0", [[0, 30], [100, 30]])], [ACROSS]);
  const read = readRoads(source);
  expect(read.length).toBe(2);
  expect(runsOf(read[0]!)).toEqual([]);
  expect(read[0]!.properties.yielded).toBe("dropped");
  expect(readRuns(source, same).map((r) => r.line)).toEqual([1]);
  expect(readStreetGraph(source, same).pieces.map((p) => p.id)).toEqual(["osm:1:0", "osm:2:0"]);
});
