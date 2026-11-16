// Manual acceptance, outside the native gate: bun tools/koru-sails/clearance.ts [--samples 129] [--out file.json]
// Actual packed vertices and production skin matrices, never per-bone box corners. Progress is sampled, not certified continuously.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";
import { sailPose, sailWorldPose } from "../../client/core/render/sails.ts";
import type { SailVisual } from "../../shared/sim/sail-rig.ts";
const root = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const value = (key: string): string | undefined => {
  const at = args.indexOf(key);
  if (at < 0) return undefined;
  const result = args[at + 1];
  if (!result || result.startsWith("--")) throw new Error(`${key} requires a value`);
  return result;
};
const samples = Number(value("--samples") ?? process.env.KORU_CLEARANCE_SAMPLES ?? 129);
if (!Number.isSafeInteger(samples) || samples < 2) throw new Error("samples must be an integer of at least 2");
const output = resolve(root, value("--out") ?? "var/koru-sails-preview/clearance.json");
const plan = JSON.parse(readFileSync(resolve(root, "content/landmarks/koru-sails.json"), "utf8")) as { sails: SailVisual[] };
const layout = JSON.parse(readFileSync(resolve(root, "content/landmarks/koru-layout.json"), "utf8")) as { routes: { id: string; anchors: P[] }[] };
type P = [number, number, number];
type Witness = { sail: string; level: number; mode: string; progress: number; triangle?: number; vertex?: number; at: P; clearance: number };
type Target = { id: string; x0: number; x1: number; z0: number; z1: number; floor: number; height: number; planes?: number[][]; witness: Witness | null };
const targets: Target[] = [];
for (const route of layout.routes) {
  const anchors: P[] = route.anchors;
  for (let i = 0; i < Math.max(1, anchors.length - 1); i++) {
    const a = anchors[i]!, b = anchors[Math.min(i + 1, anchors.length - 1)]!;
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]), ux = length ? (b[0] - a[0]) / length : 0, uz = length ? (b[2] - a[2]) / length : 1;
    const nx = -uz, nz = ux, alongA = ux * a[0] + uz * a[2], alongB = ux * b[0] + uz * b[2], across = nx * a[0] + nz * a[2];
    const planes = [[ux, uz, alongA - 1], [-ux, -uz, -alongB - 1], [nx, nz, across - .8], [-nx, -nz, -across - .8]];
    targets.push({ id: route.id + ":" + i, x0: Math.min(a[0], b[0]) - 1.8, x1: Math.max(a[0], b[0]) + 1.8,
      z0: Math.min(a[2], b[2]) - 1.8, z1: Math.max(a[2], b[2]) + 1.8, floor: Math.max(a[1], b[1]), height: 2.6, planes, witness: null });
  }
}
// Entire open decks, including space away from the normal centered circulation. Aft terrace extends to Z-40.
targets.push({ id: "whole_sun_deck", x0: -5.6, x1: 5.6, z0: -28, z1: 7, floor: 9.75, height: 2.6, witness: null });
targets.push({ id: "whole_aft_upper_deck", x0: -7.2, x1: 7.2, z0: -40, z1: -28, floor: 6.75, height: 2.6, witness: null });
function clip(poly: P[], nx: number, nz: number, limit: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, da = nx * a[0] + nz * a[2] - limit, db = nx * b[0] + nz * b[2] - limit;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const f = da / (da - db); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
  }
  return out;
}
let vertexEvaluations = 0, triangleEvaluations = 0, clippedTriangles = 0;
const sources: Record<string, unknown> = {};
const started = performance.now();
for (const sail of plan.sails as SailVisual[]) {
  const bytes = readFileSync(root + `/assets/source/core/landmarks/koru_sail_${sail.id}/koru_sail_${sail.id}.snpk`);
  const mesh = unpackMeshes(parsePack(bytes))[0]!, pose = new Float32Array(sail.bones.length * 12);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let low: Witness | null = null;
  const forms = mesh.lods.flatMap((lod, level) => [{ lod, level, weighted: !!lod.weights }, ...(level === 0 && lod.weights ? [{ lod, level, weighted: false }] : [])]);
  for (let sample = 0; sample < samples; sample++) {
    const progress = sample / (samples - 1);
    sailPose(pose, sail, progress); sailWorldPose(pose, sail, {x: 0, y: 0, z: 0, yaw: 0}, {x: 0, y: 0, z: 0});
    for (const { lod, level, weighted } of forms) {
      const mode = weighted ? "weighted-surface" : "dominant-bone-flat";
      const posed = new Float64Array(lod.positions.length), formMin = [Infinity, Infinity, Infinity], formMax = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const x = lod.positions[v * 3]!, y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
        for (let influence = 0; influence < (weighted ? 4 : 1); influence++) {
          const weight = weighted ? lod.weights![v * 4 + influence]! : 1; if (!weight) continue;
          const bone = weighted ? lod.joints![v * 4 + influence]! : lod.bones![v]!;
          for (let a = 0; a < 3; a++) { const k = bone * 12 + a * 4; posed[v * 3 + a]! += weight * (pose[k]! * x + pose[k + 1]! * y + pose[k + 2]! * z + pose[k + 3]!); }
        }
        vertexEvaluations++;
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, posed[v * 3 + a]!); max[a] = Math.max(max[a]!, posed[v * 3 + a]!); formMin[a] = Math.min(formMin[a]!, posed[v * 3 + a]!); formMax[a] = Math.max(formMax[a]!, posed[v * 3 + a]!); }
        if (!low || posed[v * 3 + 1]! < low.at[1]) low = { sail: sail.id, level, mode, progress, vertex: v, at: Array.from(posed.subarray(v * 3, v * 3 + 3)) as P, clearance: posed[v * 3 + 1]! };
      }
      const nearby = targets.filter(t => !(formMax[0]! < t.x0 || formMin[0]! > t.x1 || formMax[2]! < t.z0 || formMin[2]! > t.z1 || formMin[1]! - t.floor - t.height >= (t.witness?.clearance ?? Infinity)));
      if (!nearby.length) continue;
      for (let tri = 0; tri < lod.indices.length; tri += 3) {
        const ia = lod.indices[tri]! * 3, ib = lod.indices[tri + 1]! * 3, ic = lod.indices[tri + 2]! * 3;
        const ymin = Math.min(posed[ia + 1]!, posed[ib + 1]!, posed[ic + 1]!);
        const x0 = Math.min(posed[ia]!, posed[ib]!, posed[ic]!), x1 = Math.max(posed[ia]!, posed[ib]!, posed[ic]!);
        const z0 = Math.min(posed[ia + 2]!, posed[ib + 2]!, posed[ic + 2]!), z1 = Math.max(posed[ia + 2]!, posed[ib + 2]!, posed[ic + 2]!);
        triangleEvaluations++;
        for (const target of nearby) {
          if (x1 < target.x0 || x0 > target.x1 || z1 < target.z0 || z0 > target.z1 || ymin - target.floor - target.height >= (target.witness?.clearance ?? Infinity)) continue;
          let poly = [ia, ib, ic].map(i => [posed[i]!, posed[i + 1]!, posed[i + 2]!] as P);
          for (const [nx, nz, limit] of target.planes ?? [[1, 0, target.x0], [-1, 0, -target.x1], [0, 1, target.z0], [0, -1, -target.z1]]) poly = clip(poly, nx!, nz!, limit!);
          clippedTriangles++;
          for (const at of poly) {
            const clearance = at[1] - target.floor - target.height;
            if (!target.witness || clearance < target.witness.clearance) target.witness = { sail: sail.id, level, mode, progress, triangle: tri / 3, at, clearance };
          }
        }
      }
    }
  }
  sources[sail.id] = { sha256: createHash("sha256").update(bytes).digest("hex"), representations: forms.length, sweptSampleBounds: { min, max }, minimumVertex: low };
}
const hits = targets.filter(t => t.witness).sort((a, b) => a.witness!.clearance - b.witness!.clearance);
const result = { samples, vertexEvaluations, triangleEvaluations, clippedTriangles, milliseconds: performance.now() - started,
  scope: "All five delivered packs; all six LODs; weighted L0 plus its untextured dominant-bone fallback; exact production pose. Triangles clipped against every authored route segment oriented prism expanded .8m sideways and 1m beyond both ends and 2.6m above the greater endpoint floor, plus whole sun and aft upper deck rectangles. This samples progress, and does not use per-bone bounding-box corners or claim continuous-phase certification.",
  poseSHA256: createHash("sha256").update(readFileSync(root + "/client/core/render/sails.ts")).digest("hex"),
  planSHA256: createHash("sha256").update(readFileSync(root + "/content/landmarks/koru-sails.json")).digest("hex"),
  sources, failures: hits.filter(t => t.witness!.clearance < 0), critical: hits.slice(0, 16),
  wholeDecks: hits.filter(t => t.id.startsWith("whole_")),
  affectedRoutes: hits.map(t => ({ id: t.id, floor: t.floor, witness: t.witness })) };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, samples, vertexEvaluations, triangleEvaluations, clippedTriangles, milliseconds: result.milliseconds, sources, failures: result.failures, critical: result.critical, wholeDecks: result.wholeDecks }, null, 2));
