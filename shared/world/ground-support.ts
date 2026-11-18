// Area-weight actual supporting faces. Flat steps remain flat; their height difference is never fitted into a ramp.
import { MAX_CORNERS, Solid, partSolid } from './convex.ts';
import { frame, frameOf } from './frame.ts';
import { Found, type StructureStore } from './structures.ts';

const found = new Found(256), solid = new Solid();
// Clipping a convex face against four edges adds at most four vertices.
const points = new Float64Array((MAX_CORNERS + 4) * 2), spare = new Float64Array((MAX_CORNERS + 4) * 2);
export const supportGradient = { x: 0, z: 0, area: 0 };

/** A square footprint clips each real face; its area changes continuously as an edge enters or leaves. */
function area(count: number, radius: number): number {
  let from = points, to = spare;
  for (let axis = 0; axis < 2; axis++) for (let sign = -1; sign <= 1; sign += 2) {
    let next = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, a = i * 2, b = j * 2;
      const da = from[a + axis]! * sign - radius, db = from[b + axis]! * sign - radius;
      if (da <= 0) { to[next * 2] = from[a]!; to[next * 2 + 1] = from[a + 1]!; next++; }
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        to[next * 2] = from[a]! + (from[b]! - from[a]!) * t;
        to[next * 2 + 1] = from[a + 1]! + (from[b + 1]! - from[a + 1]!) * t; next++;
      }
    }
    count = next; if (count < 3) return 0;
    const swap = from; from = to; to = swap;
  }
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    sum += from[i * 2]! * from[j * 2 + 1]! - from[j * 2]! * from[i * 2 + 1]!;
  }
  return Math.abs(sum) / 2;
}

/** Accumulates into supportGradient, which the caller resets before visiting structures and solid nodes. */
export function builtSupport(store: StructureStore, x: number, y: number, z: number, radius: number, slopeCos: number, band: number): void {
  const n = store.query(x - radius, z - radius, x + radius, z + radius, found, y - radius * 2, y + radius * 2);
  for (let i = 0; i < n; i++) {
    const ref = found.refs[i]!, chunk = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535, kind = chunk.kind[slot]!;
    if (store.isSoft(kind)) continue;
    const px = chunk.x[slot]!, py = chunk.y[slot]!, pz = chunk.z[slot]!, yaw = chunk.yaw[slot]!;
    frameOf(yaw);
    const cs = frame.cos * frame.stretch, sn = frame.sin * frame.stretch, boxes = store.parts.box;
    for (let b = store.parts.start[kind]! * 6; b < store.parts.start[kind + 1]! * 6; b += 6) {
      const top = py + boxes[b + 1]! + boxes[b + 4]!;
      const weight = Math.max(0, 1 - Math.abs(top - y) / band);
      if (!weight) continue;
      for (let v = 0; v < 4; v++) {
        const lx = boxes[b]! + (v === 0 || v === 3 ? -1 : 1) * boxes[b + 3]!;
        const lz = boxes[b + 2]! + (v < 2 ? -1 : 1) * boxes[b + 5]!;
        points[v * 2] = px + cs * lx + sn * lz - x; points[v * 2 + 1] = pz + cs * lz - sn * lx - z;
      }
      supportGradient.area += area(4, radius) * weight;
    }
    const hulls = store.parts.hulls;
    if (!hulls) continue;
    for (let part = hulls.start[kind]!; part < hulls.start[kind + 1]!; part++) {
      partSolid(hulls, part, yaw, px, py, pz, solid);
      for (let f = hulls.face[part]!; f < hulls.face[part + 1]!; f++) {
        const a = hulls.faceCorners[f * 3]! * 3, b = hulls.faceCorners[f * 3 + 1]! * 3, c = hulls.faceCorners[f * 3 + 2]! * 3;
        const ax = solid.at[b]! - solid.at[a]!, ay = solid.at[b + 1]! - solid.at[a + 1]!, az = solid.at[b + 2]! - solid.at[a + 2]!;
        const bx = solid.at[c]! - solid.at[a]!, by = solid.at[c + 1]! - solid.at[a + 1]!, bz = solid.at[c + 2]! - solid.at[a + 2]!;
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        if (ny <= 0 || ny / Math.sqrt(nx * nx + ny * ny + nz * nz) < slopeCos) continue;
        const height = solid.at[a + 1]! - (nx * (x - solid.at[a]!) + nz * (z - solid.at[a + 2]!)) / ny;
        const weight = Math.max(0, 1 - Math.abs(height - y) / band);
        if (!weight) continue;
        let count = 0;
        for (let v = hulls.ring[f]!; v < hulls.ring[f + 1]!; v++) {
          const at = hulls.ringCorners[v]! * 3;
          points[count * 2] = solid.at[at]! - x; points[count * 2 + 1] = solid.at[at + 2]! - z; count++;
        }
        const covered = area(count, radius) * weight;
        supportGradient.x -= covered * nx / ny; supportGradient.z -= covered * nz / ny; supportGradient.area += covered;
      }
    }
  }
}
