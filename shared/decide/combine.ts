// Several passes over the same candidates made one answer: their scores are added, each by its weight, a candidate any
// pass masks stays masked, and their biases add. `combine` is the one way it is done, in a game and in the lab alike, so
// what the lab grades is what the game chose.

import { answer } from "./forward.ts";
import type { Table } from "./table.ts";

/** A pass already scored, and what its scores count for: its mix divided by the temperature of the scorer that made them. */
export interface Pass {
  readonly table: Table;
  weight: number;
}

/**
 * Makes `into` the passes added together, the heading held given `by` more, and answers it: the candidate chosen, its
 * probabilities in `into.out`. Every pass holds the same candidates in the same order.
 */
export function combine(into: Table, passes: readonly Pass[], held: number, by: number): number {
  into.clear(passes[0]!.table.k);
  for (let i = 0; i < passes.length; i++) addPass(into, passes[i]!.table, passes[i]!.weight);
  stick(into, held, by);
  return answer("choice", into, 1);
}

/** Adds `from`'s scores, by `weight`, and its bias and mask into `into`. Both hold the same candidates in the same order. */
export function addPass(into: Table, from: Table, weight: number): void {
  if (from.k !== into.k) throw new Error(`a pass of ${from.k} candidates cannot be added to one of ${into.k}`);
  for (let i = 0; i < into.k; i++) {
    into.score[i] = into.score[i]! + from.score[i]! * weight;
    into.bias[i] = into.bias[i]! + from.bias[i]!;
    if (from.mask[i] !== 0) into.mask[i] = 1;
  }
}

/** Makes a chosen candidate a little likelier to be chosen again, so a mover between two near-equal ways does not dither. */
export function stick(t: Table, held: number, by: number): void {
  if (held >= 0 && held < t.k) t.bias[held] = t.bias[held]! + by;
}
