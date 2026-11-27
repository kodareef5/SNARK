// The scorer: one score for each candidate of a table, from a line of weights or one hidden layer, then the scores made
// probabilities. The same code scores in a game and trains in the lab (tools/decide), so the two cannot differ.

import { inputsOf, type Profile } from "./profile.ts";
import type { Table } from "./table.ts";

export interface Model {
  /** The profile it was made for, and that profile's hash then (profile.ts). */
  profile: string;
  hash: number;
  inputs: number;
  /** Hidden units. 0 is a line of weights: `w1` is one row and `b2` its constant. */
  hidden: number;
  /** `hidden` rows of `inputs` weights (one row where `hidden` is 0). */
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: number;
  /** Scores are divided by this before they are made probabilities. */
  temperature: number;
}

let X = new Float32Array(64);

/** Writes candidate `i`'s inputs to `x`: the state, its row, in a ring the rows to its left and right, then the crosses. */
export function inputsAt(p: Profile, t: Table, i: number, x: Float32Array): void {
  const s = t.stateWidth, w = t.width;
  for (let j = 0; j < s; j++) x[j] = t.state[j]!;
  const at = i * w;
  for (let j = 0; j < w; j++) x[s + j] = t.rows[at + j]!;
  let n = s + w;
  if (p.ring) {
    const left = ((i + t.k - 1) % t.k) * w, right = ((i + 1) % t.k) * w;
    for (let j = 0; j < w; j++) {
      x[n + j] = t.rows[left + j]!;
      x[n + w + j] = t.rows[right + j]!;
    }
    n += 2 * w;
  }
  const c = p.crossAt;
  for (let j = 0; j < c.length; j += 2) x[n++] = t.state[c[j]!]! * t.rows[at + c[j + 1]!]!;
}

/** One candidate's score from its inputs. */
export function scoreOf(m: Model, x: Float32Array): number {
  const n = m.inputs;
  if (m.hidden === 0) {
    let v = m.b2;
    for (let j = 0; j < n; j++) v += m.w1[j]! * x[j]!;
    return v;
  }
  let v = m.b2;
  for (let h = 0; h < m.hidden; h++) {
    let a = m.b1[h]!;
    const at = h * n;
    for (let j = 0; j < n; j++) a += m.w1[at + j]! * x[j]!;
    if (a > 0) v += m.w2[h]! * a;
  }
  return v;
}

/** Fills `t.score` for every candidate. */
export function scoreTable(m: Model, p: Profile, t: Table): void {
  const n = inputsOf(p);
  if (m.inputs !== n) throw new Error(`weights for ${m.profile} read ${m.inputs} numbers and the table of ${p.name} gives ${n}`);
  if (X.length < n) X = new Float32Array(n);
  for (let i = 0; i < t.k; i++) {
    inputsAt(p, t, i, X);
    t.score[i] = scoreOf(m, X);
  }
}

/**
 * Makes `t.out` from `t.score` and `t.bias`, and returns the candidate chosen: the likeliest that is not masked, or -1 where
 * all are. A "yes" table answers with the one probability and returns 0.
 */
export function answer(kind: "choice" | "yes", t: Table, temperature = 1): number {
  const T = temperature > 0 ? temperature : 1;
  if (kind === "yes") {
    t.out[0] = 1 / (1 + Math.exp(-(t.score[0]! + t.bias[0]!) / T));
    return 0;
  }
  let best = -1, top = -Infinity;
  for (let i = 0; i < t.k; i++) {
    if (t.mask[i] !== 0) continue;
    const v = (t.score[i]! + t.bias[i]!) / T;
    if (v > top) {
      top = v;
      best = i;
    }
  }
  if (best < 0) {
    t.out.fill(0, 0, t.k);
    return -1;
  }
  let sum = 0;
  for (let i = 0; i < t.k; i++) {
    const e = t.mask[i] !== 0 ? 0 : Math.exp((t.score[i]! + t.bias[i]!) / T - top);
    t.out[i] = e;
    sum += e;
  }
  for (let i = 0; i < t.k; i++) t.out[i] = t.out[i]! / sum;
  return best;
}

/** Scores a table and answers it. */
export function decide(m: Model, p: Profile, t: Table): number {
  scoreTable(m, p, t);
  return answer(p.kind, t, m.temperature);
}

/** A line of weights for a profile, all zero. */
export function linear(p: Profile, hash: number): Model {
  const n = inputsOf(p);
  return { profile: p.name, hash, inputs: n, hidden: 0, w1: new Float32Array(n), b1: new Float32Array(0), w2: new Float32Array(0), b2: 0, temperature: 1 };
}
