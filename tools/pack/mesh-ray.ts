// A ray against a mesh level's triangles, for measuring what the art was built as.

import type { SourceLod } from "./write.ts";

/**
 * How far along the ray from `origin` along `direction` it meets a triangle of `lod`, or Infinity. With `around`, the hit
 * nearest that distance wins rather than the first. Axis-independent: the triangle's plane and its edge half-spaces.
 */
export function meshDistance(lod: SourceLod, origin: readonly number[], direction: readonly number[], around = 0): number {
  const p = lod.positions, indices = lod.indices;
  let nearest = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const den = nx * direction[0]! + ny * direction[1]! + nz * direction[2]!;
    if (Math.abs(den) < 1e-12) continue;
    const d = (nx * (p[a]! - origin[0]!) + ny * (p[a + 1]! - origin[1]!) + nz * (p[a + 2]! - origin[2]!)) / den;
    if (d < 0 || Math.abs(d - around) >= Math.abs(nearest - around)) continue;
    const x = origin[0]! + direction[0]! * d, y = origin[1]! + direction[1]! * d, z = origin[2]! + direction[2]! * d;
    let inside = true;
    for (let edge = 0; edge < 3; edge++) {
      const i = indices[t + edge]! * 3, j = indices[t + (edge + 1) % 3]! * 3;
      const ex = p[j]! - p[i]!, ey = p[j + 1]! - p[i + 1]!, ez = p[j + 2]! - p[i + 2]!;
      const dx = x - p[i]!, dy = y - p[i + 1]!, dz = z - p[i + 2]!;
      if ((ey * dz - ez * dy) * nx + (ez * dx - ex * dz) * ny + (ex * dy - ey * dx) * nz < -1e-10) { inside = false; break; }
    }
    if (inside) nearest = d;
  }
  return nearest;
}
