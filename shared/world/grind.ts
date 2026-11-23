import type { CollisionWorld } from "./collide.ts";
import { frame, frameOf } from "./frame.ts";
import { castWorld, HIT_NONE } from "./ray.ts";
import { Found, type GrindLine } from "./structures.ts";

/** A box top this high above the kind's lowest point is a ledge to grind: a kerb, a bench, a sill, a low wall. */
export const LEDGE_LOW = .15, LEDGE_HIGH = 1.2;
/** Sides shorter than this are no ledge. A top narrower than RAIL_WIDTH is one rail along its middle. */
const EDGE_LEAST = 1.2, RAIL_WIDTH = .12;

/** The edges along the tops of a kind's low boxes, each box as its centre and half extents in the kind's frame. */
export function boxEdges(boxes: readonly (readonly number[])[]): GrindLine[] | undefined {
  let floor = Infinity;
  for (const b of boxes) floor = Math.min(floor, b[1]! - b[4]!);
  const lines: GrindLine[] = [];
  for (const [x, y, z, hx, hy, hz] of boxes as readonly (readonly [number, number, number, number, number, number])[]) {
    const top = y + hy;
    if (top - floor < LEDGE_LOW || top - floor > LEDGE_HIGH) continue;
    if (2 * hx >= EDGE_LEAST) {
      for (const side of 2 * hz < RAIL_WIDTH ? [0] : [-hz, hz]) lines.push([[x - hx, top, z + side], [x + hx, top, z + side]]);
    }
    if (2 * hz >= EDGE_LEAST) {
      for (const side of 2 * hx < RAIL_WIDTH ? [0] : [-hx, hx]) lines.push([[x + side, top, z - hz], [x + side, top, z + hz]]);
    }
  }
  return lines.length ? lines : undefined;
}

/** A floor this far to each side of an edge, and within this height of it, makes the edge a join in a flat floor. */
const BESIDE = .12, FLUSH = .02;

/** Whether the floor drops away on at least one side of the edge running (ex, ez) through (x, y, z). */
function open(w: CollisionWorld, x: number, y: number, z: number, ex: number, ez: number): boolean {
  return castWorld(w, x - ez*BESIDE, y + FLUSH, z + ex*BESIDE, 0, -1, 0, 2*FLUSH, true) === HIT_NONE ||
    castWorld(w, x + ez*BESIDE, y + FLUSH, z - ex*BESIDE, 0, -1, 0, 2*FLUSH, true) === HIT_NONE;
}

const found = new Found();
/** The edge found: the point on it, its direction along travel, its rise along travel, how square the approach was
 * (1 along it, 0 across it) and the side the rider turns to lie along it (1 left, -1 right). */
const target = { x: 0, y: 0, z: 0, dx: 0, dz: 0, rise: 0, along: 0, side: 0 };

/** Snap the proposed next position to a nearby edge the rider is moving along or across, in either direction. An edge
 * caught `fresh` needs a drop on one side; one already ridden is followed down a lowered crossing. */
export function grindAt(w: CollisionWorld, x: number, y: number, z: number, fx: number, fz: number, reach = .38, least = .72, fresh = true) {
  const store = w.structs, n = store.query(x - reach, z - reach, x + reach, z + reach, found, y - .34, y + .21);
  let best = Infinity, bestRef = Infinity;
  for (let i = 0; i < n; i++) {
    const ref = found.refs[i]!, slot = ref & 65535, row = store.chunks[ref >>> 16]!;
    const lines = store.parts.grindLine?.[row.kind[slot]!];
    if (!lines) continue;
    frameOf(row.yaw[slot]!);
    const c = frame.cos * frame.stretch, s = frame.sin * frame.stretch;
    for (const line of lines) {
      for (let k = 1; k < line.length; k++) {
        const a = line[k - 1]!, b = line[k]!;
        const ax = row.x[slot]! + c * a[0] + s * a[2], az = row.z[slot]! - s * a[0] + c * a[2];
        const dx = c * (b[0]-a[0]) + s * (b[2]-a[2]), dz = -s * (b[0]-a[0]) + c * (b[2]-a[2]);
        const length = Math.sqrt(dx*dx + dz*dz);
        if (length < .001) continue;
        const along = (dx*fx + dz*fz) / length;
        if (Math.abs(along) < least) continue;
        const t = ((x-ax)*dx + (z-az)*dz) / (length*length);
        if (t < 0 || t > 1) continue;
        const px = ax+t*dx, pz = az+t*dz, py = row.y[slot]! + a[1]+t*(b[1]-a[1]);
        const sideX = x - px, sideZ = z - pz, dy = y - py;
        const lateral = sideX*sideX + sideZ*sideZ;
        const distance = lateral + dy*dy;
        if (lateral > reach*reach || dy < -.21 || dy > .34 || distance > best || (distance === best && ref >= bestRef)) continue;
        const sign = along < 0 ? -1 : 1, ex = sign*dx/length, ez = sign*dz/length;
        if (fresh && !open(w, px, py, pz, ex, ez)) continue;
        best = distance; bestRef = ref;
        target.x = px; target.z = pz; target.y = py;
        target.rise = sign*(b[1]-a[1])/length;
        target.dx = ex; target.dz = ez;
        target.along = Math.abs(along);
        target.side = ez*fx - ex*fz < 0 ? -1 : 1;
      }
    }
  }
  return best < Infinity ? target : null;
}
