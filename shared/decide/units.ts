// The scalings a table's numbers are given, so every column is in a fixed range whatever the mover's size or pace.

/**
 * A mover's unit of length, in metres: its body's radius, but never less than the world's grain (the smallest length its
 * collision or path cells tell apart) nor than what it covers in one reaction time at its pace. A thin, fast thing (a
 * missile) then looks as far ahead as its speed needs, and a tiny one is not asked to judge lengths the world cannot hold.
 */
export function span(radius: number, grain: number, pace: number, react: number): number {
  const run = pace * react;
  return radius > grain ? (radius > run ? radius : run) : grain > run ? grain : run;
}

/** `x` as a share of `range`, held to 0 to 1. */
export function unit(x: number, range: number): number {
  const v = x / range;
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

/** `x` as a share of `range`, held to -1 to 1. */
export function signed(x: number, range: number): number {
  const v = x / range;
  return v <= -1 ? -1 : v >= 1 ? 1 : v;
}

/** A length of time or distance with no top, pressed into 0 to 1: half at `half`. */
export function soon(x: number, half: number): number {
  return x <= 0 ? 0 : x / (x + half);
}
