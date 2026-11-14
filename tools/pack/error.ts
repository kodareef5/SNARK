// How far a coarser level of a mesh lies from the finest, measured on the meshes themselves.

import type { SourceLod } from "./write.ts";

/** The distance from point p to the triangle a, b, c (Ericson, Real-Time Collision Detection, 5.1.5). */
function toTriangle(px: number, py: number, pz: number, t: Float32Array, a: number, b: number, c: number): number {
  const ax = t[a]!, ay = t[a + 1]!, az = t[a + 2]!;
  const abx = t[b]! - ax, aby = t[b + 1]! - ay, abz = t[b + 2]! - az;
  const acx = t[c]! - ax, acy = t[c + 1]! - ay, acz = t[c + 2]! - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let v = 0;
  let w = 0;
  if (d1 > 0 || d2 > 0) {
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) v = 1;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3);
    else if (d6 >= 0 && d5 <= d6) w = 1;
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6);
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      v = 1 - w;
    } else {
      const sum = va + vb + vc;
      v = sum === 0 ? 0 : vb / sum;
      w = sum === 0 ? 0 : vc / sum;
    }
  }
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/** How far each corner and each triangle's middle of `from` lies from the surface of `to`, least first. */
function distances(from: SourceLod, to: SourceLod): Float64Array {
  const p = from.positions;
  const t = to.positions;
  const out = new Float64Array(p.length / 3 + from.indices.length / 3);
  let n = 0;
  const near = (x: number, y: number, z: number): void => {
    let best = Infinity;
    for (let i = 0; i < to.indices.length; i += 3) best = Math.min(best, toTriangle(x, y, z, t, to.indices[i]! * 3, to.indices[i + 1]! * 3, to.indices[i + 2]! * 3));
    out[n++] = best;
  };
  for (let v = 0; v < p.length; v += 3) near(p[v]!, p[v + 1]!, p[v + 2]!);
  for (let i = 0; i < from.indices.length; i += 3) {
    const [a, b, c] = [from.indices[i]! * 3, from.indices[i + 1]! * 3, from.indices[i + 2]! * 3];
    near((p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3);
  }
  return out.sort();
}

/** The share of a surface that lies within the error given for it. */
export const ERROR_SHARE = 0.95;

/**
 * How far, in metres, the surfaces of `coarse` and `fine` lie from each other: 95 points in 100 of either are within
 * this of the other. The furthest point of all is not used, because one stray triangle would then speak for the whole
 * mesh. Sampled at every corner and every triangle's middle.
 */
export function surfaceError(fine: SourceLod, coarse: SourceLod): number {
  const at = (d: Float64Array): number => (d.length === 0 ? 0 : d[Math.min(d.length - 1, Math.floor(d.length * ERROR_SHARE))]!);
  if (fine.indices.length === 0 || coarse.indices.length === 0) return 0;
  return Math.max(at(distances(coarse, fine)), at(distances(fine, coarse)));
}
