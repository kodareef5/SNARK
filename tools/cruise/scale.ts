// Independent acceptance from delivered native vertices, including triangle intersections with the waterline.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CruiseLayout, CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { frameAxes, HALF_SIDE } from "../../shared/world/frame.ts";
import { unpackMeshes } from "../pack/write.ts";

type Point = [number, number, number];
type Group = "hull" | "deckhouse" | "bridge";
type MeasuredPrototype = CruisePrototype & { readonly art?: { readonly measurement?: Group } };
type Bounds = { min: Point; max: Point };
interface Witness { instance: string; prototype: string; vertex?: number; triangle?: number; at: Point }
interface Span { min: number; max: number; low: Witness | null; high: Witness | null }
const EMPTY = (): Bounds => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const SPAN = (): Span => ({ min: Infinity, max: -Infinity, low: null, high: null });
const TOLERANCE = .025; // 25 mm reserves native placement/mesh quantization, not arbitrary silhouette shrinkage.

function include(box: Bounds, at: Point): void {
  for (let a = 0; a < 3; a++) { box.min[a] = Math.min(box.min[a]!, at[a]!); box.max[a] = Math.max(box.max[a]!, at[a]!); }
}
function span(range: Span, axis: number, witness: Witness): void {
  const value = witness.at[axis]!;
  if (value < range.min) { range.min = value; range.low = witness; }
  if (value > range.max) { range.max = value; range.high = witness; }
}

/** The canonical preview uses native yaw zero. Instance yaw and origins use the real lattice conversion. */
export function cruiseScale(layout: CruiseLayout, bytes: Uint8Array) {
  const meshes = new Map(unpackMeshes(parsePack(bytes)).map(mesh => [mesh.id, mesh]));
  const prototypes = new Map(layout.prototypes.map(p => [p.id, p as MeasuredPrototype]));
  const levels = [], faults: string[] = [];
  for (const p of prototypes.values()) {
    const mesh = meshes.get(p.mesh);
    if (!mesh) faults.push(`${p.id}: missing native mesh ${p.mesh}`);
    else if (mesh.lods.length !== 6) faults.push(`${p.id}: requires six native levels, found ${mesh.lods.length}`);
  }
  if (faults.length) throw new Error(faults.join("; "));
  for (let level = 0; level < 6; level++) {
    const bounds = EMPTY(), length = SPAN(), waterline = SPAN(), deckhouse = SPAN(), bridge = SPAN();
    const coverage = { hull: 0, deckhouse: 0, bridge: 0 };
    let vertices = 0, triangles = 0, waterlineTriangles = 0;
    const axes = new Int32Array(4);
    for (const instance of layout.instances) {
      if (!instance.placed) continue;
      const p = prototypes.get(instance.prototype);
      if (!p) throw new Error(`${instance.id}: unknown prototype ${instance.prototype}`);
      if (p.category === "gangway") continue;
      const lod = meshes.get(p.mesh)!.lods[level]!, group = p.art?.measurement;
      if (group) coverage[group]++;
      const origin = instance.at.map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
      frameAxes(Math.round(instance.yaw * YAW_UNITS / 360) & (YAW_UNITS - 1), axes);
      const posed = new Float64Array(lod.positions.length);
      let lowY = Infinity, highY = -Infinity;
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const x = lod.positions[v * 3]!, y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
        const at: Point = [origin[0]! + (x * axes[0]! + z * axes[2]!) / HALF_SIDE, origin[1]! + y,
          origin[2]! + (x * axes[1]! + z * axes[3]!) / HALF_SIDE];
        if (!at.every(Number.isFinite)) throw new Error(`${instance.id}: non-finite packed vertex`);
        posed.set(at, v * 3); include(bounds, at); lowY = Math.min(lowY, at[1]); highY = Math.max(highY, at[1]);
        const witness: Witness = { instance: instance.id, prototype: p.id, vertex: v, at };
        span(length, 2, witness);
        if (group === "deckhouse") span(deckhouse, 0, witness);
        if (group === "bridge") span(bridge, 0, witness);
      }
      vertices += lod.positions.length / 3; triangles += lod.indices.length / 3;
      if (group !== "hull" || lowY > 0 || highY < 0) continue;
      for (let tri = 0; tri < lod.indices.length; tri += 3) {
        const points = [0, 1, 2].map(k => {
          const v = lod.indices[tri + k]! * 3; return [posed[v]!, posed[v + 1]!, posed[v + 2]!] as Point;
        });
        if (points.every(p => p[1] > 0) || points.every(p => p[1] < 0)) continue;
        waterlineTriangles++;
        for (let edge = 0; edge < 3; edge++) {
          const a = points[edge]!, b = points[(edge + 1) % 3]!;
          if (a[1] === 0) span(waterline, 0, { instance: instance.id, prototype: p.id, triangle: tri / 3, at: a });
          if ((a[1] < 0 && b[1] > 0) || (a[1] > 0 && b[1] < 0)) {
            const t = -a[1] / (b[1] - a[1]), at: Point = [a[0] + t * (b[0] - a[0]), 0, a[2] + t * (b[2] - a[2])];
            span(waterline, 0, { instance: instance.id, prototype: p.id, triangle: tri / 3, at });
          }
        }
      }
    }
    const metrics = [
      { name: "lengthOverall", expected: layout.dimensions.lengthOverall, range: length },
      { name: "waterlineBeam", expected: layout.dimensions.waterlineBeam, range: waterline },
      { name: "deckhouseBeam", expected: layout.dimensions.deckhouseBeam, range: deckhouse },
      { name: "bridgeBeam", expected: layout.dimensions.bridgeBeam, range: bridge },
    ].map(({ name, expected, range }) => {
      const actual = range.max - range.min, delta = actual - expected;
      const pass = Number.isFinite(actual) && Math.abs(delta) <= TOLERANCE;
      if (!pass) faults.push(`L${level} ${name}: ${actual} m, expected ${expected} ± ${TOLERANCE} m`);
      return { name, expected, actual: Number.isFinite(actual) ? actual : null, delta: Number.isFinite(delta) ? delta : null,
        tolerance: TOLERANCE, pass, low: range.low, high: range.high };
    });
    for (const group of ["hull", "deckhouse", "bridge"] as const) if (!coverage[group]) faults.push(`L${level}: no ${group} measurement instances`);
    levels.push({ level, vertices, triangles, waterlineTriangles, coverage, bounds, metrics });
  }
  return { pass: faults.length === 0, phase: layout.phase, toleranceMetres: TOLERANCE,
    scope: "All placed ship geometry in all six delivered native LODs, excluding the gangway. Native origin/yaw quantization in the canonical yaw-zero ship frame. Hull beam is measured by clipping actual triangles at waterline Y0; deckhouse and bridge use explicit semantic groups. Height and draft are reported as geometry bounds, not certified published measurements. This does not certify visual resemblance, interior accuracy, collision or frame cost.",
    faults, levels };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../.."), args = process.argv.slice(2);
  const value = (flag: string, fallback: string) => { const at = args.indexOf(flag); if (at < 0) return fallback; if (!args[at + 1] || args[at + 1]!.startsWith("--")) throw new Error(`${flag} needs a path`); return args[at + 1]!; };
  if (args.some((a, i) => a.startsWith("--") ? !["--pack", "--layout", "--out"].includes(a) : i === 0 || !["--pack", "--layout", "--out"].includes(args[i - 1]!))) throw new Error("usage: bun tools/cruise/scale.ts [--pack path] [--layout path] [--out path]");
  const packPath = resolve(value("--pack", resolve(root, "assets/source/core/landmarks/cruise/cruise.snpk")));
  const layoutPath = resolve(value("--layout", resolve(root, "content/landmarks/cruise-layout.json")));
  const output = resolve(value("--out", resolve(root, "var/cruise-preview/scale.json")));
  const bytes = readFileSync(packPath), source = readFileSync(layoutPath), result = cruiseScale(JSON.parse(source.toString()) as CruiseLayout, bytes);
  const report = { ...result, packSHA256: createHash("sha256").update(bytes).digest("hex"), layoutSHA256: createHash("sha256").update(source).digest("hex") };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: result.pass, output, faults: result.faults, levels: result.levels.map(l => ({ level: l.level, metrics: l.metrics.map(m => ({ name: m.name, metres: m.actual, pass: m.pass })) })) }, null, 2));
  if (!result.pass) process.exitCode = 1;
}
