// What a contact does to a body is sorted by one number: the change of speed it takes, delta-v. A small one is a bump,
// drawn only; a larger one from someone to blame staggers it; a large one knocks it down. A body never staggers itself:
// running into a wall or a crowd is at most a bump.

import { detAtan2 } from "../math/scalar.ts";

export const TIER_NONE = 0;
/** Felt and drawn, but nothing changes: no shove, no lost control, no moved hit zones. */
export const TIER_BUMP = 1;
/** A shove and a short loss of control, with a reaction every machine draws alike. */
export const TIER_STAGGER = 2;
/** Knocked off its feet as a ragdoll (server/falls.ts). */
export const TIER_FALL = 3;

/** A reaction word's class is its low two bits (shared/anim/reactions.ts lays out the rest). */
export const reactClass = (word: number): number => word & 7;
/** Ticks each class of reaction lasts, and how many of its first ticks the body has little hold on its speed. */
export const REACT_FRAMES: readonly number[] = [0, 20, 30, 75, 30];
export const REACT_CONTROL_TICKS: readonly number[] = [0, 12, 18, 75, 0];

/** Delta-v in metres a second at which each tier starts. Settings may change them. */
export interface ReactRules {
  readonly bump: number;
  readonly stagger: number;
  readonly fall: number;
}
export const REACT_RULES: ReactRules = { bump: 0.8, stagger: 2.5, fall: 6 };

/** The change of speed a body of `mass` kilograms takes meeting one of `other` (Infinity for the world) closing at `closing` m/s. */
export function deltaV(closing: number, mass: number, other: number): number {
  if (!(closing > 0) || !(mass > 0)) return 0;
  return other === Infinity ? closing : (closing * other) / (mass + other);
}

/** What a contact of delta-v `dv` does. One the body brought on itself, or that nobody is to blame for, is at most a bump. */
export function tierOf(dv: number, attributed: boolean, rules: ReactRules = REACT_RULES): number {
  if (!(dv >= rules.bump)) return TIER_NONE;
  if (!attributed) return TIER_BUMP;
  return dv >= rules.fall ? TIER_FALL : dv >= rules.stagger ? TIER_STAGGER : TIER_BUMP;
}

/** How hard a stagger is, 0 to 3, by where its delta-v falls between staggering and falling. */
export function strengthOf(dv: number, rules: ReactRules = REACT_RULES): number {
  const share = (dv - rules.stagger) / (rules.fall - rules.stagger);
  return share < 0.25 ? 0 : share < 0.5 ? 1 : share < 0.75 ? 2 : 3;
}

/**
 * The way a push along (dx, dz) goes for a body facing `yaw` (1/65536 turns): sixteenths of a turn toward its left, 0
 * straight ahead, as its travel direction is counted.
 */
export function dirOf(yaw: number, dx: number, dz: number): number {
  const a = (yaw / 65536) * 2 * Math.PI;
  // The body's forward is (sin a, cos a) and its left (cos a, -sin a), so its own turn is the push measured from forward.
  const turn = detAtan2(dx, dz) - a;
  return Math.floor((turn / (2 * Math.PI)) * 16 + 0.5 + 32) & 15;
}
