// Independent acceptance from delivered native vertices, including triangle intersections with the waterline.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CruiseLayout, CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { cruiseGeometry } from "./geometry.ts";
import { verifyCruiseGroups, type CruisePackedGroups } from "./packed-groups.ts";

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
export function cruiseScale(layout: CruiseLayout, bytes: Uint8Array, features = false, groups?: CruisePackedGroups) {
  const geometry = cruiseGeometry(layout, bytes, groups), levels = [], faults: string[] = [];
  const ids = layout.cells?.length ? layout.cells.map(c => c.id) : layout.prototypes.map(p => p.mesh);
  for (const id of ids) {
    const mesh = geometry.byId.get(id);
    if (!mesh) faults.push(`missing native mesh ${id}`);
    else if (mesh.lods.length < 1 || mesh.lods.length > 6) faults.push(`${id}: requires one to six retained native levels, found ${mesh.lods.length}`);
  }
  if (faults.length) throw new Error(faults.join("; "));
  for (let level = 0; level < 6; level++) {
    const bounds = EMPTY(), length = SPAN(), waterline = SPAN(), deckhouse = SPAN(), bridge = SPAN(), domeWidth = SPAN(), domeHeight = SPAN();
    const coverage = { hull: 0, deckhouse: 0, bridge: 0, dome: 0 };
    let vertices = 0, triangles = 0, waterlineTriangles = 0;
    for (const section of geometry.sections(level)) {
      const { instance, positions: posed, indices } = section, p = section.prototype as MeasuredPrototype;
      if (p.category === "gangway") continue;
      const group = p.art?.measurement;
      if (group) coverage[group]++;
      if (p.category === "dome") coverage.dome++;
      let lowY = Infinity, highY = -Infinity;
      for (const v of new Set(indices)) {
        const at: Point = [posed[v * 3]!, posed[v * 3 + 1]!, posed[v * 3 + 2]!];
        if (!at.every(Number.isFinite)) throw new Error(`${instance.id}: non-finite packed vertex`);
        include(bounds, at); lowY = Math.min(lowY, at[1]); highY = Math.max(highY, at[1]); vertices++;
        const witness: Witness = { instance: instance.id, prototype: p.id, vertex: v, at };
        span(length, 2, witness);
        if (group === "deckhouse") span(deckhouse, 0, witness);
        if (group === "bridge") span(bridge, 0, witness);
        if (p.category === "dome") { span(domeWidth, 0, witness); span(domeHeight, 1, witness); }
      }
      triangles += indices.length / 3;
      if (group !== "hull" || lowY > 0 || highY < 0) continue;
      for (let tri = 0; tri < indices.length; tri += 3) {
        const points = [0, 1, 2].map(k => {
          const v = indices[tri + k]! * 3; return [posed[v]!, posed[v + 1]!, posed[v + 2]!] as Point;
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
      // Primary architect dimensions of the OUTER shell, independent of editable layout metadata.
      // https://www.wilsonbutler.com/project/icon-of-the-seas/
      ...(features ? [{ name: "outerDomeWidth", expected: 57, range: domeWidth }, { name: "outerDomeHeight", expected: 17, range: domeHeight }] : []),
    ].map(({ name, expected, range }) => {
      const actual = range.max - range.min, delta = actual - expected;
      const pass = Number.isFinite(actual) && Math.abs(delta) <= TOLERANCE;
      if (!pass) faults.push(`L${level} ${name}: ${actual} m, expected ${expected} ± ${TOLERANCE} m`);
      return { name, expected, actual: Number.isFinite(actual) ? actual : null, delta: Number.isFinite(delta) ? delta : null,
        tolerance: TOLERANCE, pass, low: range.low, high: range.high };
    });
    for (const group of ["hull", "deckhouse", "bridge"] as const) if (!coverage[group]) faults.push(`L${level}: no ${group} measurement instances`);
    if (features && !coverage.dome) faults.push(`L${level}: no outer dome measurement instances`);
    levels.push({ level, vertices, triangles, waterlineTriangles, coverage, bounds, metrics });
  }
  return { pass: faults.length === 0, phase: layout.phase, toleranceMetres: TOLERANCE, features,
    scope: "All placed ship geometry across six authored detail stages, excluding the gangway. Identical consecutive cell candidates share one native level through the hash-bound authored-stage mapping; every retained native level is measured. Native origin/yaw quantization in the canonical yaw-zero ship frame. Hull beam is measured by clipping actual triangles at waterline Y0; deckhouse and bridge use explicit semantic groups matched to actual packed triangles. Cell geometry is counted once, independently of collision-only modules. Height and draft are reported as geometry bounds, not certified published measurements. This does not certify visual resemblance, interior accuracy, collision or frame cost.",
    featureScope: features ? "Outer AquaDome category measures the architect's 57 m width and 17 m height; separate inner theater, furniture and decks are excluded. The unverified overall ship height/draft and discrepant Pearl figures are not certified." : "Outer dome dimensions are not included in this prototype envelope run; final acceptance requires --features.",
    faults, levels };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../.."), args = process.argv.slice(2);
  const value = (flag: string, fallback: string) => { const at = args.indexOf(flag); if (at < 0) return fallback; if (!args[at + 1] || args[at + 1]!.startsWith("--")) throw new Error(`${flag} needs a path`); return args[at + 1]!; };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--features") continue;
    if (["--pack", "--layout", "--out", "--groups"].includes(args[i]!) && args[i + 1] && !args[i + 1]!.startsWith("--")) { i++; continue; }
    throw new Error("usage: bun tools/cruise/scale.ts [--features] [--pack path] [--layout path] [--out path] [--groups path]");
  }
  const packPath = resolve(value("--pack", resolve(root, "assets/source/landmarks/cruise/cruise.snpk")));
  const layoutPath = resolve(value("--layout", resolve(root, "content/landmarks/cruise-layout.json")));
  const output = resolve(value("--out", resolve(root, "var/cruise-preview/scale.json")));
  const bytes = readFileSync(packPath), source = readFileSync(layoutPath), layout = JSON.parse(source.toString()) as CruiseLayout;
  const groups: CruisePackedGroups | undefined = layout.cells?.length ? JSON.parse(readFileSync(resolve(value("--groups", resolve(root, "assets/source/landmarks/cruise/ref/packed-groups.json"))), "utf8")) : undefined;
  if (groups) verifyCruiseGroups(groups, source, bytes);
  const result = cruiseScale(layout, bytes, args.includes("--features"), groups);
  const report = { ...result, packSHA256: createHash("sha256").update(bytes).digest("hex"), layoutSHA256: createHash("sha256").update(source).digest("hex") };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: result.pass, output, faults: result.faults, levels: result.levels.map(l => ({ level: l.level, metrics: l.metrics.map(m => ({ name: m.name, metres: m.actual, pass: m.pass })) })) }, null, 2));
  if (!result.pass) process.exitCode = 1;
}
