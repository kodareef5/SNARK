// A city's steepest streets and stairs on its built ground, and whether a survivor walks them: each street's grade over
// 20 m and each mapped stair's over 6 m and from end to end, from the map file's own heights; then the real character
// controller walks the steepest up and back down with the ground, the ruins and the plants in its way.
// bun tools/mapdata/steep.ts <file.snmap> [count]   writes assets/source/maps/<name>/reports/steep.json

import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";

type P = [number, number];
const map = parseMap(new Uint8Array(readFileSync(process.argv[2] ?? "")));
const count = Number(process.argv[3] ?? 12);
const city = `assets/source/maps/${map.id.split(":")[1]}`;
const reg = compileContent(CORE_CONTENT).registry!;
const hf = mapHeightfield(map);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const source = mapNodes(map, hf, reg);
const nodes = source ? new NodeField(map.dims, reg, source) : null;
const world = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
const params = reg.move[reg.index.get("core:survivor")!]!;
const size = map.dims.chunksX * 64;
const half = size / 2;
const engine = ([e, n]: P): P => [half - e, half + n];
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
      if (x < 4 || z < 4 || x > size - 4 || z > size - 4) continue;
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
      if (Math.hypot(b.x - p.x, b.z - p.z) > 1.2) { message = `stalled at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)} short of ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`; break; }
    }
    if (message) break;
  }
  for (const c of chunks) nodes?.retain(c, 1, -1, () => false);
  return { ok: !message, message, seconds: Number((ticks * TICK_DT).toFixed(1)) };
}

const roads = JSON.parse(readFileSync(`${city}/base/roads.geojson`, "utf8")) as { features: { geometry: { type: string; coordinates: P[] | P[][] }; properties: { name: string | null; mtfcc: string } }[] };
const streets: { name: string; grade: number; degrees: number; rise: number; at: P; pts: ReturnType<typeof profile> }[] = [];
for (const f of roads.features) {
  if (!["S1400", "S1200"].includes(f.properties.mtfcc)) continue;
  const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates as P[]] : (f.geometry.coordinates as P[][]);
  for (const line of lines) {
    const pts = profile(line.map(engine));
    if (pts.length < 12) continue;
    const s = steepest(pts, 20);
    const y = pts.map((p) => p.y);
    streets.push({ name: f.properties.name ?? "(unnamed)", grade: s.grade, degrees: degrees(s.grade), rise: Math.max(...y) - Math.min(...y), at: [pts[s.at]!.x, pts[s.at]!.z], pts });
  }
}
// One row a street name: its steepest stretch.
const byName = new Map<string, (typeof streets)[number]>();
for (const s of streets.sort((a, b) => b.grade - a.grade)) if (!byName.has(s.name)) byName.set(s.name, s);
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

const report = {
  map: map.id, mapHash: map.hash, slopeLimitDegrees: Number(((Math.acos(params.slopeCos) * 180) / Math.PI).toFixed(1)), stepUp: params.stepUp,
  streets: topStreets.map((s) => ({ name: s.name, grade20m: Number((s.grade * 100).toFixed(1)), degrees: Number(s.degrees.toFixed(1)), riseM: Number(s.rise.toFixed(1)), at: s.at.map((v) => Math.round(v)), ...walk(s.pts) })),
  stairs: { mapped: stairs.length, kmMapped: Number((stairs.reduce((a, s) => a + s.length_m, 0) / 1000).toFixed(1)),
    tallest: topStairs.map((s) => ({ id: s.id, name: s.name, steps: s.steps, riseM: Number(s.rise.toFixed(1)), runM: Number(s.run.toFixed(1)), grade: Number((s.grade * 100).toFixed(1)), degrees: Number(degrees(s.grade).toFixed(1)), steepest6mDegrees: Number(degrees(s.steepest6).toFixed(1)), at: [Math.round(s.pts[0]!.x), Math.round(s.pts[0]!.z)], ...walk(s.pts) })) },
};
writeFileSync(`${city}/reports/steep.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const s of report.streets) console.log(`${s.ok ? "ok  " : "FAIL"} street ${s.name.padEnd(28)} ${String(s.grade20m).padStart(5)}% (${s.degrees}°) over 20 m, rise ${s.riseM} m ${s.message}`);
for (const s of report.stairs.tallest) console.log(`${s.ok ? "ok  " : "FAIL"} stair  ${(s.name ?? String(s.id)).padEnd(28)} rise ${s.riseM} m over ${s.runM} m (${s.degrees}°, steepest 6 m ${s.steepest6mDegrees}°) ${s.message}`);
process.exitCode = report.streets.some((s) => !s.ok) || report.stairs.tallest.some((s) => !s.ok) ? 1 : 0;
