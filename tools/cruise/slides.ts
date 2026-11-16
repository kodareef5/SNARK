// Manual bounded source audit: bun tools/cruise/slides.ts [source-directory] [report.json].
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { surfaceError, toTriangle } from "../pack/error.ts";
import type { SourceLod } from "../pack/write.ts";

type Raw = { positions: number[]; indices: number[]; triangles: number; badEdges: number; signedVolume: number };
type Data = { sources: Record<string, string>; persistedCoursesMatched: boolean; courses: { number: number; id: string; name: string; finish: string; radius: number; outerRadius: number; open: boolean; points: number[][]; lodPoints: number[][][] }[]; separation: { courses: number[]; fineOuterClearance: number }[]; grids: Record<string, Record<string, Record<string, Raw | null>>> };
const root = resolve(import.meta.dir, "../.."), source = resolve(process.argv[2] ?? join(root, "assets/source/landmarks/cruise"));
const out = resolve(process.argv[3] ?? join(root, "var/cruise-preview/slides.json")), dir = mkdtempSync(join(tmpdir(), "snark-slides-"));
const lod = (v: Pick<Raw, "positions" | "indices">): SourceLod => ({ positions: Float32Array.from(v.positions), colors: new Uint8Array(v.positions.length / 3), indices: Uint32Array.from(v.indices) });
const capAreas = new Map<string, [number, number]>();

/** Actual cell surface, excluding paired artificial cuts. Quantize as a 16 m native cell. */
function exterior(raw: Raw, grid: string, course: string, stage: string): SourceLod {
  const at = grid.split(",").map(Number), positions: number[] = [], indices: number[] = [], used = new Map<number, number>();
  const quantized = raw.positions.map(v => Math.round(v / 8 * 32767) / 32767 * 8);
  for (let i = 0; i < raw.indices.length; i += 3) {
    const face = raw.indices.slice(i, i + 3);
    let plane: [number, number] | undefined;
    for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) {
      if (face.every(j => Math.abs(quantized[j * 3 + axis]! - side * 8) < 1e-5)) plane = [axis, side];
    }
    if (plane) {
      const [axis, side] = plane, a = face[0]! * 3, b = face[1]! * 3, c = face[2]! * 3;
      const u = [0, 1, 2].map(k => quantized[b + k]! - quantized[a + k]!), v = [0, 1, 2].map(k => quantized[c + k]! - quantized[a + k]!);
      const area = Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
      const key = `${course}/${stage}/${axis}/${at.map((v, k) => k === axis ? v + (side === 1 ? 1 : 0) : v).join(",")}`;
      const values = capAreas.get(key) ?? [0, 0]; values[side === -1 ? 0 : 1] += area; capAreas.set(key, values);
      continue;
    }
    for (const j of face) {
      if (!used.has(j)) {
        used.set(j, positions.length / 3);
        for (let k = 0; k < 3; k++) positions.push(quantized[j * 3 + k]! + at[k]! * 16 + 8);
      }
      indices.push(used.get(j)!);
    }
  }
  return lod({ positions, indices });
}

function union(meshes: SourceLod[]): SourceLod {
  const positions: number[] = [], indices: number[] = [];
  for (const mesh of meshes) {
    const offset = positions.length / 3;
    positions.push(...mesh.positions); for (const index of mesh.indices) indices.push(index + offset);
  }
  return lod({ positions, indices });
}

/** Same corners/centroids/P95 as native surfaceError, one direction at a time. */
function samples(from: SourceLod, to: SourceLod): { p95: number; maximum: number } {
  const target = to.positions, ids = to.indices, bounds: number[] = [], distances: number[] = [];
  for (let i = 0; i < ids.length; i += 3) for (let k = 0; k < 3; k++) {
    const values = [target[ids[i]! * 3 + k]!, target[ids[i + 1]! * 3 + k]!, target[ids[i + 2]! * 3 + k]!];
    bounds.push(Math.min(...values), Math.max(...values));
  }
  const nearest = (point: number[]): void => {
    let best = Infinity;
    for (let i = 0; i < ids.length; i += 3) {
      let square = 0;
      for (let k = 0; k < 3; k++) { const delta = Math.max(0, bounds[i * 2 + k * 2]! - point[k]!, point[k]! - bounds[i * 2 + k * 2 + 1]!); square += delta * delta; }
      if (square > best * best) continue;
      best = Math.min(best, toTriangle(point[0]!, point[1]!, point[2]!, target, ids[i]! * 3, ids[i + 1]! * 3, ids[i + 2]! * 3));
    }
    distances.push(best);
  };
  for (let i = 0; i < from.positions.length; i += 3) nearest(Array.from(from.positions.slice(i, i + 3)));
  for (let i = 0; i < from.indices.length; i += 3) nearest([0, 1, 2].map(k => (from.positions[from.indices[i]! * 3 + k]! + from.positions[from.indices[i + 1]! * 3 + k]! + from.positions[from.indices[i + 2]! * 3 + k]!) / 3));
  distances.sort((a, b) => a - b);
  return { p95: distances[Math.min(distances.length - 1, Math.floor(distances.length * .95))] ?? 0, maximum: distances.at(-1) ?? 0 };
}

try {
  const raw = join(dir, "geometry.json"), helper = join(root, "assets/source/landmarks/cruise");
  const run = Bun.spawnSync([process.env.BLENDER ?? "blender", "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python", join(import.meta.dir, "slides.py"), "--", source, helper, raw], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(new TextDecoder().decode(run.stdout) + new TextDecoder().decode(run.stderr));
  const data = JSON.parse(readFileSync(raw, "utf8")) as Data;
  const pieces = new Map<string, SourceLod>(), assemblies = new Map<string, SourceLod[]>();
  for (const [grid, courses] of Object.entries(data.grids)) for (const [number, stages] of Object.entries(courses)) for (const [stage, mesh] of Object.entries(stages)) {
    if (!mesh) continue;
    if (!stages["0"]) throw new Error(`Far-only course/cell ${grid}/${number}/${stage}`);
    const surface = exterior(mesh, grid, number, stage), key = `${number}/${stage}`;
    pieces.set(`${grid}/${key}`, surface); const list = assemblies.get(key) ?? []; list.push(surface); assemblies.set(key, list);
  }
  const targets = new Map([...assemblies].map(([key, meshes]) => [key, union(meshes)]));
  const capMismatch = Math.max(0, ...[...capAreas.values()].map(([a, b]) => Math.abs(a - b)));
  if (capMismatch > .002) throw new Error(`Unpaired clipping cap: area difference ${capMismatch}`);
  const rows = [];
  for (const [grid, courses] of Object.entries(data.grids)) for (let stage = 1; stage < 6; stage++) {
    const details = [];
    for (const [number, stages] of Object.entries(courses)) {
      const fine = stages["0"], coarse = stages[String(stage)]; if (!fine && !coarse) continue;
      if (!fine || !coarse) throw new Error(`Missing course surface ${grid}/${number}/${stage}`);
      const a = samples(pieces.get(`${grid}/${number}/0`)!, targets.get(`${number}/${stage}`)!);
      const b = samples(pieces.get(`${grid}/${number}/${stage}`)!, targets.get(`${number}/0`)!);
      details.push({ course: Number(number), triangles: coarse.triangles, clippedCapInclusiveP95: surfaceError(lod(fine), lod(coarse)), exteriorP95: Math.max(a.p95, b.p95), exteriorMaximum: Math.max(a.maximum, b.maximum), badEdges: coarse.badEdges, signedVolume: coarse.signedVolume });
    }
    rows.push({ grid, authoredLevel: stage, triangles: details.reduce((sum, c) => sum + c.triangles, 0), exteriorP95: Math.max(...details.map(c => c.exteriorP95)), courses: details });
  }
  const report = {
    scope: "Slide courses only, not the complete ship or final packed artifact. Continuous source at all six stages, independently clipped to every occupied 16 m cell and Blender-triangulated. Exterior error uses native vertex/centroid sampling and toTriangle at P95 in both directions, after signed 16-bit cell quantization. Artificial clipping caps are excluded only after matching opposite-cell area checks; exterior targets include neighboring pieces of the same course. Raw cap-inclusive native surfaceError is retained separately.",
    sources: data.sources, persistedCoursesMatched: data.persistedCoursesMatched, cellCount: Object.keys(data.grids).length,
    capPairMaximumAreaDifference: capMismatch, noFarOnlyCells: true, separation: data.separation,
    courses: data.courses.map(({ points, lodPoints, ...course }) => ({ ...course, endpoints: [points[0], points.at(-1)], ringCounts: lodPoints.map(p => p.length) })), rows,
  };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  const far = rows.filter(r => r.authoredLevel === 4);
  if (far.some(r => r.exteriorP95 > .13 || r.triangles > 292) || rows.some(r => r.courses.some(c => c.badEdges || c.signedVolume <= 0))) throw new Error(`Slide diagnostic failed; see ${out}`);
  console.log(JSON.stringify({ out, cells: report.cellCount, stage4MaxTriangles: Math.max(...far.map(r => r.triangles)), stage4MaxExteriorP95: Math.max(...far.map(r => r.exteriorP95)), capPairMaximumAreaDifference: capMismatch }));
} finally { rmSync(dir, { recursive: true, force: true }); }
