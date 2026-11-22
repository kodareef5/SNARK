// The reference's taming formulas, with its numbers per species in content. server/taming.ts keeps the state and calls these.
// Checked against the reference's table in tests/creatures/taming.test.ts.

/** Per species. Affinity needed is a0 + a1 * level. `k` scales what each piece of food costs effectiveness. */
export interface TameParams {
  readonly a0: number;
  readonly a1: number;
  /** Food lost per second, and its multiplier while unconscious. */
  readonly foodBase: number;
  readonly proneMult: number;
  readonly k: number;
}

/** Multiplies every food's affinity for a knockout tame. */
export const KNOCKOUT_AFFINITY = 4;

/** In affinity. */
export function tameNeeded(p: TameParams, level: number): number {
  return p.a0 + p.a1 * level;
}

export function pieceWorth(affinity: number, speed: number): number {
  return affinity * KNOCKOUT_AFFINITY * speed;
}

export function piecesNeeded(p: TameParams, level: number, affinity: number, speed: number): number {
  return Math.ceil(tameNeeded(p, level) / pieceWorth(affinity, speed) - 1e-9);
}

/** Food per second. */
export function proneHunger(p: TameParams): number {
  return p.foodBase * p.proneMult;
}

/** Counted from the moment it is hungry enough for the first piece. Rounded to a second, because the species' numbers have four figures. */
export function tameSeconds(p: TameParams, pieces: number, food: number): number {
  return Math.round((pieces * food) / proneHunger(p));
}

/** What one more piece adds to the running sum that effectiveness is made from. The sum starts at 0, and harmCost adds to it too. */
export function pieceCost(affinity: number, speed: number): number {
  return 1 / pieceWorth(affinity, speed);
}

/** 0 to 1. */
export function effectiveness(p: TameParams, sum: number): number {
  return 1 / (1 + p.k * sum);
}

/** Losing `share` of its health while unconscious adds enough to the sum to cut effectiveness by that share of its current value. */
export function harmCost(p: TameParams, sum: number, share: number): number {
  if (!(share > 0) || !(p.k > 0)) return 0;
  const now = effectiveness(p, sum);
  const then = now * (1 - (share < 1 ? share : 1));
  return then > 0 ? (1 / then - 1) / p.k - sum : 1e9;
}

/** `te` is the taming effectiveness. */
export function bonusLevels(level: number, te: number): number {
  return Math.floor((level * te) / 2 + 1e-9);
}

/** `drain` is torpor lost per second. One narcotic adds `dose` over `doseSeconds`, and while it acts the creature loses no torpor. */
export function narcoticsNeeded(maxTorpor: number, drain: number, seconds: number, dose: number, doseSeconds: number): number {
  const short = drain * seconds - maxTorpor;
  return short <= 0 ? 0 : Math.ceil(short / (dose + drain * doseSeconds) - 1e-9);
}
