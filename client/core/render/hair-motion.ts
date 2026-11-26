// Long hair's guides: four bone rows after a body's face rows, which the curtain or tail of a long style takes in place
// of the upper chest at its finest level (faces.ts makes that hair). A guide is the head's row turned about the head's
// joint: back by the share of the head's own turn the hair does not follow, so it keeps hanging as the head nods and
// turns with it as it looks round, and then by its swing, a bounded spring the head's motion moves.

import { B_HEAD, B_UPPER_CHEST, HUMAN_BONES } from "../../../shared/anim/human.ts";
import type { Solved } from "../../../shared/anim/skeleton.ts";
import { quatMulConj, quatNlerp, quatNormalize } from "../../../shared/math/quat.ts";
import { SKIN_BYTES } from "../../../shared/pack/pack.ts";
import { FACE_ROWS } from "../../../shared/people/faces.ts";
import { BONE_FLOATS } from "./packet.ts";

export const HAIR_ROWS = 4;
/** The first guide's bone: a body's thirty, then its face rows. */
export const HAIR_ROW = HUMAN_BONES + FACE_ROWS;
/** Where each guide hangs round the head, degrees from the front towards the head's left. */
const GUIDES = [90, 150, 210, 270];
/** Shares of the head's turn on the upper chest the guides follow: about the chest's upright, and the rest. */
const FOLLOW_TURN = 0.75;
const FOLLOW_NOD = 0.2;
/** A guide's reach from the head's joint, metres, its spring's pull a second squared and damping a second, and the most it swings, radians. */
const REACH = 0.12;
const PULL = 100;
const DAMPING = 4;
const SWING = 0.35;
/** Bodies whose swing is kept; the least lately moved gives way. */
const KEPT = 64;
/** A body not moved for longer than this, seconds, starts again at rest. */
const STALE = 0.25;

/**
 * Puts the guide rows into a hair mesh's skin in place of the upper chest, each vertex's share split between the two
 * guides on either side of it round the head. `rest` is its vertices at rest, (`cx`, `cz`) the head's middle seen from
 * above. False where no vertex follows the upper chest: such hair has no guides.
 */
export function guideSkin(rest: Float32Array, skin: Uint8Array, n: number, cx: number, cz: number): boolean {
  let any = false;
  for (let v = 0; v < n; v++) {
    const at = v * SKIN_BYTES;
    for (let j = 0; j < 4; j++) {
      const w = skin[at + 4 + j]!;
      if (skin[at + j] !== B_UPPER_CHEST || w === 0) continue;
      any = true;
      const phi = ((Math.atan2(rest[v * 3]! - cx, rest[v * 3 + 2]! - cz) * 180) / Math.PI + 360) % 360;
      let a = 0;
      while (a + 1 < GUIDES.length && phi > GUIDES[a + 1]!) a++;
      const t = Math.min(1, Math.max(0, (phi - GUIDES[a]!) / (GUIDES[Math.min(a + 1, GUIDES.length - 1)]! - GUIDES[a]! || 1)));
      let free = -1;
      for (let q = 0; q < 4; q++) if (q !== j && skin[at + 4 + q] === 0) { free = q; break; }
      const second = free >= 0 ? Math.round(w * t) : 0;
      skin[at + j] = HAIR_ROW + (second === 0 && t > 0.5 ? a + 1 : a);
      skin[at + 4 + j] = w - second;
      if (second > 0) {
        skin[at + free] = HAIR_ROW + a + 1;
        skin[at + 4 + free] = second;
      }
    }
  }
  return any;
}

/** The swing of each groomed body's guides, kept between frames, and the work of writing their rows. */
export class HairMotion {
  private readonly ids = new Int32Array(KEPT).fill(-1);
  private readonly last = new Float64Array(KEPT);
  /** Each guide's tip and where it was a step before, in the world. */
  private readonly tip = new Float64Array(KEPT * HAIR_ROWS * 3);
  private readonly was = new Float64Array(KEPT * HAIR_ROWS * 3);
  private readonly q = new Float64Array(12);
  private readonly m = new Float64Array(12);
  /** Guides written, as the bench counts them. */
  written = 0;

  /**
   * Writes the guide rows of the body posed from bone `first` in `bones`, on its rig at rest `rest`, posed as `solved`,
   * at `tick` (seconds are ticks over `rate`). Its rows are relative to the camera at (`cx`, `cy`, `cz`).
   */
  rows(bones: Float32Array, first: number, rest: Float32Array, solved: Solved, id: number, tick: number, rate: number, cx: number, cy: number, cz: number): void {
    const k = this.slotOf(id);
    const dt = (tick - this.last[k]!) / rate;
    const fresh = this.ids[k] !== id || !(dt >= 0 && dt <= STALE);
    this.ids[k] = id;
    this.last[k] = tick;
    const q = this.q, rot = solved.rot;
    // The head's turn on the upper chest, its turn about the chest's upright, and the share of each the hair follows.
    quatMulConj(q, 0, rot, B_UPPER_CHEST * 4, rot, B_HEAD * 4);
    q[4] = 0; q[5] = q[1]!; q[6] = 0; q[7] = q[3]!;
    quatNormalize(q, 4);
    // The nod is the turn less its twist, q * conj(twist), so q = nod * twist.
    const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!, ty = q[5]!, tw = q[7]!;
    q[8] = x * tw + z * ty; q[9] = y * tw - w * ty; q[10] = z * tw - x * ty; q[11] = w * tw + y * ty;
    quatNlerp(q, 8, IDENTITY, 0, q, 8, FOLLOW_NOD);
    quatNlerp(q, 4, IDENTITY, 0, q, 4, FOLLOW_TURN);
    // What the hair follows, nod then twist; turned in the head's rest, that is conj(head on chest) times it.
    mul(q, 4, q, 8, q, 4);
    quatMulConj(q, 4, q, 0, q, 4);
    const head = (first + B_HEAD) * BONE_FLOATS, m = this.m;
    const px = rest[B_HEAD * 3]!, py = rest[B_HEAD * 3 + 1]!, pz = rest[B_HEAD * 3 + 2]!;
    turnedRow(bones, head, m, q[4]!, q[5]!, q[6]!, q[7]!, px, py, pz);
    // The head's joint, posed, relative to the camera.
    const jx = row(bones, head, 0, px, py, pz), jy = row(bones, head, 1, px, py, pz), jz = row(bones, head, 2, px, py, pz);
    for (let g = 0; g < HAIR_ROWS; g++) {
      const phi = (GUIDES[g]! * Math.PI) / 180;
      const rx = px + 0.4 * Math.sin(phi) * REACH, ry = py - 0.9 * REACH, rz = pz + 0.4 * Math.cos(phi) * REACH;
      // Where the guide's tip hangs, and where it was, in the world.
      const ax = m[0]! * rx + m[1]! * ry + m[2]! * rz + m[3]! - jx, ay = m[4]! * rx + m[5]! * ry + m[6]! * rz + m[7]! - jy, az = m[8]! * rx + m[9]! * ry + m[10]! * rz + m[11]! - jz;
      const at = (k * HAIR_ROWS + g) * 3, tip = this.tip, was = this.was;
      const wx = jx + cx, wy = jy + cy, wz = jz + cz;
      if (fresh) {
        tip[at] = was[at] = wx + ax; tip[at + 1] = was[at + 1] = wy + ay; tip[at + 2] = was[at + 2] = wz + az;
      } else if (dt > 0) {
        const keep = Math.exp(-DAMPING * dt), pull = Math.min(1, PULL * dt * dt);
        for (let a = 0; a < 3; a++) {
          const x = tip[at + a]!, goal = (a === 0 ? wx + ax : a === 1 ? wy + ay : wz + az);
          tip[at + a] = x + (x - was[at + a]!) * keep + (goal - x) * pull;
          was[at + a] = x;
        }
      }
      // Held at its reach from the joint, and within its swing of where it hangs.
      let dx = tip[at]! - wx, dy = tip[at + 1]! - wy, dz = tip[at + 2]! - wz;
      const reach = Math.hypot(ax, ay, az) || 1, ux = ax / reach, uy = ay / reach, uz = az / reach;
      let l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const c = dx * ux + dy * uy + dz * uz;
      if (c < Math.cos(SWING)) {
        let ox = dx - ux * c, oy = dy - uy * c, oz = dz - uz * c;
        l = Math.hypot(ox, oy, oz) || 1;
        ox /= l; oy /= l; oz /= l;
        dx = ux * Math.cos(SWING) + ox * Math.sin(SWING); dy = uy * Math.cos(SWING) + oy * Math.sin(SWING); dz = uz * Math.cos(SWING) + oz * Math.sin(SWING);
      }
      tip[at] = wx + dx * reach; tip[at + 1] = wy + dy * reach; tip[at + 2] = wz + dz * reach;
      // The swing: the shortest turn from where it hangs to where it is, about the joint.
      const sx = uy * dz - uz * dy, s2 = uz * dx - ux * dz, sz = ux * dy - uy * dx, s = 1 + ux * dx + uy * dy + uz * dz;
      swungRow(bones, (first + HAIR_ROW + g) * BONE_FLOATS, m, sx, s2, sz, s, jx, jy, jz);
      this.written++;
    }
  }

  /** The kept slot of body `id`, or the least lately moved one, taken for it. */
  private slotOf(id: number): number {
    let old = 0;
    for (let k = 0; k < KEPT; k++) {
      if (this.ids[k] === id) return k;
      if (this.ids[k]! < 0) return k;
      if (this.last[k]! < this.last[old]!) old = k;
    }
    return old;
  }
}

const IDENTITY = [0, 0, 0, 1];

/** o = a * b for quaternions in one array. */
function mul(o: Float64Array, oi: number, a: Float64Array, ai: number, b: Float64Array, bi: number): void {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!, bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Row `r` of the bone row at `at` applied to (x, y, z). */
const row = (b: Float32Array, at: number, r: number, x: number, y: number, z: number): number => b[at + r * 4]! * x + b[at + r * 4 + 1]! * y + b[at + r * 4 + 2]! * z + b[at + r * 4 + 3]!;

/** `out` = the bone row at `from` after turning by the unit quaternion (x, y, z, w) about (px, py, pz) of its rest. */
function turnedRow(b: Float32Array, from: number, out: Float64Array, x: number, y: number, z: number, w: number, px: number, py: number, pz: number): void {
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  // The turn keeps the pivot where it is: it moves a point by p - R p.
  const ox = px - (r00 * px + r01 * py + r02 * pz), oy = py - (r10 * px + r11 * py + r12 * pz), oz = pz - (r20 * px + r21 * py + r22 * pz);
  for (let r = 0; r < 3; r++) {
    const a0 = b[from + r * 4]!, a1 = b[from + r * 4 + 1]!, a2 = b[from + r * 4 + 2]!, t = b[from + r * 4 + 3]!;
    out[r * 4] = a0 * r00 + a1 * r10 + a2 * r20;
    out[r * 4 + 1] = a0 * r01 + a1 * r11 + a2 * r21;
    out[r * 4 + 2] = a0 * r02 + a1 * r12 + a2 * r22;
    out[r * 4 + 3] = a0 * ox + a1 * oy + a2 * oz + t;
  }
}

/** Writes at `to` the row `m` turned in the world by the quaternion (x, y, z, w), not yet unit, about (jx, jy, jz). */
function swungRow(b: Float32Array, to: number, m: Float64Array, x: number, y: number, z: number, w: number, jx: number, jy: number, jz: number): void {
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  if (l < 1e-9) { x = 0; y = 0; z = 0; w = 1; } else { x /= l; y /= l; z /= l; w /= l; }
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
  for (let c = 0; c < 4; c++) {
    const a0 = m[c]! - (c === 3 ? jx : 0), a1 = m[4 + c]! - (c === 3 ? jy : 0), a2 = m[8 + c]! - (c === 3 ? jz : 0);
    b[to + c] = r00 * a0 + r01 * a1 + r02 * a2 + (c === 3 ? jx : 0);
    b[to + 4 + c] = r10 * a0 + r11 * a1 + r12 * a2 + (c === 3 ? jy : 0);
    b[to + 8 + c] = r20 * a0 + r21 * a1 + r22 * a2 + (c === 3 ? jz : 0);
  }
}
