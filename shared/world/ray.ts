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

/** Result of the last `castWorld`: what was hit, how far along the ray, and which structure. */
export const rayHit = { kind: HIT_NONE, t: 0, ref: 0 };

const TO_RAD = TAU / YAW_UNITS;
const TERRAIN_STEP = 0.25;
const SEGMENT = 8;
const refs = new Uint32Array(256);

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
    if (a > t0) t0 = a;
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

  // Structures: boxes turned about the vertical axis, a stretch of the ray at a time.
  const structs = w.structs;
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
      const hx = structs.halfXOf(k);
      const hy = structs.halfYOf(k);
      const hz = structs.halfZOf(k);
      const hit = rayBox(c * px - s * pz, oy - t.y[slot]!, s * px + c * pz, c * dx - s * dz, dy, s * dx + c * dz, -hx, -hy, -hz, hx, hy, hz);
      if (hit < best) {
        best = hit;
        kind = HIT_STRUCTURE;
        ref = r;
      }
    }
  }
  rayHit.kind = kind;
  rayHit.t = best;
  rayHit.ref = ref;
  return kind;
}
