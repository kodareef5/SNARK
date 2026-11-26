// A craft of a map event as every party works it out (planning/workstreams/map-events.md): where it is at a tick along
// the path it was given when it was made, how its hull is met by a ray, and how it falls once it is brought down. The
// server sends the path once; the server's hit tests and every client's picture and sound come from these functions,
// so what a survivor sees is where the server judges the shot. Only + - * / and square roots are used, so V8 and
// JavaScriptCore give the same numbers.

/** Samples a segment of the path is cut into, for its length and its time. */
export const SEGMENT_SAMPLES = 16;
/** The most control points a path has, so a message's size is bounded. */
export const CRAFT_MOST_POINTS = 24;
/** Seconds the longest fall is followed for. One that has met nothing by then is put down where it is. */
export const FALL_MOST = 60;
/** How long a low pass's beam takes to come on or go off, in seconds, either side of a segment that is flown low. */
export const LOW_EASE = 2.5;

/** A control point of a path: where, the speed it is flown through at, and whether it is a low pass, beam on. */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
  /** Metres a second. */
  speed: number;
  low: boolean;
}

/** A position as the wire carries it, in 32nds of a metre, so the server works from the numbers every client reads. */
export const quantise = (v: number): number => Math.round(v * 32) / 32;

/** A path made ready: its points, its spline's knots, the seconds to each sample, and a box that holds all of it. */
export interface CraftTrack {
  readonly points: readonly PathPoint[];
  /** The knots of the centripetal spline, one a point, with one more at each end. */
  readonly knots: Float64Array;
  /** Seconds from the start to each sample's start, and one more for the end: segments × SEGMENT_SAMPLES + 1. */
  readonly times: Float64Array;
  /** Seconds the whole path takes. */
  readonly seconds: number;
  /** The least and most of x, y and z over every sample: what a ray is first tested against. */
  readonly box: Float64Array;
}

/** Where a craft is and how it moves. `low` is how far its beam is on, 0 to 1. */
export interface CraftPose {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  low: number;
}

export const newCraftPose = (): CraftPose => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, low: 0 });

/** A point's place in the list with the ends repeated, which is how a centripetal spline is carried to its first and last points. */
const at = (points: readonly PathPoint[], i: number): PathPoint => points[i < 0 ? 0 : i >= points.length ? points.length - 1 : i]!;

/** Between `a` at knot `ta` and `b` at knot `tb`, at knot `t`. */
function lerp(a: number, b: number, ta: number, tb: number, t: number): number {
  return tb - ta < 1e-9 ? a : (a * (tb - t) + b * (t - ta)) / (tb - ta);
}

/** One axis of the centripetal Catmull-Rom spline through a, b, c, d (the Barry and Goldman form), at knot `t`. */
function axis(a: number, b: number, c: number, d: number, t0: number, t1: number, t2: number, t3: number, t: number): number {
  const a1 = lerp(a, b, t0, t1, t);
  const a2 = lerp(b, c, t1, t2, t);
  const a3 = lerp(c, d, t2, t3, t);
  return lerp(lerp(a1, a2, t0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t);
}

/**
 * The spline through four points at parameter `u` of the middle segment, 0 to 1. The knots are spaced by the square
 * root of each step's length, which keeps a tight turn from looping. Nothing is made: it runs for every shot near a craft.
 */
function spline(p0: PathPoint, p1: PathPoint, p2: PathPoint, p3: PathPoint, t0: number, t1: number, t2: number, t3: number, u: number, out: { x: number; y: number; z: number }): void {
  const t = t1 + (t2 - t1) * u;
  out.x = axis(p0.x, p1.x, p2.x, p3.x, t0, t1, t2, t3, t);
  out.y = axis(p0.y, p1.y, p2.y, p3.y, t0, t1, t2, t3, t);
  out.z = axis(p0.z, p1.z, p2.z, p3.z, t0, t1, t2, t3, t);
}

const scratch = { x: 0, y: 0, z: 0 };
const scratch2 = { x: 0, y: 0, z: 0 };

/** The spline at parameter `u` of segment `s` (from point s to s + 1). */
function pointOn(track: Pick<CraftTrack, "points" | "knots">, s: number, u: number, out: { x: number; y: number; z: number }): void {
  const { points, knots } = track;
  spline(at(points, s - 1), at(points, s), at(points, s + 1), at(points, s + 2), knots[s]!, knots[s + 1]!, knots[s + 2]!, knots[s + 3]!, u, out);
}

/** A path from its points. Two points at the least; repeated points are kept apart by a hair so no step has no length. */
export function buildTrack(points: readonly PathPoint[]): CraftTrack {
  const n = points.length;
  if (n < 2) throw new Error("a path has two points at the least");
  // Knots for the points with one repeated at each end: k[i + 1] is point i's.
  const knots = new Float64Array(n + 2);
  const step = (a: PathPoint, b: PathPoint): number => Math.sqrt(Math.max(1e-6, Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z))));
  knots[0] = 0;
  knots[1] = step(points[0]!, points[1]!) * 0.5;
  for (let i = 1; i < n; i++) knots[i + 1] = knots[i]! + step(points[i - 1]!, points[i]!);
  knots[n + 1] = knots[n]! + step(points[n - 2]!, points[n - 1]!) * 0.5;
  const segments = n - 1;
  const times = new Float64Array(segments * SEGMENT_SAMPLES + 1);
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  const grow = (p: { x: number; y: number; z: number }): void => {
    if (p.x < box[0]!) box[0] = p.x;
    if (p.y < box[1]!) box[1] = p.y;
    if (p.z < box[2]!) box[2] = p.z;
    if (p.x > box[3]!) box[3] = p.x;
    if (p.y > box[4]!) box[4] = p.y;
    if (p.z > box[5]!) box[5] = p.z;
  };
  const partial = { points, knots };
  let clock = 0;
  for (let s = 0; s < segments; s++) {
    const a = points[s]!;
    const b = points[s + 1]!;
    pointOn(partial, s, 0, scratch);
    grow(scratch);
    for (let k = 0; k < SEGMENT_SAMPLES; k++) {
      times[s * SEGMENT_SAMPLES + k] = clock;
      pointOn(partial, s, (k + 1) / SEGMENT_SAMPLES, scratch2);
      grow(scratch2);
      const dx = scratch2.x - scratch.x;
      const dy = scratch2.y - scratch.y;
      const dz = scratch2.z - scratch.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // The speed eases from one point's to the next along the segment: this sample's is the one at its middle.
      const share = (k + 0.5) / SEGMENT_SAMPLES;
      const speed = Math.max(1, a.speed + (b.speed - a.speed) * share);
      clock += length / speed;
      scratch.x = scratch2.x;
      scratch.y = scratch2.y;
      scratch.z = scratch2.z;
    }
  }
  times[segments * SEGMENT_SAMPLES] = clock;
  return { points, knots, times, seconds: clock, box };
}

/**
 * Where the craft is `seconds` after it entered, into `out`, with its velocity. Before the start it is at the first
 * point and after the end at the last, still. Returns false outside the path.
 */
export function trackPose(track: CraftTrack, seconds: number, out: CraftPose): boolean {
  const { times } = track;
  const last = times.length - 1;
  const inside = seconds >= 0 && seconds <= track.seconds;
  const t = seconds < 0 ? 0 : seconds > track.seconds ? track.seconds : seconds;
  // The sample whose start is the last at or before t.
  let lo = 0;
  let hi = last - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  const span = times[lo + 1]! - times[lo]!;
  const f = span > 0 ? (t - times[lo]!) / span : 0;
  const s = Math.floor(lo / SEGMENT_SAMPLES);
  const k = lo - s * SEGMENT_SAMPLES;
  pointOn(track, s, k / SEGMENT_SAMPLES, scratch);
  pointOn(track, s, (k + 1) / SEGMENT_SAMPLES, scratch2);
  // Within a sample the craft goes evenly from its start to its end: that is its speed there, and its velocity.
  out.x = scratch.x + (scratch2.x - scratch.x) * f;
  out.y = scratch.y + (scratch2.y - scratch.y) * f;
  out.z = scratch.z + (scratch2.z - scratch.z) * f;
  const k1 = inside && span > 0 ? 1 / span : 0;
  out.vx = (scratch2.x - scratch.x) * k1;
  out.vy = (scratch2.y - scratch.y) * k1;
  out.vz = (scratch2.z - scratch.z) * k1;
  out.low = lowAt(track, t);
  return inside;
}

/** How far the beam is on at `seconds`: fully along a segment between two low points, easing in and out over LOW_EASE. */
export function lowAt(track: CraftTrack, seconds: number): number {
  const { points, times } = track;
  let best = 0;
  for (let s = 0; s < points.length - 1; s++) {
    if (!points[s]!.low || !points[s + 1]!.low) continue;
    const from = times[s * SEGMENT_SAMPLES]!;
    const to = times[(s + 1) * SEGMENT_SAMPLES]!;
    const k = seconds < from ? 1 - (from - seconds) / LOW_EASE : seconds > to ? 1 - (seconds - to) / LOW_EASE : 1;
    if (k > best) best = k;
  }
  return best;
}

/**
 * The fall of a craft brought down at (x, y, z) moving at (vx, vy, vz), `seconds` after: its speed along the ground
 * bleeds away evenly by `bleed` of the first a second, and it drops at `gravity` from the climb or dive it had.
 */
export function fallPose(x: number, y: number, z: number, vx: number, vy: number, vz: number, seconds: number, gravity: number, bleed: number, out: CraftPose): void {
  const t = seconds < 0 ? 0 : seconds;
  // With a bleed of 0 it keeps its speed along the ground until it lands.
  const stop = bleed > 0 ? 1 / bleed : Infinity;
  const g = t < stop ? t - (bleed * t * t) / 2 : stop / 2;
  const keep = t < stop ? 1 - bleed * t : 0;
  out.x = x + vx * g;
  out.z = z + vz * g;
  out.y = y + vy * t - (gravity * t * t) / 2;
  out.vx = vx * keep;
  out.vz = vz * keep;
  out.vy = vy - gravity * t;
  out.low = 0;
}

/**
 * The distance along the unit ray from (ox, oy, oz) at which it meets a hull `radius` round its rim and `half` from its
 * middle to its top, whose middle is at (cx, cy, cz), within `maxT`, or Infinity. The spheroid is a sphere once heights
 * are stretched by its radius over its half height, and a stretch along one axis keeps the ray's parameter.
 */
export function rayHull(cx: number, cy: number, cz: number, radius: number, half: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const k = radius / half;
  const px = ox - cx;
  const py = (oy - cy) * k;
  const pz = oz - cz;
  const ey = dy * k;
  const a = dx * dx + ey * ey + dz * dz;
  const b = px * dx + py * ey + pz * dz;
  const c = px * px + py * py + pz * pz - radius * radius;
  // Started inside: met at once.
  if (c <= 0) return 0;
  if (b >= 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= maxT ? t : Infinity;
}

/**
 * The distance from (x, y, z) to a hull whose middle is at (cx, cy, cz), less than 0 inside: what a blast's fade and a
 * fuse go by. The hull turns about its up, so this is the distance from a point to an ellipse, found by bisection as
 * D. Eberly gives it ("Distance from a Point to an Ellipse, an Ellipsoid, or a Hyperellipsoid").
 */
export function hullGap(cx: number, cy: number, cz: number, radius: number, half: number, x: number, y: number, z: number): number {
  const across = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
  const up = y - cy < 0 ? cy - y : y - cy;
  // The longer of its two half axes is the first.
  return radius >= half ? ellipseGap(radius, half, across, up) : ellipseGap(half, radius, up, across);
}

/** Bisection steps: enough to settle a double. A fixed count, so every engine takes the same steps. */
const BISECT = 64;

/** The signed distance from (p0, p1), both not negative, to the ellipse with half axes e0 ≥ e1 along them. */
function ellipseGap(e0: number, e1: number, p0: number, p1: number): number {
  const z0 = p0 / e0;
  const z1 = p1 / e1;
  const g = z0 * z0 + z1 * z1 - 1;
  const sign = g < 0 ? -1 : 1;
  if (p1 > 0) {
    if (p0 <= 0) return p1 - e1;
    if (g === 0) return 0;
    const r0 = (e0 / e1) * (e0 / e1);
    const n0 = r0 * z0;
    let s0 = z1 - 1;
    let s1 = g < 0 ? 0 : Math.sqrt(n0 * n0 + z1 * z1) - 1;
    let s = 0;
    for (let i = 0; i < BISECT; i++) {
      s = (s0 + s1) / 2;
      if (s === s0 || s === s1) break;
      const a = n0 / (s + r0);
      const b = z1 / (s + 1);
      const h = a * a + b * b - 1;
      if (h > 0) s0 = s;
      else if (h < 0) s1 = s;
      else break;
    }
    const x0 = (r0 * p0) / (s + r0);
    const x1 = p1 / (s + 1);
    return sign * Math.sqrt((x0 - p0) * (x0 - p0) + (x1 - p1) * (x1 - p1));
  }
  // On the long axis: the nearest point is at its end, or off it where the curve bends closer.
  const numer = e0 * p0;
  const denom = e0 * e0 - e1 * e1;
  if (numer < denom) {
    const k = numer / denom;
    const x0 = e0 * k;
    const x1 = e1 * Math.sqrt(1 - k * k);
    return sign * Math.sqrt((x0 - p0) * (x0 - p0) + x1 * x1);
  }
  return p0 - e0;
}

/**
 * Whether the unit ray from (ox, oy, oz), within `maxT`, passes through a box grown by `pad` on every side: the slab
 * test, which lets a shot pass a craft whose whole path is nowhere near it without working out where the craft is.
 */
export function rayNearBox(box: Float64Array, pad: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  slab.near = 0;
  slab.far = maxT;
  return cut(box[0]! - pad, box[3]! + pad, ox, dx) && cut(box[1]! - pad, box[4]! + pad, oy, dy) && cut(box[2]! - pad, box[5]! + pad, oz, dz);
}

const slab = { near: 0, far: 0 };

/** Narrows the ray's span to where it is between `lo` and `hi` on one axis; false once nothing of it is left. */
function cut(lo: number, hi: number, o: number, d: number): boolean {
  if (d > -1e-12 && d < 1e-12) return o >= lo && o <= hi;
  const a = (lo - o) / d;
  const b = (hi - o) / d;
  if ((a < b ? a : b) > slab.near) slab.near = a < b ? a : b;
  if ((a < b ? b : a) < slab.far) slab.far = a < b ? b : a;
  return slab.near <= slab.far;
}
