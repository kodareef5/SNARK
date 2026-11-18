// A downward triangle's underside height plus squared distance to the horizontal camera boom.
// The minimum is convex: test its three edges and the two unconstrained endpoint minima.
// Reused scratch; roof queries are synchronous, and never call another triangle query recursively.
export const result = new Float64Array(4); // [score, witness x, y, z]
let px = 0, pz = 0, dx = 0, dz = 0, dl = 0, curve = 0, best = Infinity;

function candidate(x: number, y: number, z: number): void {
  const t = dl > 1e-14 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / dl)) : 0;
  const ex = x - px - t * dx, ez = z - pz - t * dz, score = y + curve * (ex * ex + ez * ez);
  if (score < best) {
    best = score;
    result[0] = score; result[1] = x; result[2] = y; result[3] = z;
  }
}

function edge(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const vx = bx - ax, vz = bz - az, vy = by - ay;
  const C = vx * vx + vz * vz, B = vx * dx + vz * dz, wx = ax - px, wz = az - pz;
  const VW = vx * wx + vz * wz, DW = dx * wx + dz * wz, G = vy / (2 * curve), den = dl * C - B * B;
  candidate(ax, ay, az); candidate(bx, by, bz);
  // Four boundaries of the edge/boom parameter square, plus its interior stationary point.
  if (C > 1e-14) for (let t = 0; t < 2; t++) {
    const s = Math.max(0, Math.min(1, (t * B - VW - G) / C));
    candidate(ax + s * vx, ay + s * vy, az + s * vz);
  }
  // Parallel edges have no isolated interior minimum; their boundary candidates suffice.
  if (den > 1e-12) {
    const s = (B * DW - dl * (VW + G)) / den, t = (C * DW - B * (VW + G)) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) candidate(ax + s * vx, ay + s * vy, az + s * vz);
  }
}

/** k is positive. Each candidate is on the face and its nearest point on the bounded boom is used. */
export function triangleEnvelope(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number, boomAX: number, boomAZ: number, boomBX: number, boomBZ: number, k: number): number {
  px = boomAX; pz = boomAZ; dx = boomBX - boomAX; dz = boomBZ - boomAZ;
  dl = dx * dx + dz * dz; curve = k; best = Infinity; result[0] = Infinity;
  edge(ax, ay, az, bx, by, bz); edge(bx, by, bz, cx, cy, cz); edge(cx, cy, cz, ax, ay, az);
  const vx = bx - ax, vz = bz - az, wx = cx - ax, wz = cz - az, det = vx * wz - vz * wx;
  if (Math.abs(det) > 1e-12) {
    const gx = ((by - ay) * wz - (cy - ay) * vz) / det, gz = (vx * (cy - ay) - wx * (by - ay)) / det;
    for (let end = 0; end < 2; end++) {
      const x = px + end * dx - gx / (2 * k), z = pz + end * dz - gz / (2 * k), rx = x - ax, rz = z - az;
      const u = (rx * wz - rz * wx) / det, v = (vx * rz - vz * rx) / det;
      if (u >= 0 && v >= 0 && u + v <= 1) candidate(x, ay + gx * rx + gz * rz, z);
    }
  }
  return best;
}
