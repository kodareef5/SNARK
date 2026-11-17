// Verify gravity support on an actual convex contact face, including its edges rather than its bounding rectangle.
import type { Solid } from './convex.ts';
import type { Heightfield } from './heightfield.ts';
import { len3 } from '../math/scalar.ts';
const points = new Float64Array(256), hull = new Float64Array(512);
const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

/** A gravity line inside a non-degenerate supporting face. No extrapolation across separate terrain triangles. */
export function faceSupports(solid: Solid, nx: number, ny: number, nz: number, sign: number, x: number, z: number): boolean {
  let plane = -Infinity;
  for (let i = 0; i < solid.corners * 3; i += 3) plane = Math.max(plane, sign * (solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz));
  let count = 0;
  for (let i = 0; i < solid.corners * 3; i += 3) {
    if (sign * (solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz) < plane - .015) continue;
    const px = solid.at[i]!, pz = solid.at[i + 2]!;
    let at = 0;
    while (at < count && (points[at * 2]! < px || points[at * 2] === px && points[at * 2 + 1]! < pz)) at++;
    if (at < count && points[at * 2] === px && points[at * 2 + 1] === pz) continue;
    for (let j = count; j > at; j--) { points[j * 2] = points[j * 2 - 2]!; points[j * 2 + 1] = points[j * 2 - 1]!; }
    points[at * 2] = px; points[at * 2 + 1] = pz; count++;
  }
  return contains(count, x, z);
}

function contains(count: number, x: number, z: number): boolean {
  if (count < 3) return false;
  let n = 0;
  const append = (i: number, minimum: number): void => {
    const px = points[i * 2]!, pz = points[i * 2 + 1]!;
    while (n >= minimum && cross(hull[(n - 2) * 2]!, hull[(n - 2) * 2 + 1]!, hull[(n - 1) * 2]!, hull[(n - 1) * 2 + 1]!, px, pz) <= 1e-10) n--;
    hull[n * 2] = px; hull[n * 2 + 1] = pz; n++;
  };
  for (let i = 0; i < count; i++) append(i, 2);
  const minimum = n + 1;
  for (let i = count - 2; i >= 0; i--) append(i, minimum);
  if (--n < 3) return false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (cross(hull[i * 2]!, hull[i * 2 + 1]!, hull[j * 2]!, hull[j * 2 + 1]!, x, z) < -1e-6) return false;
  }
  return true;
}

/** A quantized heightfield can support a flat hull across several adjacent triangles. Check the whole small
 * footprint against the same actual terrain plane, including interior grid samples, before permitting rest. */
export function terrainSupports(solid: Solid, hf: Heightfield, nx: number, ny: number, nz: number, x: number, z: number, _skin: number): boolean {
  if (ny < .8) return false;
  const y = hf.heightAt(x, z), plane = nx * x + ny * y + nz * z;
  let count = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < solid.corners * 3 / 2; i += 3) {
    const px = solid.at[i]!, py = solid.at[i + 1]!, pz = solid.at[i + 2]!;
    if (Math.abs(hf.heightAt(px, pz) - py) > .008 || Math.abs(px * nx + py * ny + pz * nz - plane) > .008) continue;
    let at = 0;
    while (at < count && (points[at * 2]! < px || points[at * 2] === px && points[at * 2 + 1]! < pz)) at++;
    if (at < count && points[at * 2] === px && points[at * 2 + 1] === pz) continue;
    for (let j = count; j > at; j--) { points[j * 2] = points[j * 2 - 2]!; points[j * 2 + 1] = points[j * 2 - 1]!; }
    points[at * 2] = px; points[at * 2 + 1] = pz; count++;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  if (!contains(count, x, z)) return false;
  for (let iz = Math.ceil(minZ / hf.cell); iz * hf.cell <= maxZ; iz++) for (let ix = Math.ceil(minX / hf.cell); ix * hf.cell <= maxX; ix++) {
    if (Math.abs(ix * hf.cell * nx + hf.sample(ix, iz) * ny + iz * hf.cell * nz - plane) > .008) return false;
  }
  return true;
}

const clippedA = new Float64Array(1536), clippedB = new Float64Array(1536);
/** Clip the real terrain triangle to the swept convex body. Its area weights the contact, not the grid's triangle count. */
export function terrainPatch(solid: Solid, a: readonly number[], b: readonly number[], c: readonly number[], pad: number, point: { x: number; y: number; z: number }): number {
  let from = clippedA, to = clippedB, count = 3;
  from.set(a, 0); from.set(b, 3); from.set(c, 6);
  for (let axis = 0; axis < solid.faces * 3; axis += 3) {
    const nx = solid.face[axis]!, ny = solid.face[axis + 1]!, nz = solid.face[axis + 2]!;
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < solid.corners * 3; i += 3) {
      const dot = solid.at[i]! * nx + solid.at[i + 1]! * ny + solid.at[i + 2]! * nz;
      low = Math.min(low, dot); high = Math.max(high, dot);
    }
    for (const sign of [-1, 1]) {
      const margin = pad * (len3(nx, 0, nz) + Math.abs(ny));
      const plane = (sign < 0 ? -low : high) + margin; let next = 0;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count, ia = i * 3, ib = j * 3;
        const da = sign * (from[ia]! * nx + from[ia + 1]! * ny + from[ia + 2]! * nz) - plane;
        const db = sign * (from[ib]! * nx + from[ib + 1]! * ny + from[ib + 2]! * nz) - plane;
        if (da <= 0) { to[next * 3] = from[ia]!; to[next * 3 + 1] = from[ia + 1]!; to[next * 3 + 2] = from[ia + 2]!; next++; }
        if ((da <= 0) !== (db <= 0)) {
          const t = da / (da - db);
          for (let d = 0; d < 3; d++) to[next * 3 + d] = from[ia + d]! + (from[ib + d]! - from[ia + d]!) * t;
          next++;
        }
      }
      count = next; if (count < 3) return 0;
      const swap = from; from = to; to = swap;
    }
  }
  let area = 0, x = 0, y = 0, z = 0;
  for (let i = 1; i < count - 1; i++) {
    const j = i + 1, ax = from[i * 3]! - from[0]!, ay = from[i * 3 + 1]! - from[1]!, az = from[i * 3 + 2]! - from[2]!;
    const bx = from[j * 3]! - from[0]!, by = from[j * 3 + 1]! - from[1]!, bz = from[j * 3 + 2]! - from[2]!;
    const weight = len3(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    area += weight; x += (from[0]! + from[i * 3]! + from[j * 3]!) * weight / 3;
    y += (from[1]! + from[i * 3 + 1]! + from[j * 3 + 1]!) * weight / 3;
    z += (from[2]! + from[i * 3 + 2]! + from[j * 3 + 2]!) * weight / 3;
  }
  if (area > 1e-12) { point.x = x / area; point.y = y / area; point.z = z / area; }
  return area / 2;
}
