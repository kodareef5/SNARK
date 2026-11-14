// A client-only picture of structures collapsing. It decides nothing and collides with nothing. Pieces let go in a
// front moving outward from where the collapse began, then drop. Only the MAX_FALLING nearest the eye are shown.

import { TICK_DT, YAW_UNITS } from "../../shared/coords.ts";
import { GONE_FELL } from "../../shared/world/structures.ts";
import { MAX_FALLING } from "./render/packet.ts";
import type { Rubble } from "./session.ts";

/** Metres per second squared. */
export const FALL_GRAVITY = 9.81;
/** A piece waits this long per metre it is farther from the origin than the nearest piece of its removal. The front moves at 40 m/s. */
export const FRONT_MS_PER_METRE = 25;
export const MAX_WAIT_MS = 600;
/** Drift away from the collapse origin in metres per second, and the most a piece turns in yaw units per second. */
const DRIFT = 0.9;
const SPIN = YAW_UNITS / 12;
/** A piece still in the air after this long is dropped. */
const MAX_LIFE_MS = 4000;

export class Falling {
  /** Pieces shown this frame. Positions are in metres, yaw in yaw units. */
  count = 0;
  readonly kind = new Uint16Array(MAX_FALLING);
  readonly x = new Float32Array(MAX_FALLING);
  readonly y = new Float32Array(MAX_FALLING);
  readonly z = new Float32Array(MAX_FALLING);
  readonly yaw = new Uint16Array(MAX_FALLING);
  /** Pieces taken in since the start, and how many were dropped for lack of room. */
  taken = 0;
  dropped = 0;

  // start is when a piece lets go. under is the height of its middle at which the ground covers all of it.
  private readonly x0 = new Float32Array(MAX_FALLING);
  private readonly y0 = new Float32Array(MAX_FALLING);
  private readonly z0 = new Float32Array(MAX_FALLING);
  private readonly yaw0 = new Uint16Array(MAX_FALLING);
  private readonly start = new Float64Array(MAX_FALLING);
  private readonly vx = new Float32Array(MAX_FALLING);
  private readonly vz = new Float32Array(MAX_FALLING);
  private readonly spin = new Float32Array(MAX_FALLING);
  private readonly under = new Float32Array(MAX_FALLING);
  private readonly halfY: Float32Array;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly nearest = new Map<number, number>();

  /** `halfY` is the half height of each kind of structure, by content index. */
  constructor(halfY: Float32Array, heightAt: (x: number, z: number) => number) {
    this.halfY = halfY;
    this.heightAt = heightAt;
  }

  /** Empties `list`. If there is not room for all, the pieces nearest the eye (ex, ey, ez) are shown. */
  absorb(list: Rubble[], nowMs: number, ex: number, ey: number, ez: number): void {
    if (list.length === 0) return;
    // Pieces of one removal share a tick. `nearest` maps that tick to the distance of its nearest piece from the origin.
    const nearest = this.nearest;
    nearest.clear();
    let first = Infinity;
    for (const r of list) {
      if (r.tick < first) first = r.tick;
      const d = Math.hypot(r.x - r.ox, r.y - r.oy, r.z - r.oz);
      const known = nearest.get(r.tick);
      if (known === undefined || d < known) nearest.set(r.tick, d);
    }
    let far = -1;
    let farAt = -1;
    for (const r of list) {
      this.taken++;
      const d2 = (r.x - ex) * (r.x - ex) + (r.y - ey) * (r.y - ey) + (r.z - ez) * (r.z - ez);
      let i = this.count;
      if (i === MAX_FALLING) {
        // No room. It replaces the farthest piece shown if it is nearer.
        if (farAt < 0) {
          for (let k = 0; k < MAX_FALLING; k++) {
            const q = (this.x0[k]! - ex) * (this.x0[k]! - ex) + (this.y0[k]! - ey) * (this.y0[k]! - ey) + (this.z0[k]! - ez) * (this.z0[k]! - ez);
            if (q > far) {
              far = q;
              farAt = k;
            }
          }
        }
        this.dropped++;
        if (d2 >= far) continue;
        i = farAt;
        far = farAt = -1;
      } else this.count++;
      const dx = r.x - r.ox;
      const dz = r.z - r.oz;
      const flat = Math.hypot(dx, dz);
      const d = Math.hypot(flat, r.y - r.oy);
      const fell = r.cause === GONE_FELL;
      const wait = fell ? (r.tick - first) * TICK_DT * 1000 + (d - nearest.get(r.tick)!) * FRONT_MS_PER_METRE : 0;
      // The spin is hashed from the position, so a piece turns the same way on every client.
      const h = (Math.imul(Math.round(r.x * 8), 73856093) ^ Math.imul(Math.round(r.y * 8), 19349663) ^ Math.imul(Math.round(r.z * 8), 83492791)) >>> 0;
      this.kind[i] = r.kind;
      this.x0[i] = r.x;
      this.y0[i] = r.y;
      this.z0[i] = r.z;
      this.yaw0[i] = r.yaw;
      this.start[i] = nowMs + (wait < MAX_WAIT_MS ? wait : MAX_WAIT_MS);
      this.vx[i] = fell && flat > 0.01 ? (dx / flat) * DRIFT : 0;
      this.vz[i] = fell && flat > 0.01 ? (dz / flat) * DRIFT : 0;
      this.spin[i] = ((h % 2001) / 1000 - 1) * SPIN;
      this.under[i] = this.heightAt(r.x, r.z) - (this.halfY[r.kind] ?? 0);
    }
    list.length = 0;
  }

  step(nowMs: number): void {
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const ms = nowMs - this.start[i]!;
      const t = ms > 0 ? ms / 1000 : 0;
      const y = this.y0[i]! - 0.5 * FALL_GRAVITY * t * t;
      if (y < this.under[i]! || ms > MAX_LIFE_MS) continue;
      if (kept !== i) {
        this.kind[kept] = this.kind[i]!;
        this.x0[kept] = this.x0[i]!;
        this.y0[kept] = this.y0[i]!;
        this.z0[kept] = this.z0[i]!;
        this.yaw0[kept] = this.yaw0[i]!;
        this.start[kept] = this.start[i]!;
        this.vx[kept] = this.vx[i]!;
        this.vz[kept] = this.vz[i]!;
        this.spin[kept] = this.spin[i]!;
        this.under[kept] = this.under[i]!;
      }
      this.x[kept] = this.x0[i]! + this.vx[i]! * t;
      this.y[kept] = y;
      this.z[kept] = this.z0[i]! + this.vz[i]! * t;
      this.yaw[kept] = (this.yaw0[i]! + Math.round(this.spin[i]! * t)) & (YAW_UNITS - 1);
      kept++;
    }
    this.count = kept;
  }
}
