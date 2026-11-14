// Quaternions are four numbers (x, y, z, w) at an offset in any numeric array. The server and the client must compose the
// same bone rotations, so only exactly rounded operations are used: + - * / and Math.sqrt, plus detSin and detCos.

import { detCos, detSin } from "./scalar.ts";

export type Numbers = Float32Array | Float64Array | number[];

export function quatIdentity(o: Numbers, oi: number): void {
  o[oi] = 0;
  o[oi + 1] = 0;
  o[oi + 2] = 0;
  o[oi + 3] = 1;
}

export function quatCopy(o: Numbers, oi: number, a: Numbers, ai: number): void {
  o[oi] = a[ai]!;
  o[oi + 1] = a[ai + 1]!;
  o[oi + 2] = a[ai + 2]!;
  o[oi + 3] = a[ai + 3]!;
}

/** o = a * b, the rotation b followed by the rotation a. `o` may be `a` or `b`. */
export function quatMul(o: Numbers, oi: number, a: Numbers, ai: number, b: Numbers, bi: number): void {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** o = conj(a) * b, which is b seen from the frame a. */
export function quatMulConj(o: Numbers, oi: number, a: Numbers, ai: number, b: Numbers, bi: number): void {
  const ax = -a[ai]!, ay = -a[ai + 1]!, az = -a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

export function quatRotate(q: Numbers, qi: number, x: number, y: number, z: number, o: Numbers, oi: number): void {
  const qx = q[qi]!, qy = q[qi + 1]!, qz = q[qi + 2]!, qw = q[qi + 3]!;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  o[oi] = x + qw * tx + (qy * tz - qz * ty);
  o[oi + 1] = y + qw * ty + (qz * tx - qx * tz);
  o[oi + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** Rotates by the inverse of q. */
export function quatUnrotate(q: Numbers, qi: number, x: number, y: number, z: number, o: Numbers, oi: number): void {
  const qx = -q[qi]!, qy = -q[qi + 1]!, qz = -q[qi + 2]!, qw = q[qi + 3]!;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  o[oi] = x + qw * tx + (qy * tz - qz * ty);
  o[oi + 1] = y + qw * ty + (qz * tx - qx * tz);
  o[oi + 2] = z + qw * tz + (qx * ty - qy * tx);
}

export function quatNormalize(o: Numbers, oi: number): void {
  const x = o[oi]!, y = o[oi + 1]!, z = o[oi + 2]!, w = o[oi + 3]!;
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  if (l === 0) {
    quatIdentity(o, oi);
    return;
  }
  const s = 1 / l;
  o[oi] = x * s;
  o[oi + 1] = y * s;
  o[oi + 2] = z * s;
  o[oi + 3] = w * s;
}

/** o = a toward b by t, the short way round, normalized. `o` may be `a` or `b`. */
export function quatNlerp(o: Numbers, oi: number, a: Numbers, ai: number, b: Numbers, bi: number, t: number): void {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  let bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  o[oi] = ax + (bx - ax) * t;
  o[oi + 1] = ay + (by - ay) * t;
  o[oi + 2] = az + (bz - az) * t;
  o[oi + 3] = aw + (bw - aw) * t;
  quatNormalize(o, oi);
}

/** A turn of `angle` radians about the unit axis (ax, ay, az), right-handed. */
export function quatAxis(o: Numbers, oi: number, ax: number, ay: number, az: number, angle: number): void {
  const s = detSin(angle * 0.5);
  o[oi] = ax * s;
  o[oi + 1] = ay * s;
  o[oi + 2] = az * s;
  o[oi + 3] = detCos(angle * 0.5);
}
