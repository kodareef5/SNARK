// Scores one point's entries on its held-out decisions: uniform, today's code, the hand rule and each trained scorer,
// with the ablations and the gate. What the world must measure (whole episodes, timings) is handed in, so a game's
// board (score.ts) and the toy's (toy.ts) are made the same way.

import type { Model } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import type { EpisodeScore, PointScores, Score } from "../../shared/decide/scoreboard.ts";
import { Rng } from "../../shared/rng.ts";
import { gateOf, ruleGate, summarize, type Graded } from "./board.ts";
import { todayCost, type Decision, type TableRow } from "./dataset.ts";
import { examples, grade, logLossOf, probabilities, roleOf, scoreModel, type Alter, type Catalog, type Example } from "./fit.ts";

export interface Trained {
  name: string;
  kind: "linear" | "hidden";
  model: Model;
  /** The weights file's size. */
  bytes: number;
  /** One answer's 99th percentile on a fast core and a slow one, in microseconds, where measured. */
  microsFast?: number;
  microsSlow?: number;
  medianFast?: number;
  medianSlow?: number;
}

/** One summary of a whole episode, as a world's runner returns it. */
export interface EpisodeResult {
  /** The scene's family, and whether it was not played for want of any way to its goal. */
  family?: string;
  skipped?: boolean;
  arrived: boolean;
  ticks: number;
  healthLost: number;
  stuckTicks: number;
  /** Path searches finished and the cells they expanded, and where the mover ended. */
  searches: number;
  cells: number;
  end: { x: number; z: number };
  cost: number;
  /** The decide part of each tick, in microseconds. */
  decideMicros: number[];
}

/** Means over episodes, and the 99th percentile of the decide part over all their ticks. */
export function episodeScore(name: string, all: readonly EpisodeResult[]): EpisodeScore {
  const list = all.filter((e) => !e.skipped);
  const n = list.length || NaN, mean = (f: (e: EpisodeResult) => number) => list.reduce((s, e) => s + f(e), 0) / n;
  const parts = list.flatMap((e) => e.decideMicros).sort((a, b) => a - b);
  return {
    name, scenes: list.length, arrived: list.filter((e) => e.arrived).length, ticks: mean((e) => e.ticks), healthLost: mean((e) => e.healthLost),
    stuckTicks: mean((e) => e.stuckTicks), searches: mean((e) => e.searches), cells: mean((e) => e.cells), cost: mean((e) => e.cost),
    decideMicros: parts.length ? parts[Math.min(parts.length - 1, Math.floor(parts.length * 0.99))]! : NaN,
    families: Object.fromEntries([...new Set(list.map((e) => e.family ?? ""))].map((f) => {
      const of = list.filter((e) => (e.family ?? "") === f);
      return [f, { scenes: of.length, arrived: of.filter((e) => e.arrived).length, ticks: of.reduce((s, e) => s + e.ticks, 0) / of.length }];
    })),
  };
}

const hide = (part: "state" | "rows"): Alter => (row) => ({ ...row, [part]: new Float32Array(row[part].length) });

/** The state of another decision's table of the same profile, by a seeded shuffle of the decisions. */
function shuffled(ds: readonly Decision[], profile: string, seed: number): Alter {
  const order = Array.from(ds, (_, i) => i), rng = new Rng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return (row: TableRow, index: number) => {
    const other = ds[order[index]!]!.tables.find((t) => t.profile === profile);
    return other ? { ...row, state: other.state } : row;
  };
}

function meanLoss(kind: "choice" | "yes", set: readonly Example[], m: Model): number {
  const p = new Float64Array(64);
  let sum = 0;
  for (const ex of set) {
    const P = ex.k > p.length ? new Float64Array(ex.k) : p;
    probabilities(kind, ex, (c) => scoreModel(m, ex.x, c * ex.n), m.temperature, P);
    sum += logLossOf(kind, ex, P);
  }
  return sum / (set.length || NaN);
}

/** How far the best candidate beats the rule, as a share of the median of the rule's costs. */
export function headroom(ex: readonly Example[], rule: Model | null): number {
  if (ex.length === 0 || ex[0]!.cost.length === 0) return NaN;
  const graded = grade("choice", ex, rule, rule);
  const ruleCosts = ex.map((e, i) => e.cost.reduce((low, v, c) => (e.mask[c] === 0 && v < low ? v : low), Infinity) + graded[i]!.ruleRegret).sort((a, b) => a - b);
  const median = ruleCosts[ruleCosts.length >> 1]!;
  return graded.reduce((s, g) => s + g.ruleRegret, 0) / ex.length / median;
}

export interface RateOptions {
  point: string;
  profile: Profile;
  cat: Catalog;
  decisions: readonly Decision[];
  reading: number;
  trained: readonly Trained[];
  episodes?: readonly EpisodeScore[];
  seed?: number;
}

/** The scores of a point on what its split holds out. */
export function ratePoint(o: RateOptions): PointScores {
  const { profile: p, cat, reading } = o, passes = cat.passes?.[o.point];
  const held = o.decisions.filter((d) => roleOf(cat.split, d.family, d.map) === "held");
  const ex = examples(held, p, cat.profiles, cat.rules, reading, undefined, passes);
  const rule = cat.rules.get(p.name) ?? null;
  const seed = o.seed ?? 1;
  const scores: Score[] = [];
  const base = (s: Score): Score => ({ ...s, gate: { pass: false, why: ["a baseline is not gated"] } });
  scores.push(base(summarize("uniform", "baseline", grade(p.kind, ex, null, rule), { seed })));
  if (p.kind === "choice") {
    const today = todayGraded(held, ex, p, reading, rule);
    if (today.length > 0) scores.push(base(summarize("today", "baseline", today, { seed })));
  }
  const played = (name: string) => o.episodes?.find((e) => e.name === name);
  if (rule) scores.push({ ...summarize("rule", "rule", grade(p.kind, ex, rule, rule), { seed }), gate: ruleGate(played("rule"), played("today")) });
  const hasState = p.state.length > 0;
  const blindSets = {
    state: hasState ? examples(held, p, cat.profiles, cat.rules, reading, hide("state"), passes) : null,
    columns: examples(held, p, cat.profiles, cat.rules, reading, hide("rows"), passes),
    shuffled: hasState ? examples(held, p, cat.profiles, cat.rules, reading, shuffled(held, p.name, seed), passes) : null,
  };
  for (const t of o.trained) {
    const s = summarize(t.name, t.kind, grade(p.kind, ex, t.model, rule), { seed });
    const own = meanLoss(p.kind, ex, t.model);
    const worse = (set: Example[] | null) => (set ? (meanLoss(p.kind, set, t.model) - own) / own : NaN);
    s.blind = { state: worse(blindSets.state), columns: worse(blindSets.columns), shuffled: worse(blindSets.shuffled) };
    s.microsFast = t.microsFast ?? NaN;
    s.microsSlow = t.microsSlow ?? NaN;
    s.medianFast = t.medianFast ?? NaN;
    s.medianSlow = t.medianSlow ?? NaN;
    s.bytes = t.bytes;
    s.gate = gateOf(s, { hasState, mine: played(t.name), rule: played("rule"), today: played("today") });
    scores.push(s);
  }
  const all = examples(o.decisions, p, cat.profiles, cat.rules, reading, undefined, passes);
  return { point: o.point, profile: p.name, episodes: [...(o.episodes ?? [])], headroom: p.kind === "choice" ? headroom(all, rule) : NaN, scores };
}

/** Today's code at each decision: the cost of leaving the point alone there, against the best candidate's. */
function todayGraded(held: readonly Decision[], ex: readonly Example[], p: Profile, reading: number, rule: Model | null): Graded[] {
  // `examples` drops a decision with nothing to learn from, so they are matched again by scene.
  const byGroup = new Map(held.map((d) => [`${d.map}/${d.family}/${d.seed}`, d]));
  const ruled = grade(p.kind, ex, rule, rule);
  const out: Graded[] = [];
  ex.forEach((e, i) => {
    const d = byGroup.get(e.group);
    const t = d ? todayCost(d, reading) : NaN;
    if (Number.isNaN(t)) return;
    const low = e.cost.reduce((m, v, c) => (e.mask[c] === 0 && v < m ? v : m), Infinity);
    out.push({ group: e.group, family: e.family, map: e.map, regret: t - low, ruleRegret: ruled[i]!.ruleRegret, disagree: ruled[i]!.disagree, logLoss: NaN, brier: NaN, said: NaN, happened: NaN });
  });
  return out;
}
