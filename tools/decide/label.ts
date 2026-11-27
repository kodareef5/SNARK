// Labels by forced-choice replay. A scene is played once with its chooser, and every answer of the point is recorded.
// One answer is drawn from the scene's seed; then the scene is played again from its start once for each candidate that
// answer could take and each of a few seeds, that candidate forced there and the chooser left alone everywhere else, the
// mover's random stream reseeded there so every candidate meets the same luck after. A replay whose world differs at the
// decision from the first play's is thrown away and counted. A candidate's target is how often it was best.
//
// The world is behind `Replayer`, so a game (setups.ts) and the toy (toy.ts) are labelled by the same code. One decision
// is labelled a scene play, so its rows are not correlated.

import { Rng } from "../../shared/rng.ts";
import { READINGS, type Decision, type TableRow } from "./dataset.ts";

/** Act on the chooser's own pick at the decision. */
export const LEAVE = -1;
/** Leave the point alone at the decision, as today's code would: its answer is not acted on. */
export const ALONE = -2;

/** One answer of the point in a play: its tables as served, the pick, the world's hash then, and the tick. */
export interface Answer {
  tables: TableRow[];
  pick: number;
  hash: number;
  tick: number;
  /** For a "yes" point, what was observed at its horizon after the answer. */
  outcome?: number;
}

export interface Replay {
  /** The world's hash at the decision, before it was acted on. */
  hash: number;
  /** The cost at each reading (READINGS), counted from the decision. */
  costs: number[];
  /** Whether the mover's random stream could be reseeded there. */
  reseeded: boolean;
}

export interface Replayer<S> {
  /** Plays the scene from its start with the chooser and returns every answer of the point. */
  survey(scene: S): Answer[];
  /** Plays it again; at the point's `ordinal`th answer acts on `force` (a candidate, LEAVE or ALONE) and reseeds with `seed`. Null where that answer never comes. */
  replay(scene: S, ordinal: number, force: number, seed: number): Replay | null;
}

export interface Key {
  seed: number;
  family: string;
  map: string;
}

export interface Labelled {
  decision: Decision | null;
  /** A "yes" point's other answers of the scene, where more than one is taken. */
  more: Decision[];
  /** The point's kind, as its first table says. */
  kind?: "choice" | "yes";
  /** Replays run, thrown away for a world that differed, and run with no reseed. */
  runs: number;
  thrown: number;
  noReseed: number;
}

/** The seeds of the luck after a decision: the same for every scene, so the readings of two scenes are alike. */
export function luck(seeds: number): number[] {
  return Array.from({ length: seeds }, (_, s) => 0x5eed + 7919 * s);
}

/** Which answer of a scene is labelled: drawn from its seed among the `n` it gave. */
export function ordinalOf(seed: number, n: number): number {
  return new Rng((seed ^ 0x9e3779b9) >>> 0).int(n);
}

/**
 * Labels one decision of `scene`. A choice is replayed once for each candidate the answer leaves open (the union of its
 * tables' masks) and each seed, and `today` adds a replay of each seed with the point left alone. A "yes" point takes
 * the outcome its survey observed, at up to `yeses` answers spread evenly over the scene: it costs no replay.
 */
export function labelScene<S>(rp: Replayer<S>, scene: S, key: Key, o: { kind: "choice" | "yes" | ((a: Answer) => "choice" | "yes"); seeds: number; today?: boolean; ordinal?: number; yeses?: number }): Labelled {
  const answers = rp.survey(scene);
  const out: Labelled = { decision: null, more: [], runs: 1, thrown: 0, noReseed: 0 };
  if (answers.length === 0) return out;
  const ordinal = o.ordinal ?? ordinalOf(key.seed, answers.length);
  const a = answers[Math.min(ordinal, answers.length - 1)]!;
  const R = READINGS.length;
  const base = { ...key, ordinal, tick: a.tick, pick: a.pick, tables: a.tables, readings: R };
  const kind = typeof o.kind === "function" ? o.kind(a) : o.kind;
  out.kind = kind;
  if (kind === "yes") {
    const yes = (b: Answer, at: number): Decision => ({ ...key, ordinal: at, tick: b.tick, pick: b.pick, tables: b.tables, readings: R, label: b.outcome ?? NaN, seeds: 0, costs: new Float32Array(0), today: new Float32Array(0) });
    out.decision = yes(a, ordinal);
    const n = Math.min(o.yeses ?? 1, answers.length);
    for (let j = 1; j < n; j++) {
      const at = (ordinal + Math.round((j * answers.length) / n)) % answers.length;
      out.more.push(yes(answers[at]!, at));
    }
    return out;
  }
  const k = a.tables[0]!.k, S = o.seeds, seeds = luck(S);
  const costs = new Float32Array(k * S * R).fill(NaN), today = new Float32Array(S * R).fill(NaN);
  const open = (c: number) => a.tables.every((t) => t.mask[c] === 0);
  let reseeds = true;
  const run = (force: number, s: number, into: Float32Array, at: number): void => {
    const r = rp.replay(scene, ordinal, force, seeds[s]!);
    out.runs++;
    if (!r) {
      out.thrown++;
      return;
    }
    if (!r.reseeded) {
      out.noReseed++;
      reseeds = false;
    }
    if (r.hash !== a.hash) {
      out.thrown++;
      return;
    }
    for (let i = 0; i < R; i++) into[at + i] = r.costs[i]!;
  };
  for (let s = 0; s < S; s++) {
    for (let c = 0; c < k; c++) if (open(c)) run(c, s, costs, (c * S + s) * R);
    if (o.today) run(ALONE, s, today, s * R);
    // Without a reseed every seed plays the same, so one is enough and the rest are left unread.
    if (!reseeds) break;
  }
  out.decision = { ...base, label: 0, seeds: S, costs, today };
  return out;
}
