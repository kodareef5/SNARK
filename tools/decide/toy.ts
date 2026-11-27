// A toy world for the pipeline, with no game in it: a grid of walls, a mover that walks straight at its goal and, once
// stuck, asks which of eight headings to walk for a while. Its question is a ring filled like the game's mid and far
// passes: where each heading leads, and how far it is free near and further. The loop runs whole (generate, label by
// forced choice, fit, score) in seconds, and shows a trained scorer beating a hand rule made poor on purpose: it looks
// at the goal and barely at the walls. It imports only the engine and the lab, and is the first example for another engine.
//
//   bun tools/decide/toy.ts [--scenes 150] [--seed 1]    writes .cache/decide/toy/

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, type Model } from "../../shared/decide/forward.ts";
import { profile } from "../../shared/decide/profile.ts";
import { ruleOf } from "../../shared/decide/rules.ts";
import type { Scoreboard } from "../../shared/decide/scoreboard.ts";
import { soon } from "../../shared/decide/units.ts";
import { Table } from "../../shared/decide/table.ts";
import { readModel } from "../../shared/decide/weights.ts";
import { Rng } from "../../shared/rng.ts";
import { boardHtml } from "./board.ts";
import { READINGS, Writer, dataDir, readData } from "./dataset.ts";
import { fitPoint, roleOf, type Catalog, type FitOptions, type Split } from "./fit.ts";
import { ALONE, LEAVE, labelScene, type Answer, type Replayer } from "./label.ts";
import { episodeScore, ratePoint, type EpisodeResult, type Trained } from "./rate.ts";

/**
 * `stuck` is how often it was stuck lately, a share of four; `near` how near the goal is. A heading's `goal` is its cosine to
 * the goal, `way` how much nearer by the shortest way the leg brings it (-1 to 1), `run` and `far` its free run in a leg
 * and in 16 cells, and `tried` 1 for the heading that just failed.
 */
export const TOY = profile("toy.ring", "choice", true, ["stuck", "near"], ["goal", "way", "run", "far", "tried"], [["stuck", "far"], ["stuck", "goal"], ["stuck", "way"], ["near", "goal"]]);
/** Toward the goal, and hardly minding the walls: the poor rule a trained scorer is to beat. */
export const TOY_RULE = ruleOf(TOY, { own: { goal: 3, run: 0.5 } });
export const TOY_FAMILIES = ["scatter", "walls", "cups", "combs"] as const;
export const TOY_SPLIT: Split = { held: ["cups"], heldMaps: [], validation: ["combs"] };
export const TOY_CATALOG: Catalog = { profiles: [TOY], rules: new Map([[TOY.name, TOY_RULE]]), split: TOY_SPLIT };

/** Labels are read five seconds on: under a poor chooser, what a leg gains is clear then and lost in its later choices by the end. */
export const TOY_READING = READINGS.indexOf("1s");
const N = 40, K = 8, PACE = 0.5, LEG = 6, HORIZON = 400;
/** Steps the toy calls a second, for the readings at one and five. */
const SECOND = 10;

export interface ToyScene {
  family: string;
  seed: number;
}

interface Layout {
  wall: Uint8Array;
  /** Cells of the shortest way to the goal from each cell, by its four sides; Infinity where there is none. */
  way: Float64Array;
  sx: number;
  sz: number;
  gx: number;
  gz: number;
}

/** A scene's walls, start and goal, every measure drawn from its seed. */
export function layout(s: ToyScene): Layout {
  const rng = new Rng(s.seed * 7 + TOY_FAMILIES.indexOf(s.family as (typeof TOY_FAMILIES)[number]));
  const wall = new Uint8Array(N * N);
  const set = (x: number, z: number) => {
    if (x >= 0 && z >= 0 && x < N && z < N) wall[z * N + x] = 1;
  };
  for (let i = 0; i < N; i++) {
    set(i, 0);
    set(i, N - 1);
    set(0, i);
    set(N - 1, i);
  }
  const sx = 4 + rng.int(6), sz = 6 + rng.int(N - 12), gx = N - 5 - rng.int(6), gz = 6 + rng.int(N - 12);
  if (s.family === "scatter") {
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) if (rng.float() < 0.06 + 0.06 * (s.seed % 3)) set(x, z);
  } else if (s.family === "walls") {
    for (let w = 3 + rng.int(4); w > 0; w--) {
      const x = 10 + rng.int(N - 20), z0 = 2 + rng.int(N - 12), len = 8 + rng.int(14);
      for (let z = z0; z < z0 + len; z++) set(x, z);
    }
  } else if (s.family === "cups") {
    // A U round the start, open away from the goal, and a few more on the way.
    const cup = (cx: number, cz: number, half: number, depth: number) => {
      for (let z = cz - half; z <= cz + half; z++) set(cx + 2, z);
      for (let x = cx + 2 - depth; x <= cx + 2; x++) {
        set(x, cz - half);
        set(x, cz + half);
      }
    };
    cup(sx, sz, 2 + rng.int(3), 4 + rng.int(4));
    for (let c = rng.int(3); c > 0; c--) cup(12 + rng.int(N - 24), 4 + rng.int(N - 8), 2 + rng.int(3), 3 + rng.int(4));
  } else {
    // A comb: one long wall with a gap, teeth on the near side.
    const x = 14 + rng.int(N - 28), gap = 3 + rng.int(N - 8), width = 2 + rng.int(2);
    for (let z = 1; z < N - 1; z++) if (z < gap || z >= gap + width) set(x, z);
    for (let t = 2 + rng.int(4); t > 0; t--) {
      const z = 2 + rng.int(N - 4);
      for (let i = 1; i <= 3 + rng.int(4); i++) set(x - i, z);
    }
  }
  for (const [x, z] of [[sx, sz], [gx, gz]] as const) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) wall[(z + dz) * N + x + dx] = 0;
  const fill = (): Float64Array => {
    const way = new Float64Array(N * N).fill(Infinity), queue = [gz * N + gx];
    way[gz * N + gx] = 0;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]!;
      for (const n of [c - 1, c + 1, c - N, c + N]) if (wall[n] === 0 && way[n] === Infinity) {
        way[n] = way[c]! + 1;
        queue.push(n);
      }
    }
    return way;
  };
  let way = fill();
  // Shut off from the goal: a lane is cut along the start's row and the goal's column.
  if (way[sz * N + sx] === Infinity) {
    for (let x = Math.min(sx, gx); x <= Math.max(sx, gx); x++) wall[sz * N + x] = 0;
    for (let z = Math.min(sz, gz); z <= Math.max(sz, gz); z++) wall[z * N + gx] = 0;
    way = fill();
  }
  return { wall, way, sx: sx + 0.5, sz: sz + 0.5, gx: gx + 0.5, gz: gz + 0.5 };
}

const blocked = (L: Layout, x: number, z: number): boolean => x < 0 || z < 0 || x >= N || z >= N || L.wall[Math.floor(z) * N + Math.floor(x)] !== 0;

/** How far a heading is free from (x, z), up to `reach`. */
function run(L: Layout, x: number, z: number, a: number, reach: number): number {
  const dx = Math.sin(a), dz = Math.cos(a);
  for (let d = 0.25; d <= reach; d += 0.25) if (blocked(L, x + dx * d, z + dz * d)) return d - 0.25;
  return reach;
}

/** Who answers: a scorer, or "today", which takes a random free heading as plain game code does. */
export type ToyPolicy = Model | "today";

interface Hooks {
  /** Sees each answer while its table is filled and returns what to act on: a candidate, LEAVE or ALONE. */
  answered?(n: number, t: Table, pick: number, hash: number, step: number): number;
  /** Called after the answer it named; may reseed the mover's luck. */
  reseed?(n: number): number | null;
}

interface Played {
  arrived: boolean;
  steps: number;
  stuckSteps: number;
  /** Distance left at each step. */
  left: Float64Array;
  /** The step of the hooked decision, or -1. */
  at: number;
}

/** Plays a toy scene from its start under `policy`. A scorer is asked at the end of each leg and whenever it is stuck; "today" walks straight at the goal and takes a random free heading once stuck. */
function play(s: ToyScene, policy: ToyPolicy, hooks: Hooks = {}): Played {
  const L = layout(s);
  let rng = new Rng(s.seed);
  const t = new Table(K, TOY.state.length, TOY.columns.length), w = TOY.columns.length;
  let x = L.sx, z = L.sz, leg = -1, legLeft = 0, stuck = 0, last = -1, lastAt = -1000, answers = 0, at = -1, stuckSteps = 0;
  const asks: number[] = [];
  const left = new Float64Array(HORIZON + 1);
  const wayAt = (px: number, pz: number) => L.way[Math.floor(pz) * N + Math.floor(px)]!;
  let step = 0;
  for (; step < HORIZON; step++) {
    left[step] = wayAt(x, z);
    if (Math.hypot(L.gx - x, L.gz - z) < 1) break;
    const due = policy === "today" ? stuck >= 2 && legLeft === 0 : legLeft === 0 || stuck >= 2;
    if (due) {
      while (asks.length && asks[0]! < step - 40) asks.shift();
      if (stuck >= 2) asks.push(step);
      t.clear(K);
      t.state[TOY.s.stuck] = Math.min(1, asks.length / 4);
      t.state[TOY.s.near] = soon(Math.hypot(L.gx - x, L.gz - z), 10);
      const toGoal = Math.atan2(L.gx - x, L.gz - z), here = wayAt(x, z), reach = LEG * PACE;
      for (let i = 0; i < K; i++) {
        const a = (i / K) * Math.PI * 2, free = run(L, x, z, a, reach);
        const there = wayAt(x + Math.sin(a) * free, z + Math.cos(a) * free);
        t.rows[i * w + TOY.c.goal] = Math.cos(a - toGoal);
        t.rows[i * w + TOY.c.way] = Number.isFinite(here - there) ? Math.max(-1, Math.min(1, (here - there) / reach)) : 0;
        t.rows[i * w + TOY.c.run] = free / reach;
        t.rows[i * w + TOY.c.far] = run(L, x, z, a, 16) / 16;
        t.rows[i * w + TOY.c.tried] = i === last && stuck >= 2 && step - lastAt < 20 ? 1 : 0;
        if (run(L, x, z, a, 0.75) < 0.75) t.mask[i] = 1;
      }
      const free = () => {
        const open = Array.from({ length: K }, (_, i) => i).filter((i) => t.mask[i] === 0);
        return open.length ? open[rng.int(open.length)]! : -1;
      };
      let pick = policy === "today" ? free() : decide(policy, TOY, t);
      const hash = mix([x, z, legLeft, stuck, step, last]);
      const told = hooks.answered ? hooks.answered(answers, t, pick, hash, step) : LEAVE;
      if (told === ALONE) pick = stuck >= 2 ? free() : -1;
      else if (told >= 0) pick = told;
      const seed = hooks.reseed?.(answers) ?? null;
      if (seed !== null) {
        rng = new Rng(seed);
        at = step;
      }
      answers++;
      if (pick >= 0) {
        leg = pick;
        legLeft = LEG;
        last = pick;
        lastAt = step;
      }
      stuck = 0;
    }
    // A little slip in every step, so the luck after a decision matters.
    const a = (legLeft > 0 ? (leg / K) * Math.PI * 2 : Math.atan2(L.gx - x, L.gz - z)) + (rng.float() - 0.5) * 0.5;
    if (legLeft > 0) legLeft--;
    const nx = x + Math.sin(a) * PACE, nz = z + Math.cos(a) * PACE;
    if (!blocked(L, nx, nz)) [x, z] = [nx, nz];
    else if (!blocked(L, nx, z) && Math.abs(nx - x) > 0.1) x = nx;
    else if (!blocked(L, x, nz) && Math.abs(nz - z) > 0.1) z = nz;
    else {
      stuck++;
      stuckSteps++;
      continue;
    }
    stuck = 0;
  }
  left[step] = wayAt(x, z);
  return { arrived: Math.hypot(L.gx - x, L.gz - z) < 1, steps: step, stuckSteps, left: left.subarray(0, step + 1), at };
}

function mix(values: number[]): number {
  let h = 0x811c9dc5;
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (const v of values) {
    f[0] = v;
    h = Math.imul(h ^ u[0]!, 0x01000193) >>> 0;
  }
  return h;
}

/** Steps to arrive, or twice the horizon and the steps the rest would take when it never does: from `from`, read at `after` steps. */
function costAt(p: Played, from: number, after: number): number {
  const end = Math.min(p.steps, from + after);
  if (end === p.steps && p.arrived) return end - from;
  const rest = p.left[end - 0]! / PACE;
  return end === p.steps && after === Infinity ? 2 * HORIZON + rest : end - from + rest;
}

export function toyReplayer(policy: ToyPolicy): Replayer<ToyScene> {
  return {
    survey(s) {
      const out: Answer[] = [];
      play(s, policy, {
        answered: (_n, t, pick, hash, step) => {
          out.push({ tables: [{ profile: TOY.name, k: t.k, state: t.state.slice(), rows: t.rows.slice(0, t.k * t.width), bias: t.bias.slice(0, t.k), mask: t.mask.slice(0, t.k) }], pick, hash, tick: step });
          return LEAVE;
        },
      });
      return out;
    },
    replay(s, ordinal, force, seed) {
      let hash = -1;
      const p = play(s, policy, {
        answered: (n, _t, _pick, h) => (n === ordinal ? ((hash = h), force) : LEAVE),
        reseed: (n) => (n === ordinal ? seed : null),
      });
      if (p.at < 0) return null;
      return { hash, reseeded: true, costs: [costAt(p, p.at, SECOND), costAt(p, p.at, 5 * SECOND), costAt(p, p.at, Infinity)] };
    },
  };
}

/** A whole toy episode under `policy`. */
export function toyEpisode(s: ToyScene, policy: ToyPolicy): EpisodeResult {
  const p = play(s, policy);
  return { arrived: p.arrived, ticks: p.steps, healthLost: 0, stuckTicks: p.stuckSteps, cells: 0, cost: costAt(p, 0, Infinity), decideMicros: [] };
}

/** The scenes of a run: `per` of each family, seeds from `seed`. */
export function toyScenes(per: number, seed = 1): ToyScene[] {
  return TOY_FAMILIES.flatMap((family) => Array.from({ length: per }, (_, i) => ({ family, seed: seed * 100000 + i })));
}

export interface ToyResult {
  board: Scoreboard;
  decisions: number;
  runs: number;
  thrown: number;
  seconds: number;
}

/** The whole loop on the toy in `root`: generate and label, fit a line and a hidden layer, and score. */
export function toyLoop(o: { root: string; per?: number; seed?: number; hidden?: number }): ToyResult {
  const from = performance.now();
  const root = o.root, point = TOY.name, rp = toyReplayer(TOY_RULE);
  const w = new Writer(dataDir(point, join(root, "data")), point, "choice", [TOY], { made: new Date().toISOString(), revision: "toy", under: "rule" }, true);
  let runs = 0, thrown = 0;
  for (const s of toyScenes(o.per ?? 150, o.seed ?? 1)) {
    const l = labelScene(rp, s, { seed: s.seed, family: s.family, map: "toy" }, { kind: "choice", seeds: 3, today: true });
    runs += l.runs;
    thrown += l.thrown;
    w.run.scenes++;
    w.run.thrown += l.thrown;
    if (l.decision) w.add(l.decision);
    else w.run.none++;
  }
  w.save();
  const fits: Trained[] = [];
  for (const f of [{ kind: "linear" }, { kind: "hidden", hidden: o.hidden ?? 8 }] as FitOptions[]) {
    const r = fitPoint(point, { ...f, seed: o.seed ?? 1, reading: TOY_READING }, TOY_CATALOG, root);
    const m = readModel(r.written, TOY);
    if (typeof m === "string") throw new Error(m);
    fits.push({ name: r.file.split("/").pop()!.replace(/\.json$/, ""), kind: f.kind, model: m, bytes: statSync(r.file).size });
  }
  const { decisions } = readData(dataDir(point, join(root, "data")), [TOY]);
  const held = toyScenes(o.per ?? 150, o.seed ?? 1).filter((s) => roleOf(TOY_SPLIT, s.family, "toy") === "held");
  const policies: [string, ToyPolicy][] = [["today", "today"], ["rule", TOY_RULE], ...fits.map((f): [string, ToyPolicy] => [f.name, f.model])];
  const episodes = policies.map(([name, pol]) => episodeScore(name, held.map((s) => toyEpisode(s, pol))));
  const scores = ratePoint({ point, profile: TOY, cat: TOY_CATALOG, decisions, reading: TOY_READING, trained: fits, episodes, seed: o.seed ?? 1 });
  const board: Scoreboard = { made: new Date().toISOString(), revision: "toy", points: [scores] };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "scoreboard.json"), JSON.stringify(board, null, 1));
  writeFileSync(join(root, "scoreboard.html"), boardHtml(board));
  return { board, decisions: decisions.length, runs, thrown, seconds: (performance.now() - from) / 1000 };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const r = toyLoop({ root: ".cache/decide/toy", per: Number(arg("--scenes") ?? 150), seed: Number(arg("--seed") ?? 1) });
  const p = r.board.points[0]!;
  console.log(`toy: ${r.decisions} decisions labelled from ${r.runs} plays (${r.thrown} thrown away) in ${r.seconds.toFixed(1)} s; headroom ${p.headroom.toFixed(3)}`);
  for (const e of p.episodes) console.log(`  episodes, ${e.name}: arrived ${e.arrived} of ${e.scenes}, mean cost ${e.cost.toFixed(1)}, ${e.ticks.toFixed(0)} steps`);
  for (const s of p.scores) console.log(`  ${s.name}: regret ${s.regret.toFixed(2)} steps, ${s.regretRatio.toFixed(3)} of the rule's (${s.interval[0].toFixed(2)} to ${s.interval[1].toFixed(2)}), log loss ${s.logLoss.toFixed(3)}, ECE ${s.ece.toFixed(3)}, state hidden ${s.blind.state.toFixed(2)}${s.kind === "linear" || s.kind === "hidden" ? `, gate: ${s.gate.pass ? "passes" : s.gate.why.join("; ")}` : ""}`);
  console.log("  .cache/decide/toy/scoreboard.html");
}
