// Rays against terrain and structures, to decide what a body is looking at. The server casts from the authoritative eye, and the
// client casts the same ray only to show a prompt. The cast is deterministic.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { PAD, type CollisionWorld } from "./collide.ts";
import { Found } from "./structures.ts";

export const HIT_NONE = 0;
export const HIT_TERRAIN = 1;
export const HIT_STRUCTURE = 2;
/** A resource node. `rayHit.ref` is then its ref in the node store (chunk * 65536 + slot). */
export const HIT_NODE = 3;

/** Result of the last castWorld: the HIT_ kind, the distance along the ray, the structure or node ref, and the unit normal of the surface hit. */
export const rayHit = { kind: HIT_NONE, t: 0, ref: 0, nx: 0, ny: 1, nz: 0 };
/** The face the last rayBox entered by: its axis (0 x, 1 y, 2 z, or -1 if the ray began inside) and the sign of its outward normal on that axis. */
export const boxFace = { axis: -1, sign: 0 };

const TO_RAD = TAU / YAW_UNITS;
const TERRAIN_STEP = 0.25;
const SEGMENT = 8;
/** Half the distance over which the ground's slope is measured for a normal. */
const NORMAL_STEP = 0.25;
const found = new Found(256);

/** `yaw` and `pitch` are in wire units (pitch 16384 is straight up). Writes a unit vector to `out`. */
export function lookDirection(yaw: number, pitch: number, out: Float64Array | number[]): void {
  const a = yaw * TO_RAD;
  const e = pitch * TO_RAD;
  const cp = detCos(e);
  out[0] = detSin(a) * cp;
  out[1] = detSin(e);
  out[2] = detCos(a) * cp;
}

/** Distance along the ray to an axis-aligned box, or Infinity. A ray that starts inside the box hits at 0. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  let t0 = 0;
  let t1 = Infinity;
  boxFace.axis = -1;
  boxFace.sign = 0;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const hi = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
    if (d === 0) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > t0) {
      t0 = a;
      // The ray enters by this axis's near face, which looks back along the ray.
      boxFace.axis = axis;
      boxFace.sign = d > 0 ? -1 : 1;
    }
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** The direction must be a unit vector, and `maxT` is in metres. Fills `rayHit` and returns the HIT_ kind. */
export function castWorld(w: CollisionWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const hf = w.hf;
  let best = maxT;
  let kind = HIT_NONE;
  let ref = 0;
  // The face of the box hit, in the box's frame, and the sine and cosine of that frame's yaw.
  let faceAxis = -1;
  let faceSign = 0;
  let faceS = 0;
  let faceC = 1;

  // Terrain. Walk until a sample is under the ground, then bisect to the crossing.
  if (oy < hf.heightAt(ox, oz)) {
    best = 0;
    kind = HIT_TERRAIN;
  } else {
    for (let t = TERRAIN_STEP; t < maxT + TERRAIN_STEP; t += TERRAIN_STEP) {
      const at = t < maxT ? t : maxT;
      if (oy + dy * at >= hf.heightAt(ox + dx * at, oz + dz * at)) continue;
      let lo = at - TERRAIN_STEP;
      let hi = at;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) * 0.5;
        if (oy + dy * mid < hf.heightAt(ox + dx * mid, oz + dz * mid)) hi = mid;
        else lo = mid;
      }
      best = hi;
      kind = HIT_TERRAIN;
      break;
    }
  }

  // Structures, then nodes. Their boxes turn about the vertical axis, and the ray is tested one SEGMENT at a time.
  for (let pass = 0; pass < 2; pass++) {
    const structs = pass === 0 ? w.structs : w.nodes;
    if (!structs) continue;
    for (let from = 0; from < best; from += SEGMENT) {
      const to = from + SEGMENT < best ? from + SEGMENT : best;
      const ax = ox + dx * from;
      const az = oz + dz * from;
      const bx = ox + dx * to;
      const bz = oz + dz * to;
      const ay = oy + dy * from;
      const by = oy + dy * to;
      const n = structs.query(ax < bx ? ax : bx, az < bz ? az : bz, ax > bx ? ax : bx, az > bz ? az : bz, found, (ay < by ? ay : by) - PAD, (ay > by ? ay : by) + PAD);
      for (let i = 0; i < n; i++) {
        const r = found.refs[i]!;
        const t = structs.chunks[Math.floor(r / 65536)]!;
        const slot = r & 0xffff;
        const k = t.kind[slot]!;
        const a = t.yaw[slot]! * TO_RAD;
        const s = detSin(a);
        const c = detCos(a);
        // The ray in the structure's frame.
        const px = ox - t.x[slot]!;
        const pz = oz - t.z[slot]!;
        const lx = c * px - s * pz;
        const ly = oy - t.y[slot]!;
        const lz = s * px + c * pz;
        const ldx = c * dx - s * dz;
        const ldz = s * dx + c * dz;
        const box = structs.parts.box;
        for (let p = structs.parts.start[k]! * 6, end = structs.parts.start[k + 1]! * 6; p < end; p += 6) {
          const bx = box[p]!;
          const by = box[p + 1]!;
          const bz = box[p + 2]!;
          const hx = box[p + 3]!;
          const hy = box[p + 4]!;
          const hz = box[p + 5]!;
          const hit = rayBox(lx, ly, lz, ldx, dy, ldz, bx - hx, by - hy, bz - hz, bx + hx, by + hy, bz + hz);
          if (hit >= best) continue;
          best = hit;
          kind = pass === 0 ? HIT_STRUCTURE : HIT_NODE;
          ref = r;
          faceAxis = boxFace.axis;
          faceSign = boxFace.sign;
          faceS = s;
          faceC = c;
        }
      }
    }
  }
  rayHit.kind = kind;
  rayHit.t = best;
  rayHit.ref = ref;
  if (kind === HIT_TERRAIN) {
    const x = ox + dx * best;
    const z = oz + dz * best;
    const sx = hf.heightAt(x + NORMAL_STEP, z) - hf.heightAt(x - NORMAL_STEP, z);
    const sz = hf.heightAt(x, z + NORMAL_STEP) - hf.heightAt(x, z - NORMAL_STEP);
    const l = Math.sqrt(sx * sx + 4 * NORMAL_STEP * NORMAL_STEP + sz * sz);
    rayHit.nx = -sx / l;
    rayHit.ny = (2 * NORMAL_STEP) / l;
    rayHit.nz = -sz / l;
  } else if (kind !== HIT_NONE && faceAxis >= 0) {
    // The face normal, turned back out of the box's frame. Going in, x' = c x - s z and z' = s x + c z.
    const lx = faceAxis === 0 ? faceSign : 0;
    const lz = faceAxis === 2 ? faceSign : 0;
    rayHit.nx = faceC * lx + faceS * lz;
    rayHit.ny = faceAxis === 1 ? faceSign : 0;
    rayHit.nz = faceC * lz - faceS * lx;
  } else {
    // The ray began inside a box or hit nothing, so the normal points back along the ray.
    rayHit.nx = -dx;
    rayHit.ny = -dy;
    rayHit.nz = -dz;
  }
  return kind;
}
