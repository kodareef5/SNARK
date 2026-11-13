// Taming, as arithmetic.
//
// A creature knocked out and fed comes to trust whoever fed it. How much food
// that takes, how long, how well it is done and what it is worth are the
// reference's formulas, with the reference's numbers per species in content.
// Nothing here changes anything: the server (server/taming.ts) keeps the
// state and calls these; a client can call them to say what a tame will take.
//
//   needed        = a0 + a1 * level                     affinity to win
//   one piece     = affinity * 4 * speed                what a piece of food adds
//   pieces        = ceil(needed / one piece)
//   seconds       = pieces * food / (foodBase * proneMult)
//                   (it eats when it is hungry enough for the next piece, and
//                   lying unconscious it hungers at foodBase * proneMult)
//   effectiveness = 1 / (1 + k * sum over pieces of 1 / one piece)
//   bonus levels  = floor(level * effectiveness / 2)
//
// Checked against the reference's table in tests/unit/taming.test.ts.

/** What a species brings to being tamed: the two numbers of what it needs, how fast it hungers lying unconscious, and how much each piece costs its effectiveness. */
export interface TameParams {
  readonly a0: number;
  readonly a1: number;
  /** Food lost per second, and what that is multiplied by while it lies unconscious. */
  readonly foodBase: number;
  readonly proneMult: number;
  readonly k: number;
}

/** What every piece of food's affinity is multiplied by for a creature tamed by knocking it out. */
export const KNOCKOUT_AFFINITY = 4;

/** Affinity a creature of `level` must be given. */
export function tameNeeded(p: TameParams, level: number): number {
  return p.a0 + p.a1 * level;
}

/** What one piece of a food of the given affinity adds, at taming speed `speed`. */
export function pieceWorth(affinity: number, speed: number): number {
  return affinity * KNOCKOUT_AFFINITY * speed;
}

/** Pieces of one food it takes to tame a creature of `level`. */
export function piecesNeeded(p: TameParams, level: number, affinity: number, speed: number): number {
  return Math.ceil(tameNeeded(p, level) / pieceWorth(affinity, speed) - 1e-9);
}

/** Food it loses each second while it lies unconscious. */
export function proneHunger(p: TameParams): number {
  return p.foodBase * p.proneMult;
}

/** Seconds it takes to eat `pieces` of a food worth `food` each, from the moment it is hungry enough for the first: to the nearest second, the species' numbers being given to four figures. */
export function tameSeconds(p: TameParams, pieces: number, food: number): number {
  return Math.round((pieces * food) / proneHunger(p));
}

/**
 * What eating one more piece does to the running sum that effectiveness is
 * made from: add this to the sum. (The sum starts at 0; harm done to the
 * creature while it lies there adds to it too, see `harmCost`.)
 */
export function pieceCost(affinity: number, speed: number): number {
  return 1 / pieceWorth(affinity, speed);
}

/** Effectiveness, 0 to 1, from that sum. */
export function effectiveness(p: TameParams, sum: number): number {
  return 1 / (1 + p.k * sum);
}

/**
 * What losing `share` of its health while unconscious adds to the sum: enough
 * to take effectiveness down by that share of what it is now.
 */
export function harmCost(p: TameParams, sum: number, share: number): number {
  if (!(share > 0) || !(p.k > 0)) return 0;
  const now = effectiveness(p, sum);
  const then = now * (1 - (share < 1 ? share : 1));
  return then > 0 ? (1 / then - 1) / p.k - sum : 1e9;
}

/** Levels a creature of `level` gains for being tamed at this effectiveness. */
export function bonusLevels(level: number, te: number): number {
  return Math.floor((level * te) / 2 + 1e-9);
}

/**
 * Narcotics it takes to keep a creature under for `seconds`, given the most
 * torpor it holds, what it shakes off each second, and what one narcotic adds
 * over how long (while one acts, it shakes nothing off).
 */
export function narcoticsNeeded(maxTorpor: number, drain: number, seconds: number, dose: number, doseSeconds: number): number {
  const short = drain * seconds - maxTorpor;
  return short <= 0 ? 0 : Math.ceil(short / (dose + drain * doseSeconds) - 1e-9);
}
