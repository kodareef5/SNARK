// A held glass, the spyglass (D1082): raised with the secondary button, it clicks between its optic's steps on the wheel,
// shakes in the hand less crouched and least lying down, ranges what its middle is on with the primary, a second's
// lasing, and marks for the tribe with N what the look is on.

import type { KeyRow } from "./key-row.ts";
import { CMD_MARK } from "../../shared/net/protocol.ts";
import type { OpticFacet } from "../../shared/content/defs.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";

/** Milliseconds a range takes to find. */
export const LASE_MS = 1000;
/** Radians the hand shakes a glass at most, standing; crouched and lying, this share of it. */
export const SHAKE = 0.0007;
export const SHAKE_CROUCH = 0.45;
export const SHAKE_PRONE = 0.12;
/** Milliseconds the word that a mark was made stays. */
export const MARKED_MS = 1500;

export class Glass {
  /** Raised this frame. */
  up = false;
  /** Its place among its optic's steps. */
  step = 0;
  /** When the range now being found began, or -1; and the range found, metres (0 for none), and the bearing, degrees. */
  lasing = -1;
  range = 0;
  bearing = 0;
  /** When a mark was last made. */
  markedAt = -Infinity;

  /** The magnification its optic's step gives. */
  zoom(o: OpticFacet): number {
    const steps = o.steps ?? [o.min];
    return steps[Math.min(this.step, steps.length - 1)]!;
  }

  /** A turn of the wheel, down (positive) to widen and up to narrow: a step for each. */
  wheel(o: OpticFacet, notches: number): void {
    const last = (o.steps?.length ?? 1) - 1;
    if (notches !== 0) this.step = Math.min(last, Math.max(0, this.step - Math.sign(notches)));
  }

  /** Raises or lowers it; lowered, its range is forgotten. */
  raise(up: boolean): void {
    if (!up && this.up) {
      this.lasing = -1;
      this.range = 0;
    }
    this.up = up;
  }

  /** The primary pressed: a range begins. */
  lase(nowMs: number): void {
    this.lasing = nowMs;
    this.range = 0;
  }

  /** Once a range has lased a second, `found` gives it, metres (0 for nothing), at `heading` degrees. True as it ends. */
  ranged(nowMs: number, found: () => number, heading: number): boolean {
    if (this.lasing < 0 || nowMs - this.lasing < LASE_MS) return false;
    this.lasing = -1;
    this.range = found();
    this.bearing = heading;
    return true;
  }

  /** The hand's shake now, yaw and pitch in radians into `out`: two slow waves a way, by the stance. */
  shake(nowMs: number, stance: number, out: Float64Array | number[]): void {
    const a = SHAKE * (stance === STANCE_PRONE ? SHAKE_PRONE : stance === STANCE_CROUCH ? SHAKE_CROUCH : 1);
    const t = nowMs / 1000;
    out[0] = a * (0.6 * Math.sin(t * 1.7) + 0.4 * Math.sin(t * 4.3 + 1.1));
    out[1] = a * (0.6 * Math.sin(t * 1.3 + 0.7) + 0.4 * Math.sin(t * 3.7 + 2.3));
  }
}

// With a glass raised, N marks what the look is on for the tribe (D1082).
export const GLASS_KEYS: readonly KeyRow[] = [{
  name: "glass mark",
  keys: ["KeyN"],
  when: (c) => c.glass.up,
  press(c, _code, down, repeat) {
    const o = c.hud.overhead;
    if (down && !repeat && o.lookedId >= 0) {
      c.session.command(CMD_MARK, (w) => (w.u32(o.lookedId), w.u16(o.lookedGen)));
      c.glass.markedAt = c.nowMs;
    }
    return true;
  },
}];
