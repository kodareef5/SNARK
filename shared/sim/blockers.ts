// Bodies others cannot walk through. Each is a stadium in plan: a segment along its facing with a radius about it
// (SpeciesDef.footprint, measured from its rig's torso and legs), standing from where it stands to its collision height.
// The walker is one too, so a ridden rex meets a standing trike with its whole body and not only about its hips. A walker
// is pushed level out of every one it overlaps inside its own step (shared/sim/character.ts), before the walls have
// their say, so no body is ever pushed into a wall; and a long walker does not turn its body into one (`turnFree`).
//
// A body standing still is solid: its stadium is where the snapshot shows it, on the server and in the prediction of
// every client alike, so walking into a standing rex is predicted to the bit. A body that moves pushes a walker out no
// faster than BLOCK_SOFT_SPEED, so where a client's guess of it is a little off the correction is small and smoothed.
//
// Who blocks whom is the caller's to say when it fills the list (server/blocking.ts, client/core/session.ts): the same
// rules on both sides, from what the snapshot carries.

import { detCos, detSin } from "../math/scalar.ts";
import type { Registry } from "../content/registry.ts";

/** Metres a second at which a moving body pushes a walker out of it. */
export const BLOCK_SOFT_SPEED = 2.5;
/** The most bodies one walker meets in a step: the nearest. */
export const BLOCK_MOST = 8;
/** Of a walker's radius, the most a standing body pushes it in one substep: a body found deep inside one comes out over a few. */
const HARD_SHARE = 0.45;
/** Metres a walker must be inside a body at the start of its step for it to push only softly. */
const INSIDE_SKIN = 0.05;
/** A body lighter than this share of the walker does not stop it: a survivor walks through a dodo, and a rex through a survivor. */
export const BLOCK_LIGHT = 0.75;
const TAU = Math.PI * 2;

/** Kilograms, for which bodies stop which: its species' mass, or for one with none (a survivor) about 80 kg by its build. */
export function blockMass(reg: Registry, kind: number): number {
  const m = reg.mass[kind]!;
  return m > 0 ? m : 110 * reg.bodyRadius[kind]! * reg.bodyHeight[kind]!;
}

/** The two ends in plan of the segment of a body of `kind` at (x, z) facing `yaw` radians, into `out` as ax, az, bx, bz. */
export function stadium(reg: Registry, kind: number, x: number, z: number, yaw: number, out: Float64Array): void {
  const r = reg.footRadius[kind]!;
  let s0 = reg.footBack[kind]! + r, s1 = reg.footFront[kind]! - r;
  if (s0 > s1) s0 = s1 = (s0 + s1) / 2;
  if (s0 === 0 && s1 === 0) {
    out[0] = out[2] = x;
    out[1] = out[3] = z;
    return;
  }
  const fx = detSin(yaw), fz = detCos(yaw);
  out[0] = x + fx * s0;
  out[1] = z + fz * s0;
  out[2] = x + fx * s1;
  out[3] = z + fz * s1;
}

/** The closest points of segments AB and CD in plan, as `near` p (on AB) and q (on CD); the square of their distance. */
const near = { px: 0, pz: 0, qx: 0, qz: 0 };
function closest(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz;
  const a = ux * ux + uz * uz, e = vx * vx + vz * vz, f = vx * wx + vz * wz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    s = t = 0;
  } else if (a <= 1e-12) {
    t = f / e;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  } else {
    const c = ux * wx + uz * wz;
    if (e <= 1e-12) {
      s = -c / a;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
    } else {
      const b = ux * vx + uz * vz, den = a * e - b * b;
      s = den > 1e-12 ? (b * f - c * e) / den : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = -c / a;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
      } else if (t > 1) {
        t = 1;
        s = (b - c) / a;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
      }
    }
  }
  near.px = ax + ux * s;
  near.pz = az + uz * s;
  near.qx = cx + vx * t;
  near.qz = cz + vz * t;
  const ddx = near.px - near.qx, ddz = near.pz - near.qz;
  return ddx * ddx + ddz * ddz;
}

const seg = new Float64Array(4);

export class Blockers {
  count = 0;
  /** The content the shapes are read from, as the last `add` gave it. */
  reg: Registry | null = null;
  readonly id = new Int32Array(BLOCK_MOST);
  /** The segment's two ends in plan, the radius about it, and the band of heights it stands over. */
  readonly ax = new Float64Array(BLOCK_MOST);
  readonly az = new Float64Array(BLOCK_MOST);
  readonly bx = new Float64Array(BLOCK_MOST);
  readonly bz = new Float64Array(BLOCK_MOST);
  readonly r = new Float64Array(BLOCK_MOST);
  readonly y0 = new Float64Array(BLOCK_MOST);
  readonly y1 = new Float64Array(BLOCK_MOST);
  /** 1 for a body that moves, or that the walker began its step inside, which pushes softly. */
  readonly soft = new Uint8Array(BLOCK_MOST);
  /** How far each is from the walker it is gathered for, to keep the nearest. */
  private readonly far = new Float64Array(BLOCK_MOST);

  clear(): void {
    this.count = 0;
  }

  /**
   * Adds body `id` of `kind` standing at (x, y, z) facing `yaw` radians (+Z at 0, +X at a quarter turn), moving or not,
   * for a walker of kind `walker` standing at (wx, wy, wz) facing `wyaw` (Body.yaw, 65536ths of a turn). A body lighter
   * than BLOCK_LIGHT of the walker is not added unless `always`. One the walker already stands in pushes softly, so
   * whatever put it there it walks out. Past BLOCK_MOST the farthest goes. Entries are kept in ascending id, so that both
   * ends push in one order.
   */
  add(reg: Registry, id: number, kind: number, x: number, y: number, z: number, yaw: number, moving: boolean, walker: number, wx: number, wy: number, wz: number, wyaw: number, always = false): void {
    this.reg = reg;
    const r = reg.footRadius[kind]!;
    if (!(r > 0) || (!always && blockMass(reg, kind) < blockMass(reg, walker) * BLOCK_LIGHT)) return;
    const far = (x - wx) * (x - wx) + (z - wz) * (z - wz);
    let n = this.count;
    if (n === BLOCK_MOST) {
      let worst = 0;
      for (let k = 1; k < n; k++) if (this.far[k]! > this.far[worst]! || (this.far[k] === this.far[worst] && this.id[k]! > this.id[worst]!)) worst = k;
      if (far > this.far[worst]! || (far === this.far[worst] && id > this.id[worst]!)) return;
      this.remove(worst);
      n--;
    }
    // Into its place in ascending id.
    let at = n;
    while (at > 0 && this.id[at - 1]! > id) {
      this.move(at - 1, at);
      at--;
    }
    stadium(reg, kind, x, z, yaw, seg);
    this.id[at] = id;
    this.ax[at] = seg[0]!;
    this.az[at] = seg[1]!;
    this.bx[at] = seg[2]!;
    this.bz[at] = seg[3]!;
    this.r[at] = r;
    this.y0[at] = y;
    this.y1[at] = y + reg.bodyHeight[kind]!;
    this.far[at] = far;
    this.count = n + 1;
    this.soft[at] = moving || depth(this, at, reg, walker, wx, wy, wz, (wyaw * TAU) / 65536, reg.bodyHeight[walker]!) > INSIDE_SKIN ? 1 : 0;
  }

  private move(from: number, to: number): void {
    this.id[to] = this.id[from]!;
    this.ax[to] = this.ax[from]!;
    this.az[to] = this.az[from]!;
    this.bx[to] = this.bx[from]!;
    this.bz[to] = this.bz[from]!;
    this.r[to] = this.r[from]!;
    this.y0[to] = this.y0[from]!;
    this.y1[to] = this.y1[from]!;
    this.soft[to] = this.soft[from]!;
    this.far[to] = this.far[from]!;
  }

  private remove(k: number): void {
    for (let j = k + 1; j < this.count; j++) this.move(j, j - 1);
    this.count--;
  }
}

/** How far a walker of `kind` at (x, y, z) facing `yaw` radians, `h` tall, is inside entry `k`: 0 where it is clear. Leaves `near` set. */
function depth(bl: Blockers, k: number, reg: Registry, kind: number, x: number, y: number, z: number, yaw: number, h: number): number {
  if (y + h <= bl.y0[k]! || y >= bl.y1[k]!) return 0;
  stadium(reg, kind, x, z, yaw, seg);
  const d2 = closest(seg[0]!, seg[1]!, seg[2]!, seg[3]!, bl.ax[k]!, bl.az[k]!, bl.bx[k]!, bl.bz[k]!);
  const reach = reg.footRadius[kind]! + bl.r[k]!;
  return d2 < reach * reach ? reach - Math.sqrt(d2) : 0;
}

/** Where `pushOut` left the walker. */
export const blockOut = { x: 0, z: 0 };

/**
 * A walker of `kind`, `h` tall, standing at (x, y, z) facing `yaw` (Body.yaw), pushed level out of each body in `bl` it
 * overlaps, in order: by as much as it is in, at most HARD_SHARE of its radius, or for a soft one by at most `soft`
 * metres. Leaves the place in `blockOut`; whether it moved.
 */
export function pushOut(bl: Blockers, kind: number, x: number, y: number, z: number, yaw: number, h: number, soft: number): boolean {
  let moved = false;
  const reg = bl.reg!;
  const r = reg.footRadius[kind]!;
  const hard = r * HARD_SHARE;
  const turn = (yaw * TAU) / 65536;
  for (let k = 0; k < bl.count; k++) {
    let d = depth(bl, k, reg, kind, x, y, z, turn, h);
    if (d <= 0) continue;
    // Out along the line between the nearest points, from the body's to the walker's.
    let dx = near.px - near.qx, dz = near.pz - near.qz;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-6) {
      // On the body's own line: out to its side, the one square to its facing (or +X for a round one).
      const sx = bl.bx[k]! - bl.ax[k]!, sz = bl.bz[k]! - bl.az[k]!, sl = Math.sqrt(sx * sx + sz * sz);
      dx = sl > 0 ? sz / sl : 1;
      dz = sl > 0 ? -sx / sl : 0;
    } else {
      dx /= l;
      dz /= l;
    }
    const most = bl.soft[k] !== 0 ? soft : hard;
    if (d > most) d = most;
    x += dx * d;
    z += dz * d;
    moved = true;
  }
  blockOut.x = x;
  blockOut.z = z;
  return moved;
}

/**
 * Whether a walker of `kind`, `h` tall, at (x, y, z) may turn from facing `from` to facing `to` (Body.yaw both): not if
 * at `to` it would be further into a body that stands still than it is now. A round walker always may.
 */
export function turnFree(bl: Blockers, kind: number, x: number, y: number, z: number, from: number, to: number, h: number): boolean {
  const reg = bl.reg!;
  if (from === to || reg.footFront[kind]! - reg.footBack[kind]! <= 2 * reg.footRadius[kind]!) return true;
  const a = (from * TAU) / 65536, b = (to * TAU) / 65536;
  for (let k = 0; k < bl.count; k++) {
    if (bl.soft[k] !== 0) continue;
    const now = depth(bl, k, reg, kind, x, y, z, b, h);
    if (now > INSIDE_SKIN && now > depth(bl, k, reg, kind, x, y, z, a, h) + 1e-6) return false;
  }
  return true;
}
