// Structures as they are seen to go.
//
// The server says only that pieces went, why, where it began and when; the
// session erases their rows and keeps what they were (`ClientSession.rubble`).
// What is seen of it is this client's own picture, and decides nothing: each
// piece stays where it stood for a moment, then drops under gravity, drifting
// outward from where the collapse began and turning a little, and is gone
// when the ground has all of it. It collides with nothing.
//
// The server works a great collapse out over many ticks, nearest to where it
// began first, so the order in time is mostly the server's own. What is added
// here is the order inside one removal (the further from its beginning the
// later, by a little) and between removals that arrived together (by the
// ticks they happened on), so that what reaches the eye is a front moving
// outward and never a block vanishing at once.
//
// Only so many are shown at a time, the nearest to the eye. The rest are
// simply gone, as they already are on the server. A thousand pieces falling
// costs a client what a few hundred moving boxes do.

import { TICK_DT, YAW_UNITS } from "../../shared/coords.ts";
import { GONE_FELL } from "../../shared/world/structures.ts";
import { MAX_FALLING } from "./render/packet.ts";
import type { Rubble } from "./session.ts";

/** How fast a falling piece gathers speed, metres per second per second. */
export const FALL_GRAVITY = 9.81;
/** A piece waits this long for each metre it is from the nearest piece of the same removal, milliseconds: a front at 40 m/s. */
export const FRONT_MS_PER_METRE = 25;
/** No piece waits longer than this, however far off and however late its removal: milliseconds. */
export const MAX_WAIT_MS = 600;
/** How fast a fallen piece drifts away from where the collapse began, metres per second; and the most it turns, yaw units per second. */
const DRIFT = 0.9;
const SPIN = YAW_UNITS / 12;
/** A piece still in the air after this long is gone anyway: milliseconds. */
const MAX_LIFE_MS = 4000;

export class Falling {
  /** Pieces being shown, and where each is this frame: what it is, metres, and its facing in yaw units. */
  count = 0;
  readonly kind = new Uint16Array(MAX_FALLING);
  readonly x = new Float32Array(MAX_FALLING);
  readonly y = new Float32Array(MAX_FALLING);
  readonly z = new Float32Array(MAX_FALLING);
  readonly yaw = new Uint16Array(MAX_FALLING);
  /** Pieces taken in since the start, and how many gave way to nearer ones because there was no room. */
  taken = 0;
  dropped = 0;

  // Where each stood, when it lets go, how it drifts and turns, and the height of its middle at which the ground has all of it.
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

  /**
   * Take in what has just gone, emptying `list`. The eye is at (ex, ey, ez):
   * if there is not room for all, the nearest to it are the ones shown.
   */
  absorb(list: Rubble[], nowMs: number, ex: number, ey: number, ez: number): void {
    if (list.length === 0) return;
    // The earliest tick among them, and for each removal (they share a tick) how far its nearest piece is from where it began.
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
        // No room: it takes the place of the farthest shown, if it is nearer than that.
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
      // The same piece turns the same way on every client: from where it stood.
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

  /** Work out where every piece is at `nowMs`, and let go of those the ground has. */
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
