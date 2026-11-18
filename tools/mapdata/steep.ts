// A city's steepest streets and stairs on its built ground, and whether a survivor walks them: each street's grade over
// 30 m and each mapped stair's over 6 m and from end to end, from the map file's own heights; then the real character
// controller walks the steepest up and back down with the ground, the ruins and the plants in its way (or without the
// plants, to tell what stopped it).
// bun tools/mapdata/steep.ts <file.snmap> [count] [--no-plants | --ground-only]   writes reports/steep[-no-plants|-ground].json

import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Base } from "../mapworld/base.ts";

type P = [number, number];
const map = parseMap(new Uint8Array(readFileSync(process.argv[2] ?? "")));
const count = Number(process.argv.slice(3).find((a) => !a.startsWith("--")) ?? 12);
const ground = process.argv.includes("--ground-only");
const plants = !ground && !process.argv.includes("--no-plants");
const city = `assets/source/maps/${map.id.split(":")[1]}`;
const reg = compileContent(CORE_CONTENT).registry!;
const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
if (!ground) placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg);
const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes && plants ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const base = new Base(city);
const { nx, nz, sizeX, sizeZ, west, south, east, north } = base.grid;
const engine = ([e, n]: P): P => [east - e, n - south];
const degrees = (grade: number): number => (Math.atan(grade) * 180) / Math.PI;

// Points every 2 m along a line, with the ground's height at each.
function profile(line: P[]): { x: number; z: number; y: number; s: number }[] {
  const out: { x: number; z: number; y: number; s: number }[] = [];
  let s = 0;
  for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1]!, line[k]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = k === 1 ? 0 : 2; t <= len; t += 2) {
      const x = a[0] + ((b[0] - a[0]) * t) / len; const z = a[1] + ((b[1] - a[1]) * t) / len;
      if (x < 4 || z < 4 || x > sizeX - 4 || z > sizeZ - 4) continue;
      out.push({ x, z, y: hf.heightAt(x, z), s: s + t });
    }
    s += len;
  }
  return out;
}
function steepest(pts: ReturnType<typeof profile>, over: number): { grade: number; at: number } {
  let best = { grade: 0, at: 0 };
  for (let i = 0, j = 0; i < pts.length; i++) {
    while (j < pts.length && pts[j]!.s - pts[i]!.s < over) j++;
    if (j >= pts.length) break;
    const g = Math.abs(pts[j]!.y - pts[i]!.y) / (pts[j]!.s - pts[i]!.s);
    if (g > best.grade) best = { grade: g, at: i };
  }
  return best;
}

// The survivor walks a line from its low end to its high end and back, point by point; a leg fails if it stalls.
function walk(pts: ReturnType<typeof profile>): { ok: boolean; message: string; seconds: number } {
  const path = pts[0]!.y <= pts.at(-1)!.y ? pts : [...pts].reverse();
  const b = new Body(); b.x = path[0]!.x; b.z = path[0]!.z; b.y = hf.heightAt(b.x, b.z) + 1;
  const chunks = [...new Set(path.map((p) => chunkAt(map.dims, p.x, p.z)))];
  for (const c of chunks) nodes?.retain(c, 1, 1, () => false);
  for (let t = 0; t < 60; t++) stepBody(world, b, 0, 0, 0, 0, 0, params, TICK_DT);
  let ticks = 0; let message = "";
  for (const leg of [path, [...path].reverse()]) {
    for (const p of leg.filter((_, i) => i % 2 === 0 || i === leg.length - 1)) {
      const limit = 200 + Math.ceil(Math.hypot(b.x - p.x, b.z - p.z) * 40);
      let t = 0;
      for (; t < limit && Math.hypot(b.x - p.x, b.z - p.z) > .6; t++) {
        const yaw = Math.round((Math.atan2(p.x - b.x, p.z - b.z) * 65536) / (2 * Math.PI)) & 65535;
        stepBody(world, b, 0, 100, yaw, 0, 0, params, TICK_DT);
      }
      ticks += t;
      if (Math.hypot(b.x - p.x, b.z - p.z) > 1.2) {
        // The ground's steepest 2 m step within 6 m of where it stopped: over the slope limit, the slope stopped it.
        let local = 0;
        for (let k = 1; k < path.length; k++) {
          const [a, c] = [path[k - 1]!, path[k]!];
          if (Math.hypot(c.x - b.x, c.z - b.z) < 6) local = Math.max(local, Math.abs(c.y - a.y) / Math.max(.5, c.s - a.s));
        }
        message = `stalled at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)} short of ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}, ground there ${degrees(local).toFixed(0)}°`;
        break;
      }
    }
    if (message) break;
  }
  for (const c of chunks) nodes?.retain(c, 1, -1, () => false);
  return { ok: !message, message, seconds: Number((ticks * TICK_DT).toFixed(1)) };
}

const roads = JSON.parse(readFileSync(`${city}/base/roads.geojson`, "utf8")) as { features: { geometry: { type: string; coordinates: P[] | P[][] }; properties: { name: string | null; mtfcc: string } }[] };
// A street whose line crosses a cliff (a 4 m stretch steeper than 45°) is a paper street drawn up a bluff or a line
// beside a retaining wall: it is counted apart and not walked.
const streets: { name: string; grade: number; degrees: number; rise: number; at: P; cliff: number; pts: ReturnType<typeof profile> }[] = [];
for (const f of roads.features) {
  if (!["S1400", "S1200"].includes(f.properties.mtfcc)) continue;
  const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates as P[]] : (f.geometry.coordinates as P[][]);
  for (const line of lines) {
    const pts = profile(line.map(engine));
    if (pts.length < 16) continue;
    const s = steepest(pts, 30);
    const y = pts.map((p) => p.y);
    streets.push({ name: f.properties.name ?? "(unnamed)", grade: s.grade, degrees: degrees(s.grade), rise: Math.max(...y) - Math.min(...y), at: [pts[s.at]!.x, pts[s.at]!.z], cliff: steepest(pts, 4).grade, pts });
  }
}
const cliffs = streets.filter((s) => s.cliff > 1);
// One row a street name: its steepest stretch.
const byName = new Map<string, (typeof streets)[number]>();
for (const s of streets.filter((s) => s.cliff <= 1).sort((a, b) => b.grade - a.grade)) if (!byName.has(s.name)) byName.set(s.name, s);
const topStreets = [...byName.values()].slice(0, count);

const stairs = (JSON.parse(readFileSync(`${city}/blocks/stairs.json`, "utf8")) as { id: number; name: string | null; steps: number | null; length_m: number; points: P[] }[])
  .map((s) => { const pts = profile(s.points.map(engine)); return { ...s, pts }; })
  .filter((s) => s.pts.length >= 4)
  .map((s) => {
    const rise = Math.abs(s.pts.at(-1)!.y - s.pts[0]!.y); const run = s.pts.at(-1)!.s - s.pts[0]!.s;
    const local = steepest(s.pts, 6);
    return { ...s, rise, run, grade: rise / Math.max(1, run), steepest6: local.grade };
  })
  .sort((a, b) => b.rise - a.rise);
const topStairs = stairs.slice(0, count);

// The ground past the survivor's limit, as the lidar has it (base/height.png) and as the map does once footprints are
// levelled and approaches graded: shares on footprints, roads and the rest, and the steepest squares of 256 m, each
// named by the nearest named place.
const lidar = base.elevation();
const onFootprint = base.bytes("buildings");
const onRoad = base.bytes("roads");
const limit = Math.acos(params.slopeCos);
const tooSteep = (h: (c: number, r: number) => number, c: number, r: number): boolean => {
  const gx = (h(c + 1, r) - h(c, r)) / 2; const gz = (h(c, r + 1) - h(c, r)) / 2;
  return Math.atan(Math.hypot(gx, gz)) > limit;
};
const mapAt = (c: number, r: number): number => hf.heightAt(sizeX - c * 2, sizeZ - r * 2);
const lidarAt = (c: number, r: number): number => lidar[r * nx + c]!;
const SQUARE = 128;
const across = Math.ceil(nx / SQUARE);
const squares = new Map<number, { lidar: number; map: number }>();
const tally = { lidar: { footprints: 0, roads: 0, open: 0 }, map: { footprints: 0, roads: 0, open: 0 }, cells: 0 };
for (let r = 0; r + 1 < nz; r++) for (let c = 0; c + 1 < nx; c++) {
  tally.cells++;
  const where = onFootprint[r * nx + c] ? "footprints" : onRoad[r * nx + c] ? "roads" : "open";
  const k = Math.floor(r / SQUARE) * across + Math.floor(c / SQUARE);
  const sq = squares.get(k) ?? { lidar: 0, map: 0 };
  if (tooSteep(lidarAt, c, r)) { tally.lidar[where]++; sq.lidar++; }
  if (tooSteep(mapAt, c, r)) { tally.map[where]++; sq.map++; }
  squares.set(k, sq);
}
const places = (JSON.parse(readFileSync(`${city}/blocks/places.json`, "utf8")) as { name: string | null; kind: string; e: number; n: number }[]).filter((p) => p.name && !["bridge", "artwork", "attraction"].includes(p.kind));
const hectares = (cells: number): number => Number(((cells * 4) / 10000).toFixed(1));
const steepGround = {
  cellM: 2, landHectares: hectares(tally.cells),
  lidarHectares: Object.fromEntries(Object.entries(tally.lidar).map(([k, v]) => [k, hectares(v)])),
  mapHectares: Object.fromEntries(Object.entries(tally.map).map(([k, v]) => [k, hectares(v)])),
  steepestSquares: [...squares.entries()].sort((a, b) => b[1].lidar - a[1].lidar).slice(0, count).map(([k, v]) => {
    const [e, no] = [west + ((k % across) + 0.5) * SQUARE * 2, north - (Math.floor(k / across) + 0.5) * SQUARE * 2];
    const near = places.reduce((best, p) => (Math.hypot(p.e - e, p.n - no) < Math.hypot(best.e - e, best.n - no) ? p : best), places[0]!);
    return { near: near.name, e: Math.round(e), n: Math.round(no), lidarShare: Number((v.lidar / SQUARE ** 2).toFixed(3)), mapShare: Number((v.map / SQUARE ** 2).toFixed(3)) };
  }),
};

const report = {
  map: map.id, mapHash: map.hash, slopeLimitDegrees: Number(((Math.acos(params.slopeCos) * 180) / Math.PI).toFixed(1)), stepUp: params.stepUp, steepGround,
  streets: topStreets.map((s) => ({ name: s.name, grade30m: Number((s.grade * 100).toFixed(1)), degrees: Number(s.degrees.toFixed(1)), riseM: Number(s.rise.toFixed(1)), at: s.at.map((v) => Math.round(v)), ...walk(s.pts) })),
  streetLines: streets.length, linesOverCliffs: cliffs.length, cliffNames: [...new Set(cliffs.map((s) => s.name))].sort(),
  stairs: { mapped: stairs.length, kmMapped: Number((stairs.reduce((a, s) => a + s.length_m, 0) / 1000).toFixed(1)),
    tallest: topStairs.map((s) => ({ id: s.id, name: s.name, steps: s.steps, riseM: Number(s.rise.toFixed(1)), runM: Number(s.run.toFixed(1)), grade: Number((s.grade * 100).toFixed(1)), degrees: Number(degrees(s.grade).toFixed(1)), steepest6mDegrees: Number(degrees(s.steepest6).toFixed(1)), at: [Math.round(s.pts[0]!.x), Math.round(s.pts[0]!.z)], ...walk(s.pts) })) },
};
writeFileSync(`${city}/reports/steep${ground ? "-ground" : plants ? "" : "-no-plants"}.json`, `${JSON.stringify({ plants, statics: !ground, ...report }, null, 2)}\n`);
console.log(`ground past ${report.slopeLimitDegrees}° of ${steepGround.landHectares} ha: lidar ${JSON.stringify(steepGround.lidarHectares)} ha, map ${JSON.stringify(steepGround.mapHectares)} ha`);
for (const s of steepGround.steepestSquares) console.log(`  ${(s.lidarShare * 100).toFixed(0).padStart(3)}% lidar, ${(s.mapShare * 100).toFixed(0).padStart(3)}% map: the 256 m square by ${s.near} (${s.e}, ${s.n})`);
for (const s of report.streets) console.log(`${s.ok ? "ok  " : "FAIL"} street ${s.name.padEnd(28)} ${String(s.grade30m).padStart(5)}% (${s.degrees}°) over 30 m, rise ${s.riseM} m ${s.message}`);
console.log(`${report.linesOverCliffs} of ${report.streetLines} street lines cross a cliff: ${report.cliffNames.join(", ")}`);
for (const s of report.stairs.tallest) console.log(`${s.ok ? "ok  " : "FAIL"} stair  ${(s.name ?? String(s.id)).padEnd(28)} rise ${s.riseM} m over ${s.runM} m (${s.degrees}°, steepest 6 m ${s.steepest6mDegrees}°) ${s.message}`);
process.exitCode = report.streets.some((s) => !s.ok) || report.stairs.tallest.some((s) => !s.ok) ? 1 : 0;
