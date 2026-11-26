// How a garment's panels are unrolled onto its print sheet. A panel wraps a part of the body as a ring does: a line
// through the part (the axis), a distance along it, and a way round it that starts at the panel's seam. The way round
// is measured as length of the body's own skin across each slice, so cloth is not stretched where the body is not
// round, and pinned at each quarter, so the front's middle lies at the same place on the sheet on every body.

export type Vec = readonly [number, number, number];

/** A ring: where its axis is at `along` = 0, which way it runs, the seam's way out from it and the way a quarter turn on. */
export interface RingFrame {
  origin: Vec;
  axis: Vec;
  /** Out from the axis to the seam, and a quarter turn on from it, both across the axis. */
  seam: Vec;
  quarter: Vec;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const unit = (v: ArrayLike<number>): Vec => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
/** `v` with its part along unit `a` taken out, made unit. */
export const across = (v: Vec, a: Vec): Vec => {
  const d = dot(v, a);
  return unit([v[0] - d * a[0], v[1] - d * a[1], v[2] - d * a[2]]);
};

/** Turns about a ring, and slices along it. */
const TURNS = 96;
const SLICE = 0.015;

/** A ring measured on a body: per slice, its centre's offset across the axis and its length to each turn, pinned. */
export interface Ring {
  frame: RingFrame;
  /** The first slice's distance along the axis. */
  from: number;
  slices: number;
  /** Per slice, the centre across the axis on seam and quarter. */
  centre: Float64Array;
  /** Per slice, TURNS + 1 shares round, 0 at the seam and 1 back at it. */
  share: Float64Array;
  /** Per slice, its length round, in metres. */
  length: Float64Array;
}

function coords(f: RingFrame, p: ArrayLike<number>): [number, number, number] {
  const d = [p[0]! - f.origin[0], p[1]! - f.origin[1], p[2]! - f.origin[2]];
  return [dot(d, f.axis), dot(d, f.seam), dot(d, f.quarter)];
}

/** Measures a ring from the points of the body it wraps (three numbers a point). */
export function measureRing(frame: RingFrame, points: ArrayLike<number>): Ring {
  const n = points.length / 3;
  let lo = Infinity, hi = -Infinity;
  const c: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const q = coords(frame, [points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!]);
    c.push(q);
    lo = Math.min(lo, q[0]);
    hi = Math.max(hi, q[0]);
  }
  const from = Math.floor(lo / SLICE) * SLICE;
  const slices = Math.max(1, Math.ceil((hi - from) / SLICE) + 1);
  const sum = new Float64Array(slices * 3);
  for (const q of c) {
    const s = Math.min(slices - 1, Math.max(0, Math.round((q[0] - from) / SLICE)));
    sum[s * 3] += q[1];
    sum[s * 3 + 1] += q[2];
    sum[s * 3 + 2]++;
  }
  const centre = new Float64Array(slices * 2);
  for (let s = 0; s < slices; s++) {
    // A slice with few points takes its neighbours' centre.
    let k = 0, a = 0, b = 0;
    for (let r = 0; r <= 3 && k < 8; r++) for (const t of r === 0 ? [s] : [s - r, s + r]) if (t >= 0 && t < slices) {
      a += sum[t * 3]!;
      b += sum[t * 3 + 1]!;
      k += sum[t * 3 + 2]!;
    }
    centre[s * 2] = k ? a / k : 0;
    centre[s * 2 + 1] = k ? b / k : 0;
  }
  // Per slice and turn, the farthest point out from the centre near that turn.
  const radius = new Float64Array(slices * TURNS);
  for (const q of c) {
    const s = Math.min(slices - 1, Math.max(0, Math.round((q[0] - from) / SLICE)));
    const x = q[1] - centre[s * 2]!, y = q[2] - centre[s * 2 + 1]!;
    const turn = ((Math.atan2(y, x) / (Math.PI * 2)) * TURNS + TURNS) % TURNS;
    const t = Math.round(turn) % TURNS;
    radius[s * TURNS + t] = Math.max(radius[s * TURNS + t]!, Math.hypot(x, y));
  }
  // Turns with no point take the nearest that has one, in the slice or the next.
  for (let s = 0; s < slices; s++) {
    const row = radius.subarray(s * TURNS, s * TURNS + TURNS);
    if (row.every((r) => r === 0)) {
      const near = s > 0 ? radius.subarray((s - 1) * TURNS, s * TURNS) : null;
      if (near) row.set(near);
      continue;
    }
    for (let pass = 0; pass < TURNS && row.some((r) => r === 0); pass++) {
      const was = Float64Array.from(row);
      for (let t = 0; t < TURNS; t++) if (was[t] === 0) {
        const a = was[(t + TURNS - 1) % TURNS]!, b = was[(t + 1) % TURNS]!;
        if (a || b) row[t] = a && b ? (a + b) / 2 : a || b;
      }
    }
  }
  for (let s = slices - 2; s >= 0; s--) if (radius.subarray(s * TURNS, s * TURNS + TURNS).every((r) => r === 0)) radius.copyWithin(s * TURNS, (s + 1) * TURNS, (s + 2) * TURNS);
  // Smoothed round and along, so a slice's length changes slowly.
  for (let pass = 0; pass < 3; pass++) {
    const was = Float64Array.from(radius);
    for (let s = 0; s < slices; s++) for (let t = 0; t < TURNS; t++) {
      const at = (ss: number, tt: number): number => was[Math.min(slices - 1, Math.max(0, ss)) * TURNS + ((tt + TURNS) % TURNS)]!;
      radius[s * TURNS + t] = (4 * at(s, t) + at(s, t - 1) + at(s, t + 1) + at(s - 1, t) + at(s + 1, t)) / 8;
    }
  }
  const share = new Float64Array(slices * (TURNS + 1));
  const length = new Float64Array(slices);
  for (let s = 0; s < slices; s++) {
    const len = new Float64Array(TURNS + 1);
    for (let t = 0; t < TURNS; t++) {
      const a0 = (t / TURNS) * Math.PI * 2, a1 = ((t + 1) / TURNS) * Math.PI * 2;
      const r0 = radius[s * TURNS + t]!, r1 = radius[s * TURNS + ((t + 1) % TURNS)]!;
      len[t + 1] = len[t]! + Math.hypot(r1 * Math.cos(a1) - r0 * Math.cos(a0), r1 * Math.sin(a1) - r0 * Math.sin(a0));
    }
    length[s] = len[TURNS]!;
    // Each quarter of the way round is a quarter of the share, so the front's middle is at a quarter on every body.
    const q = TURNS / 4;
    for (let t = 0; t <= TURNS; t++) {
      const k = Math.min(3, Math.floor(t / q));
      const a = len[k * q]!, b = len[(k + 1) * q]!;
      share[s * (TURNS + 1) + t] = (k + (b > a ? (len[t]! - a) / (b - a) : 0)) / 4;
    }
  }
  return { frame, from, slices, centre, share, length };
}

/** Where a point lies on a ring: its distance along the axis, its share round from the seam (0 to 1), and the ring's length round there. */
export function onRing(r: Ring, p: ArrayLike<number>): { along: number; share: number; length: number; out: number; turn: number } {
  const q = coords(r.frame, p);
  const fs = Math.min(r.slices - 1, Math.max(0, (q[0] - r.from) / SLICE));
  const s0 = Math.floor(fs), s1 = Math.min(r.slices - 1, s0 + 1), ts = fs - s0;
  const cx = r.centre[s0 * 2]! * (1 - ts) + r.centre[s1 * 2]! * ts, cy = r.centre[s0 * 2 + 1]! * (1 - ts) + r.centre[s1 * 2 + 1]! * ts;
  const x = q[1] - cx, y = q[2] - cy;
  let turn = Math.atan2(y, x) / (Math.PI * 2);
  if (turn < 0) turn += 1;
  const ft = turn * TURNS, t0 = Math.floor(ft) % TURNS, tt = ft - Math.floor(ft);
  const at = (s: number): number => r.share[s * (TURNS + 1) + t0]! * (1 - tt) + r.share[s * (TURNS + 1) + t0 + 1]! * tt;
  return { along: q[0], share: at(s0) * (1 - ts) + at(s1) * ts, length: r.length[s0]! * (1 - ts) + r.length[s1]! * ts, out: Math.hypot(x, y), turn };
}

/** Across the seam: positive on the side a quarter turn on, negative on the side before it; on the far side of the axis the value means nothing. */
export function seamSide(r: Ring, p: ArrayLike<number>): { side: number; facing: number } {
  const q = coords(r.frame, p);
  const fs = Math.min(r.slices - 1, Math.max(0, (q[0] - r.from) / SLICE));
  const s0 = Math.floor(fs), s1 = Math.min(r.slices - 1, s0 + 1), ts = fs - s0;
  const cx = r.centre[s0 * 2]! * (1 - ts) + r.centre[s1 * 2]! * ts, cy = r.centre[s0 * 2 + 1]! * (1 - ts) + r.centre[s1 * 2 + 1]! * ts;
  return { side: q[2] - cy, facing: q[1] - cx };
}
