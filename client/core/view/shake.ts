// The shake a blast or the viewer's own launcher gives the view: a few knocks, each ringing down, summed. It turns the
// view alone: the look the server is told does not move. Sight (client/core/sight.ts) reads it each frame, and the
// settings can turn it off.

/** Knocks that ring at once. A new one past these takes the place of the faintest. */
const KNOCKS = 4;
/** Milliseconds a knock rings for, and how fast it swings, radians a millisecond, each way. */
export const SHAKE_MS = 520;
const SWING_YAW = 0.071, SWING_PITCH = 0.093;
/** Radians the view turns at most, all knocks together (1.1 degrees), and under a finger. */
export const SHAKE_MOST = (1.1 * Math.PI) / 180;
export const SHAKE_TOUCH = SHAKE_MOST / 2;
/** A blast shakes a view within this many times its reach, and the viewer's own launch this hard. */
export const SHAKE_REACH = 6;
export const SHAKE_LAUNCH = 0.22;

/** How hard a blast `radius` metres in reach shakes a view `far` metres off, 0 to 1: a rocket's at arm's length is 1. */
export function blastShake(far: number, radius: number): number {
  const reach = radius * SHAKE_REACH;
  if (!(far < reach)) return 0;
  const near = 1 - far / reach;
  return Math.min(1, (radius / 7.5) * near * near);
}

export class Shake {
  private readonly began = new Float64Array(KNOCKS).fill(-Infinity);
  private readonly hard = new Float32Array(KNOCKS);
  private readonly turnOf = new Float32Array(KNOCKS);
  private knocks = 0;

  /** A knock at `nowMs`, `hard` from 0 to 1. */
  add(hard: number, nowMs: number): void {
    if (!(hard > 0.01)) return;
    let at = 0, least = Infinity;
    for (let k = 0; k < KNOCKS; k++) {
      const left = this.left(k, nowMs);
      if (left < least) {
        least = left;
        at = k;
      }
    }
    if (least >= hard) return;
    this.began[at] = nowMs;
    this.hard[at] = Math.min(1, hard);
    // Each knock swings its own way, so two do not ring as one.
    this.turnOf[at] = (this.knocks++ * 2.399) % (2 * Math.PI);
  }

  /** How much of knock `k` is left at `nowMs`. */
  private left(k: number, nowMs: number): number {
    const t = (nowMs - this.began[k]!) / SHAKE_MS;
    return t >= 0 && t < 1 ? this.hard[k]! * (1 - t) * (1 - t) : 0;
  }

  /** Whether anything rings at `nowMs`. */
  ringing(nowMs: number): boolean {
    for (let k = 0; k < KNOCKS; k++) if (this.left(k, nowMs) > 0) return true;
    return false;
  }

  /** Puts the view's turn at `nowMs` in `out`, yaw and pitch, no more than `most` either way. */
  turn(nowMs: number, most: number, out: Float64Array): void {
    let yaw = 0, pitch = 0;
    for (let k = 0; k < KNOCKS; k++) {
      const left = this.left(k, nowMs);
      if (left <= 0) continue;
      const t = nowMs - this.began[k]!;
      yaw += left * Math.sin(t * SWING_YAW + this.turnOf[k]!);
      pitch += left * Math.sin(t * SWING_PITCH + 1 + this.turnOf[k]!);
    }
    out[0] = Math.max(-1, Math.min(1, yaw)) * most;
    out[1] = Math.max(-1, Math.min(1, pitch)) * most;
  }
}
