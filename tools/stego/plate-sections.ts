// Width of each native plate at fixed cross-sections of its actual closed triangle surface.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync(process.argv[2] ?? "assets/source/core/creatures/stego/stego.snpk");
const pack = parsePack(bytes), names = pack.header.rigs[0]!.names!;
const mesh = unpackMeshes(pack).find(m => m.id === "core:stego")!.lods[0]!;
const { indices, positions } = mesh;
const parent = new Int32Array(positions.length / 3).map((_, i) => i);
function root(v: number): number {
  while (parent[v] !== v) { parent[v] = parent[parent[v]!]!; v = parent[v]!; }
  return v;
}
// The chart boundaries duplicate vertex records at identical packed coordinates.
const seen = new Map<string, number>();
for (let v = 0; v < parent.length; v++) {
  const key = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]].join(",");
  const first = seen.get(key);
  if (first === undefined) seen.set(key, v); else parent[v] = first;
}
for (let t = 0; t < indices.length; t += 3) {
  const a = root(indices[t]!);
  parent[root(indices[t + 1]!)] = a;
  parent[root(indices[t + 2]!)] = a;
}
const components = new Map<number, number[]>();
for (let t = 0; t < indices.length; t += 3) {
  const id = root(indices[t]!);
  if (!components.has(id)) components.set(id, []);
  components.get(id)!.push(t);
}
const rows = [];
for (const tris of components.values()) {
  const vertices = new Set(tris.flatMap(t => [...indices.subarray(t, t + 3)]));
  const totals = new Float64Array(names.length);
  let ymin = Infinity, ymax = -Infinity;
  for (const v of vertices) {
    const y = positions[v * 3 + 1]!;
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    for (let j = 0; j < 4; j++) totals[mesh.joints![v * 4 + j]!]! += mesh.weights![v * 4 + j]!;
  }
  const name = names[totals.indexOf(Math.max(...totals))]!;
  if (!/^plate_\d\d$/.test(name)) continue;
  for (const fraction of [.18, .32, .55, .85]) {
    const y = ymin + fraction * (ymax - ymin);
    const segments = [];
    let zmin = Infinity, zmax = -Infinity;
    for (const t of tris) {
      const hits = [];
      for (let j = 0; j < 3; j++) {
        const a = indices[t + j]! * 3, b = indices[t + (j + 1) % 3]! * 3;
        const ay = positions[a + 1]!, by = positions[b + 1]!;
        if ((ay <= y) === (by <= y)) continue;
        const factor = (y - ay) / (by - ay);
        const z = positions[a + 2]! + factor * (positions[b + 2]! - positions[a + 2]!);
        const x = positions[a]! + factor * (positions[b]! - positions[a]!);
        zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
        hits.push({ x, z });
      }
      if (hits.length === 2) segments.push([hits[0]!, hits[1]!] as const);
    }
    const spans = [];
    for (const across of [.35, .50, .65]) {
      const z = zmin + across * (zmax - zmin);
      const hits = [];
      for (const [a, b] of segments) {
        if ((a.z <= z) === (b.z <= z)) continue;
        hits.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
      }
      if (hits.length < 2) throw new Error(`Open cross-section in ${name} at ${y}, ${z}`);
      spans.push(Math.max(...hits) - Math.min(...hits));
    }
    rows.push({ name, fraction, y, widthAlongZ: zmax - zmin, thicknessAcrossX: spans });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.fraction - b.fraction);
console.log(JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"),
  scope: "Rest-space transverse thickness at 35%, 50% and 65% of each plate's sagittal width, for four fractions of its full vertical span. Bottom includes embedded material.", rows }, null, 2));
