// The trainer: a line of weights (logistic) or one hidden layer (ReLU) for one profile of a point, from its decisions on
// disk. Home-grown, seeded, CPU only. Each candidate's inputs are made by `inputsAt` (shared/decide/forward.ts), so what
// it trains on is what a game serves. The other tables of a decision keep their hand rule, and are added in as the point
// adds its passes (`Passes`): a fixed offset to the candidate's score. Training stops early on a validation family;
// a temperature is then fitted there by log loss and kept only if it lowers the validation ECE.
//
//   bun tools/decide/fit.ts --point <name> --kind linear|hidden [--hidden 16] [--seed 1] [--profile <name>] [--reading end]
//
// writes .cache/decide/models/<point>/<profile>.<kind>[<hidden>].s<seed>.json, a ModelFile whose `about` holds its Score on
// the validation family. The scoreboard (score.ts) scores it again on what is held out.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { combine } from "../../shared/decide/combine.ts";
import { inputsAt, scoreTable, type Model } from "../../shared/decide/forward.ts";
import { inputsOf, profileHash, type Profile } from "../../shared/decide/profile.ts";
import { Table } from "../../shared/decide/table.ts";
import type { Score } from "../../shared/decide/scoreboard.ts";
import { writeModel, type ModelFile } from "../../shared/decide/weights.ts";
import { Rng } from "../../shared/rng.ts";
import { eceOf, summarize, type Graded } from "./board.ts";
import { READINGS, dataDir, meanCosts, readData, revision, targetOf, type Decision, type TableRow } from "./dataset.ts";

/**
 * One decision as the trainer reads it: each candidate's inputs, its offsets, whether it may be chosen, and its target. A
 * candidate's logit is (scale × score + offset) / T + fixed, T the scorer's temperature.
 */
export interface Example {
  k: number;
  /** Inputs a candidate reads: its row of `x` is `n` long. */
  n: number;
  x: Float32Array;
  scale: number;
  offset: Float64Array;
  fixed: Float64Array;
  mask: Uint8Array;
  /** A choice: how often each candidate was best. A yes: the one outcome. */
  target: Float64Array;
  /** Mean cost of each candidate, for regret; empty for a yes. */
  cost: Float64Array;
  /** The scene it came from (bootstraps are over these), and its family and map. */
  group: string;
  family: string;
  map: string;
}

/** What may change a decision's table before it is read: the ablations hide or swap parts of it. */
export type Alter = (row: TableRow, index: number) => TableRow;

/**
 * How a point adds several passes over the same candidates (shared/decide/combine.ts): each pass's score by its mix over
 * its scorer's temperature, every bias, and a stick on the candidate its `held` column marks; the sum's temperature is 1.
 */
export interface Passes {
  mix: Readonly<Record<string, number>>;
  stick: number;
}

/** Where the scene of a decision belongs. */
export interface Split {
  /** Families held out of training and validation, for the scoreboard alone. */
  held: readonly string[];
  /** Maps held out the same way. */
  heldMaps: readonly string[];
  /** Families early stopping and the temperature are read on. */
  validation: readonly string[];
}

export function roleOf(split: Split, family: string, map: string): "train" | "validation" | "held" {
  if (split.held.includes(family) || split.heldMaps.includes(map)) return "held";
  return split.validation.includes(family) ? "validation" : "train";
}

const tableOf = (row: TableRow, p: Profile): Table => {
  const t = new Table(row.k, p.state.length, p.columns.length);
  t.k = row.k;
  t.state.set(row.state);
  t.rows.set(row.rows);
  t.bias.set(row.bias);
  t.mask.set(row.mask);
  return t;
};

/**
 * The decisions as examples for profile `p`: other tables scored by their rule from `rules` (nothing where there is
 * none). A candidate with no cost read is masked. `reading` picks the cost a choice's target is drawn from.
 */
export function examples(ds: readonly Decision[], p: Profile, profiles: readonly Profile[], rules: ReadonlyMap<string, Model>, reading: number, alter?: Alter, passes?: Passes): Example[] {
  const n = inputsOf(p), out: Example[] = [];
  ds.forEach((d, index) => {
    const at = d.tables.findIndex((t) => t.profile === p.name);
    if (at < 0) return;
    const rows = alter ? d.tables.map((t, i) => (i === at ? alter(t, index) : t)) : d.tables;
    const k = rows[at]!.k;
    const x = new Float32Array(k * n), offset = new Float64Array(k), fixed = new Float64Array(k), mask = new Uint8Array(k), one = new Float32Array(n);
    const tables = rows.map((row) => tableOf(row, profiles.find((r) => r.name === row.profile)!));
    rows.forEach((row, i) => {
      const q = profiles.find((r) => r.name === row.profile)!, t = tables[i]!;
      if (i === at) {
        for (let c = 0; c < k; c++) {
          inputsAt(q, t, c, one);
          x.set(one, c * n);
        }
        return;
      }
      const rule = rules.get(row.profile);
      if (rule) scoreTable(rule, q, t);
    });
    if (passes) {
      // The others by their rule and this one at nothing, added by `combine` as the game adds them, with the held heading's
      // stick and any mask the answer as made carried: what is left is this pass's fixed offset.
      const first = d.tables[0]!, fp = profiles.find((r) => r.name === first.profile)!, held = fp.columns.indexOf("held");
      let at0 = -1;
      for (let c = 0; c < k && held >= 0; c++) if (first.rows[c * fp.columns.length + held] === 1) at0 = c;
      const into = new Table(k, 0, 1);
      combine(into, tables.map((t, i) => ({ table: t, weight: i === at ? 0 : (passes.mix[rows[i]!.profile] ?? 0) / (rules.get(rows[i]!.profile)?.temperature ?? 1) })), at0, passes.stick);
      for (let c = 0; c < k; c++) {
        fixed[c] = into.score[c]! + into.bias[c]!;
        mask[c] = into.mask[c]! !== 0 || (d.final?.mask[c] ?? 0) !== 0 ? 1 : 0;
      }
    } else {
      rows.forEach((row, i) => {
        for (let c = 0; c < k; c++) {
          offset[c] = offset[c]! + row.bias[c]! + (i !== at && rules.has(row.profile) ? tables[i]!.score[c]! : 0);
          if (row.mask[c] !== 0) mask[c] = 1;
        }
      });
    }
    const scale = passes ? (passes.mix[p.name] ?? 0) : 1;
    let target: Float64Array, cost: Float64Array;
    if (p.kind === "yes") {
      // An outcome never read (the play ended before its horizon) teaches nothing.
      if (Number.isNaN(d.label)) return;
      target = Float64Array.of(d.label);
      cost = new Float64Array(0);
    } else {
      cost = meanCosts(d, reading);
      for (let c = 0; c < k; c++) if (Number.isNaN(cost[c]!)) mask[c] = 1;
      target = targetOf(d, reading);
      for (let c = 0; c < k; c++) if (mask[c] !== 0) target[c] = 0;
      const sum = target.reduce((s, v) => s + v, 0);
      if (!(sum > 0) || mask.every((v) => v !== 0)) return;
      for (let c = 0; c < k; c++) target[c] = target[c]! / sum;
    }
    out.push({ k, n, x, scale, offset, fixed, mask, target, cost, group: `${d.map}/${d.family}/${d.seed}`, family: d.family, map: d.map });
  });
  return out;
}

/** Parameters while training, in doubles: `w1` (hidden rows of inputs, or one row), `b1`, `w2`, then `b2` last. */
interface Net {
  n: number;
  hidden: number;
  p: Float64Array;
}

const sizeOf = (n: number, hidden: number): number => (hidden === 0 ? n + 1 : hidden * n + 2 * hidden + 1);

function score(net: Net, x: Float32Array, from: number, act: Float64Array | null): number {
  const { n, hidden, p } = net;
  if (hidden === 0) {
    let v = p[n]!;
    for (let j = 0; j < n; j++) v += p[j]! * x[from + j]!;
    return v;
  }
  const b1 = hidden * n, w2 = b1 + hidden;
  let v = p[w2 + hidden]!;
  for (let h = 0; h < hidden; h++) {
    let a = p[b1 + h]!;
    const at = h * n;
    for (let j = 0; j < n; j++) a += p[at + j]! * x[from + j]!;
    if (act) act[h] = a;
    if (a > 0) v += p[w2 + h]! * a;
  }
  return v;
}

/** Adds `g` times the gradient of the candidate's score at `x` to `grad`; `act` holds its hidden units from `score`. */
function back(net: Net, x: Float32Array, from: number, act: Float64Array, g: number, grad: Float64Array): void {
  const { n, hidden, p } = net;
  if (hidden === 0) {
    for (let j = 0; j < n; j++) grad[j] = grad[j]! + g * x[from + j]!;
    grad[n] = grad[n]! + g;
    return;
  }
  const b1 = hidden * n, w2 = b1 + hidden;
  for (let h = 0; h < hidden; h++) {
    const a = act[h]!;
    if (a <= 0) continue;
    grad[w2 + h] = grad[w2 + h]! + g * a;
    const gh = g * p[w2 + h]!, at = h * n;
    for (let j = 0; j < n; j++) grad[at + j] = grad[at + j]! + gh * x[from + j]!;
    grad[b1 + h] = grad[b1 + h]! + gh;
  }
  grad[w2 + hidden] = grad[w2 + hidden]! + g;
}

/** Each candidate's probability under `net` (or a fixed scorer) at temperature `T`, into `out`. Masked ones get 0. */
export function probabilities(kind: "choice" | "yes", ex: Example, scoreAt: (c: number) => number, T: number, out: Float64Array): void {
  if (kind === "yes") {
    out[0] = 1 / (1 + Math.exp(-((ex.scale * scoreAt(0) + ex.offset[0]!) / T + ex.fixed[0]!)));
    return;
  }
  let top = -Infinity;
  for (let c = 0; c < ex.k; c++) {
    if (ex.mask[c] !== 0) continue;
    out[c] = (ex.scale * scoreAt(c) + ex.offset[c]!) / T + ex.fixed[c]!;
    if (out[c]! > top) top = out[c]!;
  }
  let sum = 0;
  for (let c = 0; c < ex.k; c++) {
    const e = ex.mask[c] !== 0 ? 0 : Math.exp(out[c]! - top);
    out[c] = e;
    sum += e;
  }
  for (let c = 0; c < ex.k; c++) out[c] = out[c]! / sum;
}

const EPS = 1e-12;

/** Log loss of `p` against an example's target. */
export function logLossOf(kind: "choice" | "yes", ex: Example, p: Float64Array): number {
  if (kind === "yes") {
    const y = ex.target[0]!, q = Math.min(1 - EPS, Math.max(EPS, p[0]!));
    return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }
  let l = 0;
  for (let c = 0; c < ex.k; c++) if (ex.target[c]! > 0) l -= ex.target[c]! * Math.log(Math.max(EPS, p[c]!));
  return l;
}

export interface FitOptions {
  kind: "linear" | "hidden";
  hidden?: number;
  seed?: number;
  /** Weight of the Brier term beside the cross-entropy, for a choice. */
  brier?: number;
  epochs?: number;
  /** Epochs with no better validation loss before it stops. */
  patience?: number;
  batch?: number;
  rate?: number;
  decay?: number;
  /** "adam", or plain gradient descent with momentum. */
  optimizer?: "adam" | "momentum";
  /**
   * Weights to start from (the hand rule), which the decay then pulls toward in place of zero. A hidden layer starts as
   * the line exactly: two units carry it, one each way, and the rest start silent.
   */
  from?: Model;
  /**
   * A choice is trained toward a share for each candidate falling off with its cost above the best, by this share of the
   * decision's median cost, in place of how often it was best; 0 for how often.
   */
  soft?: number;
  /** What early stopping reads on validation: log loss, or the cost of the pick above the best. */
  stop?: "loss" | "regret";
  /** A word in the scorer's name, to tell apart scorers made other ways. */
  tag?: string;
}

export interface Fitted {
  model: Model;
  epochs: number;
  best: number;
  /** Validation log loss at the best epoch, then with the temperature kept, and the ECE before and after it. */
  valLoss: number;
  valLossT: number;
  eceBefore: number;
  eceAfter: number;
}

function meanLoss(kind: "choice" | "yes", net: Net, set: readonly Example[], T: number): number {
  if (set.length === 0) return NaN;
  const p = new Float64Array(64);
  let sum = 0;
  for (const ex of set) {
    const out = ex.k > p.length ? new Float64Array(ex.k) : p;
    probabilities(kind, ex, (c) => score(net, ex.x, c * net.n, null), T, out);
    sum += logLossOf(kind, ex, out);
  }
  return sum / set.length;
}

/** Where the answer's top pick falls among the bands, against how often it was best (or how often a yes happened). */
function eceAt(kind: "choice" | "yes", net: Net, set: readonly Example[], T: number): number {
  const said: number[] = [], happened: number[] = [];
  const p = new Float64Array(64);
  for (const ex of set) {
    probabilities(kind, ex, (c) => score(net, ex.x, c * net.n, null), T, p);
    if (kind === "yes") {
      said.push(p[0]!);
      happened.push(ex.target[0]!);
    } else {
      let best = 0;
      for (let c = 1; c < ex.k; c++) if (p[c]! > p[best]!) best = c;
      said.push(p[best]!);
      happened.push(ex.target[best]!);
    }
  }
  return eceOf(said, happened).ece;
}

/** Mean cost of the pick above the best, at temperature `T`. */
function meanRegret(net: Net, set: readonly Example[], T = 1): number {
  const p = new Float64Array(64);
  let sum = 0;
  for (const ex of set) {
    const P = ex.k > p.length ? new Float64Array(ex.k) : p;
    probabilities("choice", ex, (c) => score(net, ex.x, c * net.n, null), T, P);
    const pick = argmax(P, ex);
    let low = Infinity;
    for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0 && ex.cost[c]! < low) low = ex.cost[c]!;
    sum += ex.cost[pick]! - low;
  }
  return sum / (set.length || NaN);
}

/** Each open candidate's share, falling off with its cost above the best by `soft` of the median open cost. */
export function softTarget(ex: Example, soft: number): Float64Array {
  const open: number[] = [];
  for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0) open.push(ex.cost[c]!);
  open.sort((a, b) => a - b);
  const low = open[0]!, scale = Math.max(1e-6, soft * open[open.length >> 1]!), out = new Float64Array(ex.k);
  let sum = 0;
  for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0) sum += out[c] = Math.exp(-(ex.cost[c]! - low) / scale);
  for (let c = 0; c < ex.k; c++) out[c] = out[c]! / sum;
  return out;
}

/** A standard normal draw, by Box and Muller. */
function normal(rng: Rng): number {
  const u = 1 - rng.float(), v = rng.float();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Trains a scorer for profile `p` on `train`, stopping early on `val` (or on train where `val` is empty). */
export function fit(p: Profile, train: readonly Example[], val: readonly Example[], o: FitOptions): Fitted {
  const n = inputsOf(p), hidden = o.kind === "hidden" ? (o.hidden ?? 16) : 0;
  const rng = new Rng(o.seed ?? 1);
  const size = sizeOf(n, hidden);
  const net: Net = { n, hidden, p: new Float64Array(size) };
  if (hidden > 0) {
    const s1 = Math.sqrt(2 / n), s2 = Math.sqrt(1 / hidden);
    for (let i = 0; i < hidden * n; i++) net.p[i] = normal(rng) * s1;
    for (let h = 0; h < hidden; h++) net.p[hidden * n + h] = 0.01;
    for (let h = 0; h < hidden; h++) net.p[hidden * n + hidden + h] = o.from ? 0 : normal(rng) * s2;
  }
  const from = o.from;
  if (from && (from.hidden !== 0 || from.inputs !== n)) throw new Error(`a scorer for ${p.name} starts only from a line of its ${n} inputs`);
  if (from && hidden === 0) {
    net.p.set(from.w1);
    net.p[n] = from.b2;
  } else if (from) {
    if (hidden < 2) throw new Error("a hidden layer starts from a line with two units at least");
    for (let j = 0; j < n; j++) {
      net.p[j] = from.w1[j]!;
      net.p[n + j] = -from.w1[j]!;
    }
    net.p[hidden * n] = net.p[hidden * n + 1] = 0;
    net.p[hidden * n + hidden] = 1;
    net.p[hidden * n + hidden + 1] = -1;
    net.p[hidden * n + 2 * hidden] = from.b2;
  }
  const anchor = from ? net.p.slice() : new Float64Array(size);
  if (from) for (let i = 2 * n; i < hidden * n; i++) anchor[i] = 0;
  const stopOn = o.stop ?? "loss", soft = p.kind === "choice" ? (o.soft ?? 0) : 0;
  const targets = train.map((ex) => (soft > 0 ? softTarget(ex, soft) : ex.target));
  const judge = (set: readonly Example[]) => (stopOn === "regret" && p.kind === "choice" ? meanRegret(net, set) : meanLoss(p.kind, net, set, 1));
  const kind = p.kind, beta = kind === "choice" ? (o.brier ?? 0.5) : 0;
  const epochs = o.epochs ?? 300, patience = o.patience ?? 20, batch = o.batch ?? 32;
  const rate = o.rate ?? (hidden > 0 ? 0.005 : 0.03), decay = o.decay ?? 1e-4;
  const adam = (o.optimizer ?? "adam") === "adam";
  const grad = new Float64Array(size), m1 = new Float64Array(size), m2 = new Float64Array(size);
  const isWeight = new Uint8Array(size);
  if (hidden === 0) isWeight.fill(1, 0, n);
  else {
    isWeight.fill(1, 0, hidden * n);
    isWeight.fill(1, hidden * n + hidden, hidden * n + 2 * hidden);
  }
  const check = val.length > 0 ? val : train;
  const order = Array.from(train, (_, i) => i);
  let best = judge(check), bestAt = -1, kept = net.p.slice(), step = 0, epoch = 0;
  const pr = new Float64Array(64), g = new Float64Array(64);
  let acts: Float64Array[] = Array.from({ length: 64 }, () => new Float64Array(Math.max(1, hidden)));
  for (; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let from = 0; from < order.length; from += batch) {
      grad.fill(0);
      const to = Math.min(order.length, from + batch);
      for (let b = from; b < to; b++) {
        const ex = train[order[b]!]!;
        if (ex.k > acts.length) acts = Array.from({ length: ex.k }, () => new Float64Array(Math.max(1, hidden)));
        const P = ex.k > pr.length ? new Float64Array(ex.k) : pr, G = ex.k > g.length ? new Float64Array(ex.k) : g;
        probabilities(kind, ex, (c) => score(net, ex.x, c * n, acts[c]!), 1, P);
        const y = targets[order[b]!]!;
        if (kind === "yes") G[0] = P[0]! - y[0]!;
        else {
          let dot = 0;
          for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0) dot += P[c]! * (P[c]! - y[c]!);
          for (let c = 0; c < ex.k; c++) G[c] = ex.mask[c] !== 0 ? 0 : P[c]! - y[c]! + beta * 2 * P[c]! * (P[c]! - y[c]! - dot);
        }
        for (let c = 0; c < ex.k; c++) if (G[c] !== 0) back(net, ex.x, c * n, acts[c]!, G[c]! * ex.scale, grad);
      }
      const scale = 1 / (to - from);
      step++;
      for (let i = 0; i < size; i++) {
        const gi = grad[i]! * scale + (isWeight[i] ? decay * (net.p[i]! - anchor[i]!) : 0);
        if (adam) {
          m1[i] = 0.9 * m1[i]! + 0.1 * gi;
          m2[i] = 0.999 * m2[i]! + 0.001 * gi * gi;
          const mh = m1[i]! / (1 - 0.9 ** step), vh = m2[i]! / (1 - 0.999 ** step);
          net.p[i] = net.p[i]! - (rate * mh) / (Math.sqrt(vh) + 1e-8);
        } else {
          m1[i] = 0.9 * m1[i]! + gi;
          net.p[i] = net.p[i]! - rate * m1[i]!;
        }
      }
    }
    const loss = judge(check);
    if (loss < best - 1e-9) {
      best = loss;
      bestAt = epoch;
      kept = net.p.slice();
    } else if (epoch - bestAt >= patience) break;
  }
  net.p.set(kept);
  best = meanLoss(kind, net, check, 1);
  // The temperature: least validation log loss on a grid from a fifth to five, kept only where it calibrates better. In
  // a sum of passes it weighs this pass against the others, so it may change the pick: none is kept that picks worse.
  let T = 1, lossT = best;
  const regret1 = kind === "choice" ? meanRegret(net, check, 1) : 0;
  for (let i = 0; i <= 60; i++) {
    const t = Math.exp(Math.log(0.2) + (i / 60) * Math.log(25));
    const l = meanLoss(kind, net, check, t);
    if (l < lossT - 1e-12 && (kind !== "choice" || meanRegret(net, check, t) <= regret1 + 1e-9)) {
      lossT = l;
      T = t;
    }
  }
  const eceBefore = eceAt(kind, net, check, 1), eceT = eceAt(kind, net, check, T);
  if (!(eceT < eceBefore)) {
    T = 1;
    lossT = best;
  }
  return { model: toModel(p, net, T), epochs: epoch, best: bestAt, valLoss: best, valLossT: lossT, eceBefore, eceAfter: T === 1 ? eceBefore : eceT };
}

function toModel(p: Profile, net: Net, temperature: number): Model {
  const { n, hidden } = net;
  if (hidden === 0) {
    return { profile: p.name, hash: profileHash(p), inputs: n, hidden: 0, w1: Float32Array.from(net.p.subarray(0, n)), b1: new Float32Array(0), w2: new Float32Array(0), b2: Math.fround(net.p[n]!), temperature };
  }
  const b1 = hidden * n, w2 = b1 + hidden;
  return {
    profile: p.name, hash: profileHash(p), inputs: n, hidden,
    w1: Float32Array.from(net.p.subarray(0, b1)), b1: Float32Array.from(net.p.subarray(b1, w2)), w2: Float32Array.from(net.p.subarray(w2, w2 + hidden)),
    b2: Math.fround(net.p[w2 + hidden]!), temperature,
  };
}

/** Grades a fixed scorer (a model, or none for uniform) on examples, for the board (board.ts). */
export function grade(kind: "choice" | "yes", set: readonly Example[], scorer: Model | null, rule: Model | null, T = scorer?.temperature ?? 1): Graded[] {
  const at = (m: Model | null) => (ex: Example) => (c: number) => (m ? scoreModel(m, ex.x, c * ex.n) : 0);
  const p = new Float64Array(64), q = new Float64Array(64);
  return set.map((ex) => {
    const P = ex.k > p.length ? new Float64Array(ex.k) : p, Q = ex.k > q.length ? new Float64Array(ex.k) : q;
    probabilities(kind, ex, at(scorer)(ex), scorer ? T : 1, P);
    probabilities(kind, ex, at(rule)(ex), rule?.temperature ?? 1, Q);
    return gradeOne(kind, ex, P, Q);
  });
}

/** One example graded from its probabilities `p` and the rule's `q`. */
export function gradeOne(kind: "choice" | "yes", ex: Example, p: Float64Array, q: Float64Array): Graded {
  const base = { group: ex.group, family: ex.family, map: ex.map };
  if (kind === "yes") {
    const y = ex.target[0]!, ll = logLossOf(kind, ex, p), rl = logLossOf(kind, ex, q);
    return { ...base, regret: ll, ruleRegret: rl, disagree: p[0]! > 0.5 !== q[0]! > 0.5, logLoss: ll, brier: (p[0]! - y) ** 2, said: p[0]!, happened: y };
  }
  const pick = argmax(p, ex), rulePick = argmax(q, ex);
  let low = Infinity, oracle = -1;
  for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0 && ex.cost[c]! < low) {
    low = ex.cost[c]!;
    oracle = c;
  }
  let brier = 0;
  for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0) brier += (p[c]! - ex.target[c]!) ** 2;
  // A uniform scorer's ties are broken by nothing: its regret is the mean over the candidates it may choose.
  const flat = p.subarray(0, ex.k).every((v, c) => ex.mask[c] !== 0 || Math.abs(v - p[pick]!) < 1e-12);
  let regret = ex.cost[pick]! - low;
  if (flat) {
    let sum = 0, m = 0;
    for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0) {
      sum += ex.cost[c]! - low;
      m++;
    }
    regret = sum / m;
  }
  return { ...base, regret, ruleRegret: ex.cost[rulePick]! - low, disagree: oracle !== rulePick, logLoss: logLossOf(kind, ex, p), brier, said: p[pick]!, happened: ex.target[pick]! };
}

export function argmax(p: Float64Array, ex: Example): number {
  let best = -1;
  for (let c = 0; c < ex.k; c++) if (ex.mask[c] === 0 && (best < 0 || p[c]! > p[best]!)) best = c;
  return best;
}

/** A Model's score of the inputs at `from`, in doubles. */
export function scoreModel(m: Model, x: Float32Array, from: number): number {
  const n = m.inputs;
  let v = m.b2;
  if (m.hidden === 0) {
    for (let j = 0; j < n; j++) v += m.w1[j]! * x[from + j]!;
    return v;
  }
  for (let h = 0; h < m.hidden; h++) {
    let a = m.b1[h]!;
    for (let j = 0; j < n; j++) a += m.w1[h * n + j]! * x[from + j]!;
    if (a > 0) v += m.w2[h]! * a;
  }
  return v;
}

/** A scorer's name from how it was made. */
export function modelName(profile: string, o: FitOptions): string {
  return `${profile}.${o.kind}${o.kind === "hidden" ? (o.hidden ?? 16) : ""}${o.tag ? `.${o.tag}` : ""}.s${o.seed ?? 1}`;
}

export interface Catalog {
  profiles: readonly Profile[];
  rules: ReadonlyMap<string, Model>;
  split: Split;
  /** By point, how it adds its passes, where it has several. */
  passes?: Readonly<Record<string, Passes>>;
}

/** Fits a point's dataset in `root`, writes the weights file, and returns where and what. */
export function fitPoint(point: string, o: FitOptions & { profile?: string; reading?: number; fromRule?: boolean }, cat: Catalog, root = ".cache/decide"): { file: string; written: ModelFile; fitted: Fitted; train: number; val: number } {
  const { manifest, decisions } = readData(dataDir(point, join(root, "data")), cat.profiles);
  const name = o.profile ?? manifest.profiles[0]?.name;
  const p = cat.profiles.find((q) => q.name === name);
  if (!p) throw new Error(`${point} has no tables of ${String(name)}`);
  const reading = o.reading ?? READINGS.length - 1;
  const all = examples(decisions, p, cat.profiles, cat.rules, reading, undefined, cat.passes?.[point]);
  let train = all.filter((e) => roleOf(cat.split, e.family, e.map) === "train");
  let val = all.filter((e) => roleOf(cat.split, e.family, e.map) === "validation");
  // No validation family in the data: a fifth of the training scenes by their seed, never a share of rows.
  if (val.length === 0) {
    const pick = (e: Example) => Number(e.group.split("/").pop()) % 5 === 0;
    val = train.filter(pick);
    train = train.filter((e) => !pick(e));
  }
  const rule0 = cat.rules.get(p.name);
  if (o.fromRule && !rule0) throw new Error(`${p.name} has no rule to start from`);
  const fitted = fit(p, train, val, { ...o, from: o.fromRule ? rule0 : undefined });
  const rule = cat.rules.get(p.name) ?? null;
  const name2 = modelName(p.name, o);
  const kind = o.kind === "hidden" ? "hidden" : "linear";
  const s: Score = summarize(name2, kind, grade(p.kind, val, fitted.model, rule), { seed: o.seed ?? 1 });
  const written = writeModel(fitted.model, {
    point, made: new Date().toISOString(), revision: revision(), on: "validation", reading: READINGS[reading],
    decisions: { train: train.length, validation: val.length }, epochs: fitted.epochs, bestEpoch: fitted.best,
    validation: { logLoss: fitted.valLoss, logLossT: fitted.valLossT, eceBefore: fitted.eceBefore, eceAfter: fitted.eceAfter },
    options: { ...o, from: undefined }, score: s,
  });
  const dir = join(root, "models", point);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name2}.json`);
  writeFileSync(file, JSON.stringify(written));
  return { file, written, fitted, train: train.length, val: val.length };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const point = arg("--point");
  const kind = arg("--kind") ?? "linear";
  if (!point || (kind !== "linear" && kind !== "hidden")) {
    console.error("usage: bun tools/decide/fit.ts --point <name> --kind linear|hidden [--hidden 16] [--seed 1] [--profile <name>] [--reading 1s|5s|end] [--from-rule] [--soft 0.05] [--stop loss|regret] [--tag <word>]");
    process.exit(2);
  }
  const { catalog } = await import("./catalog.ts");
  const reading = arg("--reading");
  const r = fitPoint(point, {
    kind, hidden: Number(arg("--hidden") ?? 16), seed: Number(arg("--seed") ?? 1), profile: arg("--profile"),
    reading: reading ? READINGS.indexOf(reading as (typeof READINGS)[number]) : undefined,
    fromRule: process.argv.includes("--from-rule"), soft: Number(arg("--soft") ?? 0), stop: arg("--stop") === "regret" ? "regret" : "loss", tag: arg("--tag"),
    decay: arg("--decay") ? Number(arg("--decay")) : undefined,
  }, catalog(point));
  const s = r.written.about!.score as Score;
  console.log(`${r.file}: ${r.train} decisions trained on, ${r.val} to stop on; ${r.fitted.epochs} epochs, best at ${r.fitted.best}`);
  console.log(`  on validation: log loss ${r.fitted.valLoss.toFixed(4)}, ${r.fitted.valLossT.toFixed(4)} at temperature ${r.written.temperature.toFixed(3)}; ECE ${r.fitted.eceBefore.toFixed(4)} then ${r.fitted.eceAfter.toFixed(4)}; regret ${s.regretRatio.toFixed(3)} of the rule's`);
}
