// Rays against terrain and structures, to decide what a body is looking at. The server casts from the authoritative eye, and the
// client casts the same ray only to show a prompt. The cast is deterministic.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { PAD, type CollisionWorld } from "./collide.ts";
import { hullFace, rayHull } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";
import type { Heightfield } from "./heightfield.ts";
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
const SEGMENT = 8;
/** Metres a box is grown sideways for a ray, so that rounding leaves no crack between two boxes that share a face. */
const SEAL = 1e-6;
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

/** The first sample of the cell rayGround last met the ground in, and whether that was the cell's upper triangle, over its -X, +Z corner. */
let groundCell = 0;
let groundUpper = false;

/**
 * Distance along the ray to the ground, or Infinity within `maxT`. The ray walks the cells it crosses in order and meets the
 * two triangles of each exactly, as they are drawn. A ray that starts under the ground meets it at once.
 */
export function rayGround(hf: Heightfield, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  // Only the part of the ray over the map, where the ground is drawn.
  let t0 = 0;
  let t1 = maxT;
  for (let axis = 0; axis < 2; axis++) {
    const o = axis === 0 ? ox : oz;
    const d = axis === 0 ? dx : dz;
    const size = axis === 0 ? hf.sizeX : hf.sizeZ;
    if (d === 0) {
      if (o < 0 || o > size) return Infinity;
      continue;
    }
    let a = -o / d;
    let b = (size - o) / d;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  }
  if (t0 > t1) return Infinity;

  const cell = hf.cell;
  const nx = hf.nx;
  const hts = hf.heights;
  const toCell = 1 / cell;
  // Heights are compared in stored units, which a power-of-two step makes exact.
  const toUnits = 1 / hf.stepY;
  const minY = hf.minY;
  let i = Math.floor((ox + dx * t0) * toCell);
  let j = Math.floor((oz + dz * t0) * toCell);
  if (i < 0) i = 0;
  else if (i > nx - 2) i = nx - 2;
  if (j < 0) j = 0;
  else if (j > hf.nz - 2) j = hf.nz - 2;
  const di = dx > 0 ? 1 : -1;
  const dj = dz > 0 ? 1 : -1;
  const ix = dx !== 0 ? 1 / dx : 0;
  const iz = dz !== 0 ? 1 / dz : 0;
  // Where the ray leaves the cell across a line of constant x, and of constant z.
  let tx = dx !== 0 ? ((dx > 0 ? i + 1 : i) * cell - ox) * ix : Infinity;
  let tz = dz !== 0 ? ((dz > 0 ? j + 1 : j) * cell - oz) * iz : Infinity;
  let ta = t0;
  let qa = (oy + dy * ta - minY) * toUnits;
  for (;;) {
    let tb = tx < tz ? tx : tz;
    if (tb > t1) tb = t1;
    const qb = (oy + dy * tb - minY) * toUnits;
    const k = j * nx + i;
    const h00 = hts[k]!;
    const h10 = hts[k + 1]!;
    const h01 = hts[k + nx]!;
    const h11 = hts[k + nx + 1]!;
    let top = h00 > h10 ? h00 : h10;
    if (h01 > top) top = h01;
    if (h11 > top) top = h11;
    // Over every corner at both ends, the ray is over the whole cell.
    if (qa <= top || qb <= top) {
      // Where the ray enters and leaves, in the cell's own coordinates.
      const ua = clamp01((ox + dx * ta) * toCell - i);
      const va = clamp01((oz + dz * ta) * toCell - j);
      const ub = clamp01((ox + dx * tb) * toCell - i);
      const vb = clamp01((oz + dz * tb) * toCell - j);
      const sa = ua - va;
      const sb = ub - vb;
      // How far over the ground the ray is, at each end and where it crosses the diagonal.
      const fa = qa - groundIn(h00, h10, h01, h11, ua, va, sa < 0);
      if (fa < 0) return metAt(k, sa < 0, ta);
      let tm = tb;
      let fm = qb - groundIn(h00, h10, h01, h11, ub, vb, sa < 0);
      if (sa < 0 !== sb < 0) {
        const share = sa / (sa - sb);
        tm = ta + (tb - ta) * share;
        fm = (qa + (qb - qa) * share) - groundIn(h00, h10, h01, h11, ua + (ub - ua) * share, va + (vb - va) * share, sa < 0);
      }
      if (fm < 0) return metAt(k, sa < 0, ta + ((tm - ta) * fa) / (fa - fm));
      if (tm < tb) {
        const fb = qb - groundIn(h00, h10, h01, h11, ub, vb, sb < 0);
        if (fb < 0) return metAt(k, sb < 0, tm + ((tb - tm) * fm) / (fm - fb));
      }
    }
    if (tb >= t1) return Infinity;
    if (tx < tz) {
      i += di;
      if (i < 0 || i > nx - 2) return Infinity;
      tx = ((dx > 0 ? i + 1 : i) * cell - ox) * ix;
    } else {
      j += dj;
      if (j < 0 || j > hf.nz - 2) return Infinity;
      tz = ((dz > 0 ? j + 1 : j) * cell - oz) * iz;
    }
    ta = tb;
    qa = qb;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The ground at (u, v) within a cell, in stored units, on its upper triangle or its lower one. heightAt splits a cell the same way. */
function groundIn(h00: number, h10: number, h01: number, h11: number, u: number, v: number, upper: boolean): number {
  return upper ? h00 + (h11 - h01) * u + (h01 - h00) * v : h00 + (h10 - h00) * u + (h11 - h10) * v;
}

function metAt(cell: number, upper: boolean, t: number): number {
  groundCell = cell;
  groundUpper = upper;
  return t;
}

/** The direction must be a unit vector, and `maxT` is in metres. Fills `rayHit` and returns the HIT_ kind. */
export function castWorld(w: CollisionWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const hf = w.hf;
  let best = maxT;
  let kind = HIT_NONE;
  let ref = 0;
  // The face of the box hit, in the box's frame, and the sine and cosine of that frame's yaw. Axis 3 is a convex part's face,
  // whose normal is kept as it is in the world.
  let faceAxis = -1;
  let faceSign = 0;
  let faceS = 0;
  let faceC = 1;
  let partNx = 0;
  let partNy = 0;
  let partNz = 0;

  const ground = rayGround(hf, ox, oy, oz, dx, dy, dz, maxT);
  if (ground <= maxT) {
    best = ground;
    kind = HIT_TERRAIN;
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
        frameOf(t.yaw[slot]!);
        const s = frame.sin;
        const c = frame.cos;
        // The ray in the structure's frame, in the frame's own lengths, so the boxes are as written.
        const shrink = 1 / frame.stretch;
        const px = ox - t.x[slot]!;
        const pz = oz - t.z[slot]!;
        const lx = (c * px - s * pz) * shrink;
        const ly = oy - t.y[slot]!;
        const lz = (s * px + c * pz) * shrink;
        const ldx = (c * dx - s * dz) * shrink;
        const ldz = (s * dx + c * dz) * shrink;
        const box = structs.parts.box;
        for (let p = structs.parts.start[k]! * 6, end = structs.parts.start[k + 1]! * 6; p < end; p += 6) {
          const bx = box[p]!;
          const by = box[p + 1]!;
          const bz = box[p + 2]!;
          const hx = box[p + 3]! + SEAL;
          const hy = box[p + 4]!;
          const hz = box[p + 5]! + SEAL;
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
        // Convex parts are placed in the world's own axes, by the frame's whole-number vectors.
        const hulls = structs.parts.hulls;
        for (let p = hulls ? hulls.start[k]! : 0, end = hulls ? hulls.start[k + 1]! : 0; p < end; p++) {
          const hit = rayHull(hulls!, p, t.yaw[slot]!, px, ly, pz, dx, dy, dz, SEAL);
          if (hit >= best) continue;
          best = hit;
          kind = pass === 0 ? HIT_STRUCTURE : HIT_NODE;
          ref = r;
          faceAxis = hullFace.ny === 0 && hullFace.nx === 0 && hullFace.nz === 0 ? -1 : 3;
          partNx = hullFace.nx;
          partNy = hullFace.ny;
          partNz = hullFace.nz;
        }
      }
    }
  }
  rayHit.kind = kind;
  rayHit.t = best;
  rayHit.ref = ref;
  if (kind === HIT_TERRAIN) {
    // The face met, as drawn: its rise per metre along x and along z.
    const k = groundCell;
    const nx = hf.nx;
    const hts = hf.heights;
    const rise = hf.stepY / hf.cell;
    const sx = (groundUpper ? hts[k + nx + 1]! - hts[k + nx]! : hts[k + 1]! - hts[k]!) * rise;
    const sz = (groundUpper ? hts[k + nx]! - hts[k]! : hts[k + nx + 1]! - hts[k + 1]!) * rise;
    const l = Math.sqrt(sx * sx + 1 + sz * sz);
    rayHit.nx = -sx / l;
    rayHit.ny = 1 / l;
    rayHit.nz = -sz / l;
  } else if (kind !== HIT_NONE && faceAxis === 3) {
    rayHit.nx = partNx;
    rayHit.ny = partNy;
    rayHit.nz = partNz;
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
