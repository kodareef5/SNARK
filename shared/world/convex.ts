// Convex parts: a piece's form as the hull of a few corners, for ramps, sloped roofs and triangles. A part's corners are set by
// the same whole-number frame vectors the piece is placed by, so pieces that share corners share faces at every yaw. An upright
// capsule meets a part by the separating-axis test, and a ray by clipping it against the part's planes.

import { HALF_SIDE, frameAxes, sixtyOf } from "./frame.ts";

/** Most corners a part may have, and so most faces and edges its hull can have. */
export const MAX_CORNERS = 12;
const MAX_FACES = 2 * MAX_CORNERS - 4;

/**
 * Every kind's convex parts. Kind k owns parts start[k] up to start[k + 1]. Part p has corners corner[p] up to corner[p + 1],
 * each three numbers of `at` in metres: along the piece's first axis, up, and along its second. Its faces are face[p] up to
 * face[p + 1], each three of its corners in `faceCorners`, counted from its first, that go round the face counter-clockwise
 * seen from outside. Its edges are edge[p] up to edge[p + 1], each two corners in `edgeCorners`. With `sixty` set the second
 * axis is the first turned 60 degrees, so a triangle of two whole-number sides is drawn on them. Face f, drawn, is every
 * corner on it: ring[f] up to ring[f + 1] of `ringCorners`, round it as its three are.
 */
export interface HullTable {
  readonly start: Uint32Array;
  readonly corner: Uint32Array;
  readonly face: Uint32Array;
  readonly edge: Uint32Array;
  readonly sixty: Uint8Array;
  readonly at: Float64Array;
  readonly faceCorners: Uint8Array;
  readonly edgeCorners: Uint8Array;
  readonly ring: Uint32Array;
  readonly ringCorners: Uint8Array;
}

/** A part as content writes it. */
export interface HullDef {
  readonly corners: readonly (readonly [number, number, number])[];
  readonly sixty?: boolean;
}

/** Where a corner written (a, y, b) is in the piece's own level frame at no turn, in metres. */
export function hullPoint(c: readonly [number, number, number], sixty: boolean): [number, number, number] {
  return sixty ? [c[0] + c[2] * 0.5, c[1], c[2] * 0.8660254037844386] : [c[0], c[1], c[2]];
}

/**
 * The faces and edges of the hull of a part's corners, or a reason it is not a solid one. Each face is the first three corners
 * found on its plane; every corner must be on the hull. `rings` holds each face's every corner, in order round it.
 */
export function hullOf(def: HullDef): { faces: number[]; edges: number[]; rings: number[][] } | string {
  const n = def.corners.length;
  if (n < 4 || n > MAX_CORNERS) return `a part has 4 to ${MAX_CORNERS} corners`;
  const p = def.corners.map((c) => hullPoint(c, def.sixty === true));
  const planes: number[][] = [];
  const faces: number[] = [];
  const EPS = 1e-9;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const [a, b, c] = [p[i]!, p[j]!, p[k]!];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = u[1]! * v[2]! - u[2]! * v[1]!;
        let ny = u[2]! * v[0]! - u[0]! * v[2]!;
        let nz = u[0]! * v[1]! - u[1]! * v[0]!;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (l < EPS) continue;
        nx /= l;
        ny /= l;
        nz /= l;
        const d = nx * a[0] + ny * a[1] + nz * a[2];
        let above = 0;
        let below = 0;
        for (const q of p) {
          const s = nx * q[0] + ny * q[1] + nz * q[2] - d;
          if (s > EPS) above++;
          else if (s < -EPS) below++;
        }
        if (above > 0 && below > 0) continue;
        if (above === 0 && below === 0) return "a part's corners all lie in one plane";
        // Outward is away from the other corners.
        const flip = above > 0;
        const plane = flip ? [-nx, -ny, -nz, -d] : [nx, ny, nz, d];
        if (planes.some((q) => Math.abs(q[0]! - plane[0]!) < 1e-7 && Math.abs(q[1]! - plane[1]!) < 1e-7 && Math.abs(q[2]! - plane[2]!) < 1e-7 && Math.abs(q[3]! - plane[3]!) < 1e-7)) continue;
        planes.push(plane);
        faces.push(i, flip ? k : j, flip ? j : k);
      }
    }
  }
  if (faces.length / 3 > MAX_FACES) return "a part has too many faces";
  const on = (plane: number[], q: number[]): boolean => Math.abs(plane[0]! * q[0]! + plane[1]! * q[1]! + plane[2]! * q[2]! - plane[3]!) < EPS;
  for (const q of p) if (!planes.some((plane) => on(plane, q))) return "a corner is inside the part, not on it";
  const edges: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (planes.filter((plane) => on(plane, p[i]!) && on(plane, p[j]!)).length >= 2) edges.push(i, j);
  }
  const rings = planes.map((plane, f) => ringOf(p, plane, faces.slice(f * 3, f * 3 + 3)));
  return { faces, edges, rings };
}

/**
 * The corners of `p` on `plane` in order round the face, starting from the first of its three `tri`, which go round it
 * counter-clockwise seen from outside. Ordered by which side of the first corner each lies and then by turn, with no angle
 * worked out, so every engine orders them alike.
 */
function ringOf(p: readonly number[][], plane: readonly number[], tri: readonly number[]): number[] {
  const on = p.flatMap((q, i) => (Math.abs(plane[0]! * q[0]! + plane[1]! * q[1]! + plane[2]! * q[2]! - plane[3]!) < 1e-9 ? [i] : []));
  const m = [0, 1, 2].map((a) => on.reduce((s, i) => s + p[i]![a]!, 0) / on.length);
  const first = p[tri[0]!]!;
  const u = [first[0]! - m[0]!, first[1]! - m[1]!, first[2]! - m[2]!];
  // w is the plane's normal crossed with u: a quarter turn on from u, counter-clockwise seen from outside.
  const w = [plane[1]! * u[2]! - plane[2]! * u[1]!, plane[2]! * u[0]! - plane[0]! * u[2]!, plane[0]! * u[1]! - plane[1]! * u[0]!];
  const along = (i: number): [number, number] => {
    const d = [p[i]![0]! - m[0]!, p[i]![1]! - m[1]!, p[i]![2]! - m[2]!];
    return [d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!, d[0]! * w[0]! + d[1]! * w[1]! + d[2]! * w[2]!];
  };
  const half = (a: number, b: number): number => (b > 1e-12 || (Math.abs(b) <= 1e-12 && a > 0) ? 0 : 1);
  return on.sort((i, j) => {
    if (i === tri[0]) return -1;
    if (j === tri[0]) return 1;
    const [ai, bi] = along(i);
    const [aj, bj] = along(j);
    const h = half(ai, bi) - half(aj, bj);
    return h !== 0 ? h : aj * bi - ai * bj;
  });
}

/** Builds the table of every kind's parts. `partsOf(k)` lists kind k's parts, each already accepted by hullOf. */
export function hullTable(kinds: number, partsOf: (kind: number) => readonly HullDef[]): HullTable {
  const start = new Uint32Array(kinds + 1);
  const corner: number[] = [];
  const face: number[] = [];
  const edge: number[] = [];
  const sixty: number[] = [];
  const at: number[] = [];
  const faceCorners: number[] = [];
  const edgeCorners: number[] = [];
  const ring: number[] = [];
  const ringCorners: number[] = [];
  for (let k = 0; k < kinds; k++) {
    start[k] = sixty.length;
    for (const def of partsOf(k)) {
      const built = hullOf(def) as Exclude<ReturnType<typeof hullOf>, string>;
      corner.push(at.length / 3);
      face.push(faceCorners.length / 3);
      edge.push(edgeCorners.length / 2);
      sixty.push(def.sixty ? 1 : 0);
      for (const c of def.corners) at.push(c[0], c[1], c[2]);
      faceCorners.push(...built.faces);
      edgeCorners.push(...built.edges);
      for (const r of built.rings) {
        ring.push(ringCorners.length);
        ringCorners.push(...r);
      }
    }
  }
  start[kinds] = sixty.length;
  corner.push(at.length / 3);
  face.push(faceCorners.length / 3);
  edge.push(edgeCorners.length / 2);
  ring.push(ringCorners.length);
  return {
    start,
    corner: Uint32Array.from(corner),
    face: Uint32Array.from(face),
    edge: Uint32Array.from(edge),
    sixty: Uint8Array.from(sixty),
    at: Float64Array.from(at),
    faceCorners: Uint8Array.from(faceCorners),
    edgeCorners: Uint8Array.from(edgeCorners),
    ring: Uint32Array.from(ring),
    ringCorners: Uint8Array.from(ringCorners),
  };
}

// A part placed: its corners from the piece's origin in world metres, and per face its outward unit normal and the plane's
// distance from that origin. Parts placed lately are kept by part and turn, since a body tests the same pieces several times a
// step and a building has few turns.
const KEPT = 16;
const keptCorners = Array.from({ length: KEPT }, () => new Float64Array(3 * MAX_CORNERS));
const keptPlanes = Array.from({ length: KEPT }, () => new Float64Array(4 * MAX_FACES));
const keptTable: (HullTable | null)[] = new Array(KEPT).fill(null);
const keptPart = new Int32Array(KEPT).fill(-1);
const keptYaw = new Int32Array(KEPT).fill(-1);
let placed = keptCorners[0]!;
let planes = keptPlanes[0]!;
const axes = new Int32Array(4);

/** Places part `p` of `t` on a piece turned `yaw`. Its corners are whole numbers of the frame's vectors, as the piece's place is. */
function place(t: HullTable, p: number, yaw: number): void {
  const slot = (p * 7 + yaw * 13 + (yaw >>> 14)) & (KEPT - 1);
  placed = keptCorners[slot]!;
  planes = keptPlanes[slot]!;
  if (keptTable[slot] === t && keptPart[slot] === p && keptYaw[slot] === yaw) return;
  keptTable[slot] = t;
  keptPart[slot] = p;
  keptYaw[slot] = yaw;
  frameAxes(yaw, axes);
  const ax = axes[0]!;
  const az = axes[1]!;
  if (t.sixty[p] === 1) sixtyOf(ax, az, axes, 2);
  const bx = axes[2]!;
  const bz = axes[3]!;
  const at = t.at;
  const c0 = t.corner[p]!;
  const corners = t.corner[p + 1]! - c0;
  for (let c = 0; c < corners; c++) {
    const a = at[(c0 + c) * 3]!;
    const b = at[(c0 + c) * 3 + 2]!;
    placed[c * 3] = (a * ax + b * bx) / HALF_SIDE;
    placed[c * 3 + 1] = at[(c0 + c) * 3 + 1]!;
    placed[c * 3 + 2] = (a * az + b * bz) / HALF_SIDE;
  }
  const fc = t.faceCorners;
  for (let f = t.face[p]!, end = t.face[p + 1]!, o = 0; f < end; f++, o += 4) {
    const i = fc[f * 3]! * 3;
    const j = fc[f * 3 + 1]! * 3;
    const k = fc[f * 3 + 2]! * 3;
    const ux = placed[j]! - placed[i]!;
    const uy = placed[j + 1]! - placed[i + 1]!;
    const uz = placed[j + 2]! - placed[i + 2]!;
    const vx = placed[k]! - placed[i]!;
    const vy = placed[k + 1]! - placed[i + 1]!;
    const vz = placed[k + 2]! - placed[i + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    planes[o] = nx / l;
    planes[o + 1] = ny / l;
    planes[o + 2] = nz / l;
    planes[o + 3] = (nx * placed[i]! + ny * placed[i + 1]! + nz * placed[i + 2]!) / l;
  }
}

/** The shortest push out of the last part capsuleHull found an overlap with, in world space, and how deep it was. */
export const hullPush = { x: 0, y: 0, z: 0, depth: 0 };

/**
 * An upright capsule against part `p` of a piece turned `yaw`. (dx, dz) is its axis from the piece's origin, y0 and y1 the
 * heights of its lower and upper sphere's centres from the origin, and r its radius. True, with `hullPush` filled, when it
 * is deeper in the part than r - reach.
 */
export function capsuleHull(t: HullTable, p: number, yaw: number, dx: number, dz: number, y0: number, y1: number, r: number, reach: number): boolean {
  place(t, p, yaw);
  const faces = t.face[p + 1]! - t.face[p]!;
  // Each face's plane is an axis to separate along. Along it the axis segment is nearest at one of its ends, or at every point
  // if the face is upright.
  let most = -Infinity;
  let first = 0;
  for (let f = 0, o = 0; f < faces; f++, o += 4) {
    const ny = planes[o + 1]!;
    const e = planes[o]! * dx + planes[o + 2]! * dz + ny * (ny > 0 ? y0 : y1) - planes[o + 3]!;
    if (e >= reach) return false;
    if (e > most) {
      most = e;
      first = f;
    }
  }
  // The axis segment clipped by the planes. If any of it is left, the segment passes through the part, and the body leaves by
  // the face it is least deep behind, as a box's does.
  if (clipUpright(faces, -1, dx, dz, y0, y1)) return pushed(planes[first * 4]!, planes[first * 4 + 1]!, planes[first * 4 + 2]!, r - most);
  // Else no face is nearer than the farthest of their planes, so if the nearest point of that plane is on its face, that is
  // the distance. Otherwise the nearest point is on an edge.
  for (let f = 0, o = 0; f < faces; f++, o += 4) {
    const ny = planes[o + 1]!;
    const e = planes[o]! * dx + planes[o + 2]! * dz + ny * (ny > 0 ? y0 : y1) - planes[o + 3]!;
    if (e < most) continue;
    const nx = planes[o]!;
    const nz = planes[o + 2]!;
    const on = ny === 0 ? clipUpright(faces, f, dx - e * nx, dz - e * nz, y0, y1) : onFace(faces, f, dx - e * nx, (ny > 0 ? y0 : y1) - e * ny, dz - e * nz);
    if (on) return pushed(nx, ny, nz, r - e);
  }
  const ec = t.edgeCorners;
  const length = y1 - y0;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let e = t.edge[p]!, end = t.edge[p + 1]!; e < end; e++) {
    const i = ec[e * 2]! * 3;
    const j = ec[e * 2 + 1]! * 3;
    const qx = placed[i]!;
    const qy = placed[i + 1]!;
    const qz = placed[i + 2]!;
    const ex = placed[j]! - qx;
    const ey = placed[j + 1]! - qy;
    const ez = placed[j + 2]! - qz;
    // The nearest points of the axis segment and the edge, after Ericson. The segment runs up from (dx, y0, dz).
    const rx = dx - qx;
    const ry = y0 - qy;
    const rz = dz - qz;
    const ee = ex * ex + ey * ey + ez * ez;
    const f = ex * rx + ey * ry + ez * rz;
    let s = 0;
    let u: number;
    if (length <= 0) u = clamp01(f / ee);
    else {
      const a = length * length;
      const b = length * ey;
      const c = length * ry;
      const denom = a * ee - b * b;
      s = denom > 0 ? clamp01((b * f - c * ee) / denom) : 0;
      u = (b * s + f) / ee;
      if (u < 0) {
        u = 0;
        s = clamp01(-c / a);
      } else if (u > 1) {
        u = 1;
        s = clamp01((b - c) / a);
      }
    }
    const ox = rx - ex * u;
    const oy = ry + length * s - ey * u;
    const oz = rz - ez * u;
    const d2 = ox * ox + oy * oy + oz * oz;
    if (d2 >= best) continue;
    best = d2;
    bx = ox;
    by = oy;
    bz = oz;
  }
  if (best >= reach * reach) return false;
  const d = Math.sqrt(best);
  // Touching an edge exactly, the way out is through the nearest face.
  if (d <= 1e-9) return pushed(planes[first * 4]!, planes[first * 4 + 1]!, planes[first * 4 + 2]!, r - most);
  return pushed(bx / d, by / d, bz / d, r - d);
}

function pushed(nx: number, ny: number, nz: number, depth: number): boolean {
  hullPush.x = nx * depth;
  hullPush.y = ny * depth;
  hullPush.z = nz * depth;
  hullPush.depth = depth;
  return true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Whether some of the upright segment at (x, z) from y0 to y1 is behind every plane but face `skip`'s. */
function clipUpright(faces: number, skip: number, x: number, z: number, y0: number, y1: number): boolean {
  let lo = y0;
  let hi = y1;
  for (let f = 0, o = 0; f < faces; f++, o += 4) {
    if (f === skip) continue;
    const ny = planes[o + 1]!;
    const room = planes[o + 3]! - planes[o]! * x - planes[o + 2]! * z;
    if (ny > 0) {
      if (room < ny * hi) hi = room / ny;
    } else if (ny < 0) {
      if (room < ny * lo) lo = room / ny;
    } else if (room < 0) return false;
    if (lo > hi) return false;
  }
  return true;
}

/** Whether the point (x, y, z), on the plane of face `face`, is behind every other plane. */
function onFace(faces: number, face: number, x: number, y: number, z: number): boolean {
  for (let f = 0, o = 0; f < faces; f++, o += 4) {
    if (f !== face && planes[o]! * x + planes[o + 1]! * y + planes[o + 2]! * z - planes[o + 3]! > 1e-9) return false;
  }
  return true;
}

/** Most edges a part's hull can have. */
const MAX_EDGES = 3 * MAX_CORNERS - 6;

/**
 * A convex solid in the world, to ask whether two overlap: its corners, and its faces' and edges' directions as unit vectors,
 * each direction kept once. A placed part (partSolid) or a box turned about the vertical (boxSolid).
 */
export class Solid {
  corners = 0;
  faces = 0;
  edges = 0;
  readonly at = new Float64Array(3 * MAX_CORNERS);
  readonly face = new Float64Array(3 * MAX_FACES);
  readonly edge = new Float64Array(3 * MAX_EDGES);
}

/** Adds the direction (x, y, z) to `to`, of which `n` are kept, unless it or its opposite is there. Returns how many are kept. */
function keep(to: Float64Array, n: number, x: number, y: number, z: number): number {
  const l = Math.sqrt(x * x + y * y + z * z);
  if (l < 1e-12) return n;
  x /= l;
  y /= l;
  z /= l;
  for (let k = 0; k < n * 3; k += 3) if (Math.abs(to[k]! * x + to[k + 1]! * y + to[k + 2]! * z) > 1 - 1e-9) return n;
  to[n * 3] = x;
  to[n * 3 + 1] = y;
  to[n * 3 + 2] = z;
  return n + 1;
}

/** Part `p` of `t` on a piece at (x, y, z) metres turned `yaw`, into `out`. */
export function partSolid(t: HullTable, p: number, yaw: number, x: number, y: number, z: number, out: Solid): void {
  place(t, p, yaw);
  const corners = t.corner[p + 1]! - t.corner[p]!;
  for (let c = 0; c < corners * 3; c += 3) {
    out.at[c] = x + placed[c]!;
    out.at[c + 1] = y + placed[c + 1]!;
    out.at[c + 2] = z + placed[c + 2]!;
  }
  out.corners = corners;
  out.faces = 0;
  for (let o = 0, end = (t.face[p + 1]! - t.face[p]!) * 4; o < end; o += 4) out.faces = keep(out.face, out.faces, planes[o]!, planes[o + 1]!, planes[o + 2]!);
  out.edges = 0;
  const ec = t.edgeCorners;
  for (let e = t.edge[p]!, end = t.edge[p + 1]!; e < end; e++) {
    const i = ec[e * 2]! * 3;
    const j = ec[e * 2 + 1]! * 3;
    out.edges = keep(out.edge, out.edges, placed[j]! - placed[i]!, placed[j + 1]! - placed[i + 1]!, placed[j + 2]! - placed[i + 2]!);
  }
}

/** A box centred at (x, y, z) metres with half extents (hx, hy, hz), its X along (c, 0, -s) and its Z along (s, 0, c), into `out`. */
export function boxSolid(x: number, y: number, z: number, c: number, s: number, hx: number, hy: number, hz: number, out: Solid): void {
  for (let m = 0; m < 8; m++) {
    const i = m & 1 ? hx : -hx;
    const j = m & 2 ? hy : -hy;
    const k = m & 4 ? hz : -hz;
    out.at[m * 3] = x + c * i + s * k;
    out.at[m * 3 + 1] = y + j;
    out.at[m * 3 + 2] = z - s * i + c * k;
  }
  out.corners = 8;
  out.faces = keep(out.face, keep(out.face, keep(out.face, 0, c, 0, -s), 0, 1, 0), s, 0, c);
  out.edges = keep(out.edge, keep(out.edge, keep(out.edge, 0, c, 0, -s), 0, 1, 0), s, 0, c);
}

/**
 * Whether two solids overlap by more than each gives way. Along any direction a solid gives way by `side` for as much of the
 * direction as is level and `up` for as much as is upright, but never so far that it is left thinner than 2 * `thin`, as a
 * box shrunk for the same test would be. They are apart exactly when one of their faces' directions, or a direction square to
 * an edge of each, separates them.
 */
export function solidsCross(a: Solid, aSide: number, aUp: number, b: Solid, bSide: number, bUp: number, thin: number): boolean {
  for (let k = 0; k < a.faces * 3; k += 3) if (apart(a, aSide, aUp, b, bSide, bUp, thin, a.face[k]!, a.face[k + 1]!, a.face[k + 2]!)) return false;
  for (let k = 0; k < b.faces * 3; k += 3) if (apart(a, aSide, aUp, b, bSide, bUp, thin, b.face[k]!, b.face[k + 1]!, b.face[k + 2]!)) return false;
  const ae = a.edge;
  const be = b.edge;
  for (let i = 0; i < a.edges * 3; i += 3) {
    for (let j = 0; j < b.edges * 3; j += 3) {
      const x = ae[i + 1]! * be[j + 2]! - ae[i + 2]! * be[j + 1]!;
      const y = ae[i + 2]! * be[j]! - ae[i]! * be[j + 2]!;
      const z = ae[i]! * be[j + 1]! - ae[i + 1]! * be[j]!;
      const l = Math.sqrt(x * x + y * y + z * z);
      if (l > 1e-9 && apart(a, aSide, aUp, b, bSide, bUp, thin, x / l, y / l, z / l)) return false;
    }
  }
  return true;
}

function apart(a: Solid, aSide: number, aUp: number, b: Solid, bSide: number, bUp: number, thin: number, nx: number, ny: number, nz: number): boolean {
  let a0 = Infinity;
  let a1 = -Infinity;
  for (let k = 0; k < a.corners * 3; k += 3) {
    const d = a.at[k]! * nx + a.at[k + 1]! * ny + a.at[k + 2]! * nz;
    if (d < a0) a0 = d;
    if (d > a1) a1 = d;
  }
  let b0 = Infinity;
  let b1 = -Infinity;
  for (let k = 0; k < b.corners * 3; k += 3) {
    const d = b.at[k]! * nx + b.at[k + 1]! * ny + b.at[k + 2]! * nz;
    if (d < b0) b0 = d;
    if (d > b1) b1 = d;
  }
  const level = Math.sqrt(nx * nx + nz * nz);
  const upright = Math.abs(ny);
  const ga = Math.min(aSide * level + aUp * upright, Math.max(0, (a1 - a0) / 2 - thin));
  const gb = Math.min(bSide * level + bUp * upright, Math.max(0, (b1 - b0) / 2 - thin));
  return a1 - ga <= b0 + gb || b1 - gb <= a0 + ga;
}

/** The outward normal of the face the last rayHull entered by, in world space, or all zero if the ray began inside. */
export const hullFace = { nx: 0, ny: 0, nz: 0 };

/**
 * Distance along the ray, from (ox, oy, oz) measured from the piece's origin, to part `p` of a piece turned `yaw`, or Infinity.
 * Every face is moved out by `grow`. A ray that starts inside meets it at 0. After Cyrus and Beck.
 */
export function rayHull(t: HullTable, p: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, grow: number): number {
  place(t, p, yaw);
  let t0 = 0;
  let t1 = Infinity;
  let entered = -1;
  for (let f = 0, o = 0, faces = t.face[p + 1]! - t.face[p]!; f < faces; f++, o += 4) {
    const nx = planes[o]!;
    const ny = planes[o + 1]!;
    const nz = planes[o + 2]!;
    // How far out of this plane the origin is, and how fast the ray leaves it.
    const out = nx * ox + ny * oy + nz * oz - planes[o + 3]! - grow;
    const rate = nx * dx + ny * dy + nz * dz;
    if (rate === 0) {
      if (out > 0) return Infinity;
      continue;
    }
    const at = -out / rate;
    if (rate < 0) {
      if (at > t0) {
        t0 = at;
        entered = o;
      }
    } else if (at < t1) t1 = at;
    if (t0 > t1) return Infinity;
  }
  hullFace.nx = entered < 0 ? 0 : planes[entered]!;
  hullFace.ny = entered < 0 ? 0 : planes[entered + 1]!;
  hullFace.nz = entered < 0 ? 0 : planes[entered + 2]!;
  return t0;
}
