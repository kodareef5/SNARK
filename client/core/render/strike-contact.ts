// A landed blow catches for a moment before the hand draws back.

import { actElapsed, smooth, type AnimState } from "../../../shared/anim/pose.ts";
import { ACT_SWING, FISTS, SWING_TICKS } from "../../../shared/sim/weapon.ts";

const BITE = FISTS.strikeTick;
const HOLD = 1.25;

/** The first-person arms' sample tick when the server confirmed contact at `heard`. */
export function caughtStrikeTick(st: AnimState, tick: number, heard: number): number {
  if ((st.action & 7) !== ACT_SWING || tick < heard || tick - heard >= SWING_TICKS) return tick;
  const age = actElapsed(st, tick);
  const heardAt = heard - (tick - age);
  // A late reply must never arrest a withdrawing arm or the next blow's windup.
  if (heardAt < BITE - 1 || heardAt > BITE + 3 || age >= SWING_TICKS) return tick;
  const bite = Math.max(BITE, heardAt);
  const since = age - bite;
  if (since <= 0) return tick;
  const recovery = smooth((since - HOLD) / (SWING_TICKS - bite - HOLD));
  return tick - Math.min(since, HOLD) * (1 - recovery);
}
