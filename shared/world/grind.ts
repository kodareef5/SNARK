import { frame, frameOf } from "./frame.ts";
import { Found, type StructureStore } from "./structures.ts";

const found = new Found();
const target = { x: 0, y: 0, z: 0, dx: 0, dz: 0, rise: 0 };

/** Snap the proposed next position to a local edge that the rider is moving along, in either direction. */
export function grindAt(store: StructureStore, x: number, y: number, z: number, fx: number, fz: number) {
  const reach = .38;
  const n = store.query(x - reach, z - reach, x + reach, z + reach, found, y - .34, y + .21);
  let best = Infinity, bestRef = Infinity;
  for (let i = 0; i < n; i++) {
    const ref = found.refs[i]!, slot = ref & 65535, row = store.chunks[ref >>> 16]!;
    const line = store.parts.grindLine?.[row.kind[slot]!];
    if (!line) continue;
    frameOf(row.yaw[slot]!);
    const c = frame.cos * frame.stretch, s = frame.sin * frame.stretch;
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1]!, b = line[k]!;
      const ax = row.x[slot]! + c * a[0] + s * a[2], az = row.z[slot]! - s * a[0] + c * a[2];
      const dx = c * (b[0]-a[0]) + s * (b[2]-a[2]), dz = -s * (b[0]-a[0]) + c * (b[2]-a[2]);
      const length = Math.sqrt(dx*dx + dz*dz);
      if (length < .001) continue;
      const along = (dx*fx + dz*fz) / length;
      if (Math.abs(along) < .72) continue;
      const t = ((x-ax)*dx + (z-az)*dz) / (length*length);
      if (t < 0 || t > 1) continue;
      const px = ax+t*dx, pz = az+t*dz, py = row.y[slot]! + a[1]+t*(b[1]-a[1]);
      const lateral = (x-px)**2 + (z-pz)**2, dy = y-py;
      const distance = lateral + dy*dy;
      if (lateral > reach*reach || dy < -.21 || dy > .34 || distance > best || (distance === best && ref >= bestRef)) continue;
      best = distance; bestRef = ref;
      target.x = px; target.z = pz; target.y = py;
      target.rise = Math.sign(along)*(b[1]-a[1])/length;
      target.dx = Math.sign(along)*dx/length; target.dz = Math.sign(along)*dz/length;
    }
  }
  return best < Infinity ? target : null;
}
