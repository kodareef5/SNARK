// The boxes bodies meet on each of the fleet's abandoned statics, fitted to its finest level as built:
// bun assets/source/core/vehicles/parked_common/bounds.ts writes content/vehicles/abandoned-bounds.json from the packs
// of the <vehicle>_abandoned folders. The mesh is cut into layers 5 cm high, each the plan of the triangles it crosses,
// and neighbouring layers are joined, the pair that adds least room first, until a few boxes are left: a vehicle's
// body, its cabin, its roof's or wheels' step. A box keeps 98 in 100 of the points across, so a mirror does not widen it,
// and all of them along.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lodIndices, lodVertices, parsePack, VERTEX_BYTES } from "../../../../../shared/pack/pack.ts";

const HERE = import.meta.dir;
const OUT = join(HERE, "../../../../../content/vehicles/abandoned-bounds.json");
const LAYER = 0.05;
/** The most boxes a look keeps: a long vehicle one more, for the step between its cab and its body. */
const MOST = (length: number): number => (length > 6 ? 4 : 3);

type Box = { y0: number; y1: number; x0: number; x1: number; z0: number; z1: number };
const room = (b: Box): number => (b.y1 - b.y0) * (b.x1 - b.x0) * (b.z1 - b.z0);
const union = (a: Box, b: Box): Box => ({ y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) });
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function fit(points: Float32Array, indices: Uint32Array): { at: number[]; half: number[] }[] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < points.length; i += 3) { lo = Math.min(lo, points[i]!); hi = Math.max(hi, points[i]!); }
  const n = Math.max(1, Math.ceil((hi - lo) / LAYER));
  const xs: number[][] = Array.from({ length: n }, () => []), zs: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => indices[t + k]! * 3);
    const ys = p.map((i) => points[i + 1]!);
    const a = Math.max(0, Math.floor((Math.min(...ys) - lo) / LAYER)), b = Math.min(n - 1, Math.floor((Math.max(...ys) - lo) / LAYER));
    for (let l = a; l <= b; l++) for (const i of p) { xs[l]!.push(points[i]!); zs[l]!.push(points[i + 2]!); }
  }
  const pct = (v: number[], q: number): number => { const s = [...v].sort((u, w) => u - w); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!; };
  let boxes: Box[] = [];
  for (let l = 0; l < n; l++) {
    if (xs[l]!.length === 0) continue;
    boxes.push({ y0: lo + l * LAYER, y1: Math.min(hi, lo + (l + 1) * LAYER), x0: pct(xs[l]!, 0.01), x1: pct(xs[l]!, 0.99), z0: zs[l]!.reduce((a, v) => Math.min(a, v)), z1: zs[l]!.reduce((a, v) => Math.max(a, v)) });
  }
  const length = Math.max(...boxes.map((b) => b.z1)) - Math.min(...boxes.map((b) => b.z0));
  while (boxes.length > MOST(length)) {
    let best = 0, cost = Infinity;
    for (let k = 0; k + 1 < boxes.length; k++) { const c = room(union(boxes[k]!, boxes[k + 1]!)) - room(boxes[k]!) - room(boxes[k + 1]!); if (c < cost) { cost = c; best = k; } }
    boxes = [...boxes.slice(0, best), union(boxes[best]!, boxes[best + 1]!), ...boxes.slice(best + 2)];
  }
  // The lowest stands on the ground the static's origin is on: what a soft tyre sinks below it is in the ground.
  boxes[0]!.y0 = 0;
  return boxes.map((b) => ({ at: [r4((b.x0 + b.x1) / 2), r4((b.y0 + b.y1) / 2), r4((b.z0 + b.z1) / 2)], half: [r4((b.x1 - b.x0) / 2), r4((b.y1 - b.y0) / 2), r4((b.z1 - b.z0) / 2)] }));
}

if (import.meta.main) {
  const out: Record<string, { at: number[]; half: number[] }[]> = {};
  for (const folder of readdirSync(join(HERE, "..")).filter((f) => f.endsWith("_abandoned") && f !== "compact_abandoned").sort()) {
    const pack = parsePack(new Uint8Array(readFileSync(join(HERE, "..", folder, `${folder}.snpk`))));
    for (const m of pack.header.meshes) {
      const lod = m.lods[0]!, v = lodVertices(pack, lod), view = new DataView(v.buffer, v.byteOffset, v.byteLength);
      const points = new Float32Array(lod.vertexCount * 3);
      for (let i = 0; i < lod.vertexCount; i++) for (let a = 0; a < 3; a++) points[i * 3 + a] = m.center[a]! + (Math.max(-32767, view.getInt16(i * VERTEX_BYTES + a * 2, true)) / 32767) * m.half[a]!;
      const raw = lodIndices(pack, lod), iv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const indices = Uint32Array.from({ length: lod.indexCount }, (_, i) => (lod.indexBytes === 2 ? iv.getUint16(i * 2, true) : iv.getUint32(i * 4, true)));
      out[m.id] = fit(points, indices);
      console.log(m.id, out[m.id]!.length, "boxes", JSON.stringify(out[m.id]));
    }
  }
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
}
