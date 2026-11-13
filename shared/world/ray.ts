// Rays against the static world: terrain and structures. Used to decide what a
// body is looking at. The server casts from the authoritative eye; the client
// casts the same ray only to show a prompt. Deterministic, like everything a
// decision rests on.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { CollisionWorld } from "./collide.ts";

export const HIT_NONE = 0;
export const HIT_TERRAIN = 1;
export const HIT_STRUCTURE = 2;
/** A resource node; `rayHit.ref` is its reference in the node store (chunk * 65536 + slot). */
export const HIT_NODE = 3;

/** Result of the last `castWorld`: what was hit, how far along the ray, which structure, and the unit normal of the surface where it was hit. */
export const rayHit = { kind: HIT_NONE, t: 0, ref: 0, nx: 0, ny: 1, nz: 0 };
/** The face of the box the last `rayBox` entered by: its axis (0 x, 1 y, 2 z; -1 if the ray began inside) and which way that face looks along it. */
export const boxFace = { axis: -1, sign: 0 };

const TO_RAD = TAU / YAW_UNITS;
const TERRAIN_STEP = 0.25;
const SEGMENT = 8;
/** Half the distance over which the ground's slope is measured for a normal. */
const NORMAL_STEP = 0.25;
/** Boxes one stretch of a ray may have to be tested against: more than the densest base puts within eight metres. */
const refs = new Uint32Array(1024);

/** Unit look direction for a yaw and pitch in wire units (pitch 16384 is straight up), written to `out`. */
export function lookDirection(yaw: number, pitch: number, out: Float64Array | number[]): void {
  const a = yaw * TO_RAD;
  const e = pitch * TO_RAD;
  const cp = detCos(e);
  out[0] = detSin(a) * cp;
  out[1] = detSin(e);
  out[2] = detCos(a) * cp;
}

/**
 * Distance along a ray to an axis-aligned box, or Infinity. A ray starting
 * inside the box hits at 0.
 */
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
      // Entered by the near face of this axis: the one that looks back along the ray.
      boxFace.axis = axis;
      boxFace.sign = d > 0 ? -1 : 1;
    }
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * Cast a ray of unit direction through terrain and structures, up to `maxT`
 * metres. Fills `rayHit` and returns what was hit.
 */
export function castWorld(w: CollisionWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const hf = w.hf;
  let best = maxT;
  let kind = HIT_NONE;
  let ref = 0;
  // The face of the box hit, in the box's own frame, and the turn of that frame.
  let faceAxis = -1;
  let faceSign = 0;
  let faceS = 0;
  let faceC = 1;

  // Terrain: walk until a sample is under the ground, then close in on the crossing.
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

  // Structures, then nodes: boxes turned about the vertical axis, a stretch of the ray at a time.
  for (let pass = 0; pass < 2; pass++) {
    const structs = pass === 0 ? w.structs : w.nodes;
    if (!structs) continue;
    for (let from = 0; from < best; from += SEGMENT) {
      const to = from + SEGMENT < best ? from + SEGMENT : best;
      const ax = ox + dx * from;
      const az = oz + dz * from;
      const bx = ox + dx * to;
      const bz = oz + dz * to;
      const n = structs.query(ax < bx ? ax : bx, az < bz ? az : bz, ax > bx ? ax : bx, az > bz ? az : bz, refs);
      for (let i = 0; i < n; i++) {
        const r = refs[i]!;
        const t = structs.chunks[Math.floor(r / 65536)]!;
        const slot = r & 0xffff;
        const k = t.kind[slot]!;
        const a = t.yaw[slot]! * TO_RAD;
        const s = detSin(a);
        const c = detCos(a);
        // The ray in the box's own frame.
        const px = ox - t.x[slot]!;
        const pz = oz - t.z[slot]!;
        const lx = c * px - s * pz;
        const ly = oy - t.y[slot]!;
        const lz = s * px + c * pz;
        const ldx = c * dx - s * dz;
        const ldz = s * dx + c * dz;
        // Each of the boxes it is made of.
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
    // The slope of the ground where it was hit.
    const x = ox + dx * best;
    const z = oz + dz * best;
    const sx = hf.heightAt(x + NORMAL_STEP, z) - hf.heightAt(x - NORMAL_STEP, z);
    const sz = hf.heightAt(x, z + NORMAL_STEP) - hf.heightAt(x, z - NORMAL_STEP);
    const l = Math.sqrt(sx * sx + 4 * NORMAL_STEP * NORMAL_STEP + sz * sz);
    rayHit.nx = -sx / l;
    rayHit.ny = (2 * NORMAL_STEP) / l;
    rayHit.nz = -sz / l;
  } else if (kind !== HIT_NONE && faceAxis >= 0) {
    // The box's face, turned back out of the box's frame (x' = c x - s z, z' = s x + c z going in).
    const lx = faceAxis === 0 ? faceSign : 0;
    const lz = faceAxis === 2 ? faceSign : 0;
    rayHit.nx = faceC * lx + faceS * lz;
    rayHit.ny = faceAxis === 1 ? faceSign : 0;
    rayHit.nz = faceC * lz - faceS * lx;
  } else {
    // Begun inside something, or nothing hit: back the way it came.
    rayHit.nx = -dx;
    rayHit.ny = -dy;
    rayHit.nz = -dz;
  }
  return kind;
}
