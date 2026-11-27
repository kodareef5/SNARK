// Scenes on the real lab world (world.ts): a scene from random.ts is built on its map with its walls, water, trees and
// standing bodies, its mover sent to its goal, and played tick by tick. One loop serves a whole episode (the scoreboard's
// headline) and a label's replay (label.ts): the replay forces a candidate at one answer of the point, reseeds the
// mover's luck there when the movement code allows it, and reads the cost one second on, five, and at the end.

import { GOAL_WALK, SEARCH_CELLS } from "../../server/behavior.ts";
import { LEAVE, SPARE } from "../../server/decide/decide.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SNAG_SECONDS } from "../../shared/decide/profiles.ts";
import { Rng } from "../../shared/rng.ts";
import type { Model } from "../../shared/decide/forward.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { combine } from "../../shared/decide/combine.ts";
import { answer } from "../../shared/decide/forward.ts";
import { Table } from "../../shared/decide/table.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { PATH_FOUND, PATH_REACH, PathFinder } from "../../shared/world/path.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { GAME_CATALOG, NAV_POINTS } from "./catalog.ts";
import { READINGS, type Final } from "./dataset.ts";
import { ALONE, type Answer, type Replay, type Replayer } from "./label.ts";
import { MIAMI_SIDE, bodyOf, type Scene } from "./random.ts";
import type { EpisodeResult } from "./rate.ts";
import { STANDIN, StandIn } from "./standin.ts";
import { lab, stateHash, type Lab } from "./world.ts";

/**
 * What a cost is made of, in ticks. Guesses the owner may turn: the whole of a body's health is worth `health` ticks, a
 * path cell searched `cell`, and a mover that has not arrived at the horizon costs `stuck` horizons and the ticks the
 * rest of the way would take in a straight line, which is more than any arrival.
 */
export const PRICES = { health: 900, cell: 0.02, stuck: 2 } as const;

/** Ticks after the decision at which the first two readings are taken (READINGS). */
const READ_AT = [TICK_RATE, 5 * TICK_RATE];

const maps = new Map<string, MapData>();
function cached(key: string, make: () => MapData): MapData {
  let m = maps.get(key);
  if (!m) {
    if (maps.size > 8) maps.delete(maps.keys().next().value!);
    m = make();
    maps.set(key, m);
  }
  return m;
}

/** The map a scene stands on: the lab's flat ground, with its trees or its water, or the Miami slice. */
export function mapFor(s: Scene): MapData {
  if (s.map === "miami") return cached("miami", () => miamiSlice().map);
  if (s.trees) {
    const { perChunk, seed } = s.trees;
    return cached(`trees/${perChunk}/${seed}`, () => flatMap(4, { nodes: [{ seed, perChunk, kinds: [["core:tree", 2], ["core:banyan", 1], ["core:rock", 1]], allowCell: 0, allow: null }] }));
  }
  if (s.water) {
    const w = s.water;
    return cached(`water/${s.seed}`, () => {
      const dims = { chunksX: 4, chunksZ: 4 }, cell = 2, side = (4 * 64) / cell;
      const grid = new Uint16Array(side * side);
      for (let j = Math.floor(w.z0 / cell); j < Math.ceil(w.z1 / cell); j++) for (let i = Math.floor(w.x0 / cell); i < Math.ceil(w.x1 / cell); i++) if (i >= 0 && j >= 0 && i < side && j < side) grid[j * side + i] = 1;
      return flatMap(4, { water: MapWater.fromGrid(dims, -32, 1 / 256, cell, [{ name: "Strip", level: Math.round((w.depth + 32) * 256) }], grid) });
    });
  }
  return cached("flat", () => flatMap(4));
}

export interface Built {
  scene: Scene;
  lab: Lab;
  mover: number;
  goal: { x: number; z: number };
  body: { radius: number; height: number; pace: number };
  /** Within this of its goal it has arrived. */
  arrive: number;
  /** Metres of the oracle's way from start to goal; NaN where it found none, and the scene is not played. */
  way: number;
  /** Bodies that stand, and when each is let go. */
  standers: { e: number; until: number; then?: { x: number; z: number } }[];
}

/** The nearest place to (x, z), out to 24 m, where a body of `r` and `h` stands free. */
export function freeNear(b: Lab, x: number, z: number, r: number, h: number): { x: number; z: number } {
  const hf = b.world.hf;
  for (let d = 0; d <= 24; d += 0.75) {
    const steps = d === 0 ? 1 : Math.ceil((2 * Math.PI * d) / 0.75);
    for (let i = 0; i < steps; i++) {
      const px = x + d * Math.sin((i / steps) * 2 * Math.PI), pz = z + d * Math.cos((i / steps) * 2 * Math.PI);
      if (capsuleFree(b.world, px, hf.heightAt(px, pz) + 0.05, pz, r, h)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** Cells the oracle's search may expand: the whole of its grid. */
const ORACLE_CELLS = (2 * PATH_REACH + 1) ** 2;

/**
 * Whether a body of `kind` can walk from (x0, z0) to within `arrive` of (x1, z1), by a search over the whole of the path
 * grid, where today's movers search a ninth of it: the metres of the way, or NaN where there is none.
 */
export function reach(w: Lab, kind: string, x0: number, z0: number, x1: number, z1: number, arrive: number, cells = ORACLE_CELLS): number {
  const reg = w.world.reg, body = reg.move[reg.index.get(kind)!]!;
  // Water does not stop it: a mover may swim where today's search will not take it.
  const f = new PathFinder(w.world, { ...body, swimDepth: 1e6 });
  f.budget = cells;
  f.doorways = reg.doorway;
  if (f.find(x0, z0, x1, z1) !== PATH_FOUND || f.count === 0) return NaN;
  if (Math.hypot(f.x[f.count - 1]! - x1, f.z[f.count - 1]! - z1) > arrive) return NaN;
  let metres = 0;
  for (let i = 1; i < f.count; i++) metres += Math.hypot(f.x[i]! - f.x[i - 1]!, f.z[i]! - f.z[i - 1]!);
  return metres;
}

/**
 * Tries at placing a scene's start and goal where the oracle finds a way, and the share of its horizon that way may take
 * at the mover's pace. On the slice of the city, more tries, each kept only where today's search would not find the way.
 */
const TRIES = 12;
const CITY_TRIES = 24;
const WAY_SHARE = 0.8;
const placed = new Map<string, Placed | null>();

export interface Placed {
  start: { x: number; z: number };
  goal: { x: number; z: number };
  way: number;
}

/**
 * Where a scene's mover starts and its goal is: as drawn, each moved to where the body stands free, if the oracle finds a
 * way between them short enough; else, from the scene's seed, a goal a few metres off (on the slice of the city, a new
 * start and goal as far apart). Null where no try finds one. Kept by scene, so every replay of it stands the same.
 */
function place(w: Lab, s: Scene, body: { radius: number; height: number; pace: number }, arrive: number): Placed | null {
  const key = `${s.map}/${s.family}/${s.seed}`;
  const kept = placed.get(key);
  if (kept !== undefined) return kept;
  const rng = new Rng((s.seed * 7919 + 17) >>> 0), line = Math.hypot(s.goal.x - s.start.x, s.goal.z - s.start.z);
  let out: Placed | null = null, easy: Placed | null = null;
  const city = s.map === "miami";
  for (let i = 0; i < (city ? CITY_TRIES : TRIES) && !out; i++) {
    let sx = s.start.x, sz = s.start.z, gx = s.goal.x, gz = s.goal.z;
    if (i > 0 && s.map === "miami") {
      const a = rng.float() * 2 * Math.PI;
      sx = MIAMI_SIDE / 2 + rng.range(-100, 100);
      sz = MIAMI_SIDE / 2 + rng.range(-100, 100);
      gx = sx + Math.sin(a) * line;
      gz = sz + Math.cos(a) * line;
    } else if (i > 0) {
      gx += rng.range(-8, 8);
      gz += rng.range(-8, 8);
    }
    const start = freeNear(w, sx, sz, body.radius, body.height), goal = freeNear(w, gx, gz, body.radius, body.height);
    const way = reach(w, s.kind, start.x, start.z, goal.x, goal.z, arrive);
    if (!((way / body.pace) * TICK_RATE <= WAY_SHARE * s.horizon)) continue;
    if (city && !Number.isNaN(reach(w, s.kind, start.x, start.z, goal.x, goal.z, arrive, SEARCH_CELLS))) easy ??= { start, goal, way };
    else out = { start, goal, way };
  }
  out ??= easy;
  if (placed.size > 4096) placed.clear();
  placed.set(key, out);
  return out;
}

/** A scene on its own lab world, its mover making for its goal; `at` puts it down there in place of where `place` would. */
export function build(s: Scene, at0?: Placed | null): Built {
  const w = lab(mapFor(s), s.seed);
  const reg = w.world.reg, wall = reg.index.get("core:wall_stone")!;
  for (const p of s.pieces) for (let y = 0; y < p.storeys; y++) w.world.structs.add(wall, p.x, w.world.hf.heightAt(p.x, p.z) + 1.5 + 3 * y, p.z, p.quarter * 16384, 0, 10000);
  const body = bodyOf(s.kind), mind = w.host.creatures.mind, arrive = Math.max(1.5, body.radius + 0.5);
  const at = at0 !== undefined ? at0 : place(w, s, body, arrive);
  const start = at?.start ?? freeNear(w, s.start.x, s.start.z, body.radius, body.height), goal = at?.goal ?? s.goal;
  const standers: Built["standers"] = [];
  for (const st of s.standers) {
    const e = w.host.spawnCreature(st.kind, st.x, st.z, 1);
    if (e < 0) continue;
    mind.stay(e, st.until + s.horizon * 4);
    standers.push({ e, until: st.until, then: st.then });
  }
  const mover = w.host.spawnCreature(s.kind, start.x, start.z, 1);
  // Where the body cannot be put down after all, the scene is not played, as one with no way.
  if (mover < 0) return { scene: s, lab: w, mover, goal, body, arrive, standers, way: NaN };
  w.world.ents.yaw[mover] = mind.look[mover] = s.start.yaw;
  mind.stay(mover, s.horizon * 4);
  mind.goTo(mover, goal.x, goal.z, GOAL_WALK);
  return { scene: s, lab: w, mover, goal, body, arrive, standers, way: at?.way ?? NaN };
}

export interface Hooks {
  /** The point studied, and who decides it: "off" (today's code), "rule" or "model". */
  point: string;
  policy: "off" | "rule" | "model";
  /** The trained scorers loaded; no other is, whatever the game's weights folder holds. */
  models?: readonly Model[];
  /** Sees each answer of the point for the mover (`n` counts them from 0) while its tables are filled; returns a candidate, LEAVE, or ALONE for today's code. */
  answered?(n: number, tick: number, pick: number): number;
  /** Stops the play once this holds. */
  stop?(tick: number): boolean;
  extra?: Installer;
}

/** What a play saw of its mover. */
export interface Trace {
  arrivedAt: number;
  /** Answers acted on that steered the mover: of nav.ring where the world has it, else of the point studied. */
  acted: number;
  ticks: number;
  stuckTicks: number;
  decideMicros: number[];
  answers: number;
}

function healthShare(b: Built): number {
  const w = b.lab, rec = w.host.records.byPid.get(w.world.ents.pid[b.mover]!);
  const v = rec?.vitals;
  if (!v) return 1;
  const max = v.max[V_HEALTH]!;
  return max > 0 ? v.at(V_HEALTH, w.world.tick) / max : 1;
}

/** Puts a point on a built world that the world does not declare itself, and says what it needs before each tick; null where it has none by that name. */
export type Installer = (b: Built, name: string) => { id: number; before(tick: number): void } | null;

/** The point named on this world: the game's own, one `extra` puts in, or the lab's stand-in. Returns its number and what it needs before each tick. */
function install(b: Built, name: string, extra?: Installer): { id: number; before(tick: number): void } {
  const d = b.lab.host.decide, mind = b.lab.host.creatures.mind;
  const own = extra?.(b, name);
  if (own) return own;
  const id = d.points.findIndex((p) => p.name === name);
  if (id >= 0) return { id, before: () => {} };
  if (name !== STANDIN) throw new Error(`no point ${name} on this world: the game declares its points in server/decide, and the lab has only ${STANDIN}`);
  const s = new StandIn(b.lab.world, mind, { e: b.mover, goal: b.goal, ...b.body });
  const at = d.add(s);
  return { id: at, before: (tick) => {
    const rung = s.due(tick);
    if (rung >= 0) d.put(at, b.mover, rung);
  } };
}

/** Who decides on a world where `point` is studied: the ladder's two points together, or the one point alone. */
export function policyText(point: string, policy: Hooks["policy"]): string {
  return NAV_POINTS.includes(point) ? NAV_POINTS.map((p) => `${p}=${policy}`).join(",") : `${point}=${policy}`;
}

/** Plays a built scene under `hooks` until it arrives, the hooks stop it, or `limit` ticks pass. */
export function play(b: Built, hooks: Hooks, limit = b.scene.horizon): Trace {
  const w = b.lab, d = w.host.decide, mind = w.host.creatures.mind, ents = w.world.ents;
  d.trained.clear();
  for (const m of hooks.models ?? []) d.trained.set(m.profile, m);
  const point = install(b, hooks.point, hooks.extra);
  d.set(policyText(hooks.point, hooks.policy));
  const trace: Trace = { arrivedAt: -1, acted: 0, ticks: 0, stuckTicks: 0, decideMicros: [], answers: 0 };
  if (Number.isNaN(b.way)) return trace;
  d.force = (p, e, pick) => {
    if (p !== point.id || e !== b.mover || !hooks.answered) return LEAVE;
    const told = hooks.answered(trace.answers, w.world.tick, pick);
    return told === ALONE ? SPARE : told;
  };
  const steers = d.points.findIndex((q) => q.name === "nav.ring");
  d.tap = (p, e) => {
    if (e !== b.mover) return;
    if (p === point.id) trace.answers++;
    if (p === (steers >= 0 ? steers : point.id) && d.acts(p)) trace.acted++;
  };
  const step = d.step.bind(d);
  let spent = 0;
  d.step = (tick) => {
    const from = performance.now();
    step(tick);
    spent = (performance.now() - from) * 1000;
  };
  for (let t = 0; t < limit; t++) {
    const tick = w.world.tick;
    if (Math.hypot(b.goal.x - ents.x[b.mover]!, b.goal.z - ents.z[b.mover]!) <= b.arrive) {
      trace.arrivedAt = t;
      break;
    }
    if (hooks.stop?.(tick)) break;
    for (const s of b.standers) if (s.then && tick === s.until) mind.goTo(s.e, s.then.x, s.then.z, GOAL_WALK);
    point.before(tick);
    w.tick();
    trace.ticks++;
    trace.decideMicros.push(spent);
    if (mind.stuck[b.mover]! > 0 || mind.pinned[b.mover]! > 0) trace.stuckTicks++;
  }
  return trace;
}

/** The cost of where a mover is: ticks since `from`, the straight way left at its pace, and the prices of health and search. */
function costNow(b: Built, from: number, health0: number, cells0: number, end: boolean): number {
  const w = b.lab, ents = w.world.ents, mind = w.host.creatures.mind;
  const left = Math.hypot(b.goal.x - ents.x[b.mover]!, b.goal.z - ents.z[b.mover]!);
  const arrived = left <= b.arrive;
  const elapsed = w.world.tick - from, rest = arrived ? 0 : (left / b.body.pace) * TICK_RATE;
  const prices = PRICES.health * Math.max(0, health0 - healthShare(b)) + PRICES.cell * (mind.searched - cells0);
  return (end && !arrived ? PRICES.stuck * b.scene.horizon : elapsed) + rest + prices;
}

/** A whole episode of a scene, one policy deciding the point from start to finish. */
export function episode(s: Scene, point: string, policy: Hooks["policy"], models: readonly Model[] = [], extra?: Installer): EpisodeResult {
  const b = build(s), mind = b.lab.host.creatures.mind;
  const health0 = healthShare(b), cells0 = mind.searched, searches0 = mind.searches;
  const tick0 = b.lab.world.tick;
  const t = play(b, { point, policy, models, extra });
  const result: EpisodeResult = {
    family: s.map === "miami" ? "miami" : s.family, seed: s.seed, skipped: Number.isNaN(b.way), route: b.way, acted: t.acted, arrived: t.arrivedAt >= 0, ticks: t.ticks, healthLost: Math.max(0, health0 - healthShare(b)), stuckTicks: t.stuckTicks,
    searches: mind.searches - searches0, cells: mind.searched - cells0, end: { x: b.lab.world.ents.x[b.mover]!, z: b.lab.world.ents.z[b.mover]! }, cost: costNow(b, tick0, health0, cells0, true), decideMicros: t.decideMicros,
  };
  b.lab.host.shutdown();
  return result;
}

/**
 * The answer of a point of several passes made again with `combine` (shared/decide/combine.ts) from its tables as they
 * stand: each pass by the weight it says, or else by its mix over the temperature of whoever scored it, and the stick on
 * the heading its `held` column marks; with the server's own answer, its mask too. Whether that gives the server's pick,
 * and its probabilities where it says them, and the answer as made.
 */
function madeAgain(b: Built, id: number, pick: number, policy: Hooks["policy"]): { agrees: boolean; final: Final } | null {
  const d = b.lab.host.decide, point = d.points[id]!, passes = GAME_CATALOG.passes?.[point.name];
  if (!passes || point.tables.length < 2) return null;
  const first = point.tables[0]!, held = first.profile.columns.indexOf("held"), k = first.table.k;
  let at = -1;
  for (let c = 0; c < k && held >= 0; c++) if (first.table.rows[c * first.table.width + held] === 1) at = c;
  const weights = point.tables.map(({ profile, weight }) => weight ?? (passes.mix[profile.name] ?? 0) / (policy === "model" ? (d.trained.get(profile.name)?.temperature ?? 1) : 1));
  const into = new Table(k, 0, 1);
  let again = combine(into, point.tables.map(({ table }, i) => ({ table, weight: weights[i]! })), at, passes.stick);
  const made = point.final;
  let close = true;
  if (made) {
    for (let c = 0; c < k; c++) if (made.mask[c] !== 0) into.mask[c] = 1;
    again = answer("choice", into, 1);
    for (let c = 0; c < k; c++) if (Math.abs(into.out[c]! - made.out[c]!) > 1e-6) close = false;
  }
  const final: Final = { weights: Float32Array.from(weights), out: (made ?? into).out.slice(0, k), mask: (made ?? into).mask.slice(0, k) };
  return { agrees: again === pick && close, final };
}

/** Copies a point's tables as they stand. */
function served(b: Built, id: number): Answer["tables"] {
  return b.lab.host.decide.points[id]!.tables.map(({ profile, table: t }) => ({
    profile: profile.name, k: t.k, state: t.state.slice(), rows: t.rows.slice(0, t.k * t.width), bias: t.bias.slice(0, t.k), mask: t.mask.slice(0, t.k),
  }));
}

/** Who chooses everywhere but the labelled decision: the rule, or trained scorers. */
export interface Under {
  policy: "rule" | "model";
  models: readonly Model[];
  extra?: Installer;
}

/** What the lab observes after a "yes" answer of a point that reads no outcome of its own: when, and what it then says. */
interface Observer {
  ticks: number;
  start(b: Built): number;
  read(b: Built, from: number): number;
}

/** The share of its pace toward its goal that is real progress, as the ladder judges it (nav.ts, which does not export it). */
export const SNAG_PROGRESS = 0.35;
const left = (b: Built): number => Math.hypot(b.goal.x - b.lab.world.ents.x[b.mover]!, b.goal.z - b.lab.world.ents.z[b.mover]!);

/** nav.snag: 1 where the mover gained less than real progress toward its goal over the SNAG_SECONDS after the question. */
export const OBSERVERS: Readonly<Record<string, Observer>> = {
  "nav.snag": { ticks: SNAG_SECONDS * TICK_RATE, start: left, read: (b, from) => (from - left(b) < SNAG_PROGRESS * b.body.pace * SNAG_SECONDS ? 1 : 0) },
};

/** The game's scenes for label.ts. */
export function gameReplayer(point: string, under: Under): Replayer<Scene> {
  return {
    survey(s) {
      const b = build(s), d = b.lab.host.decide, out: Answer[] = [], seen = OBSERVERS[point];
      const waiting: { e: number; due: number; at: number; from: number }[] = [];
      let id = -1;
      const t = play(b, {
        point, policy: under.policy, models: under.models, extra: under.extra,
        answered: (_n, tick, pick) => {
          id = d.points.findIndex((p) => p.name === point);
          const p = d.points[id]!;
          const again = madeAgain(b, id, pick, under.policy);
          out.push({ tables: served(b, id), pick, hash: stateHash(b.lab.world), tick, ...(again ? { final: again.final, agrees: again.agrees } : {}) });
          if (p.horizon > 0 && p.outcome) waiting.push({ e: b.mover, due: tick + p.horizon, at: out.length - 1, from: 0 });
          else if (seen) waiting.push({ e: b.mover, due: tick + seen.ticks, at: out.length - 1, from: seen.start(b) });
          return LEAVE;
        },
        stop: (tick) => {
          const o = new Float32Array(8);
          while (waiting.length && waiting[0]!.due <= tick) {
            const w = waiting.shift()!, p = d.points[id]!;
            if (p.horizon > 0 && p.outcome) {
              if (p.outcome(w.e, tick, o) > 0) out[w.at]!.outcome = o[0]!;
            } else out[w.at]!.outcome = seen!.read(b, w.from);
          }
          return false;
        },
      });
      // Arrived before an outcome was due: it was no snag.
      if (seen && t.arrivedAt >= 0) for (const w of waiting) out[w.at]!.outcome = 0;
      b.lab.host.shutdown();
      return out;
    },
    replay(s, ordinal, force, seed) {
      const b = build(s), mind = b.lab.host.creatures.mind;
      let hash = -1, from = -1, health0 = 1, cells0 = 0;
      const costs: number[] = [];
      play(b, {
        point, policy: under.policy, models: under.models, extra: under.extra,
        answered: (n) => {
          if (n !== ordinal) return LEAVE;
          hash = stateHash(b.lab.world);
          from = b.lab.world.tick;
          health0 = healthShare(b);
          cells0 = mind.searched;
          mind.reseed(seed);
          return force;
        },
        stop: (tick) => {
          if (from < 0) return tick >= s.horizon;
          while (costs.length < READ_AT.length && tick - from >= READ_AT[costs.length]!) costs.push(costNow(b, from, health0, cells0, false));
          return tick - from >= s.horizon;
        },
      }, Infinity);
      if (from < 0) {
        b.lab.host.shutdown();
        return null;
      }
      // Arrived before a reading: that reading is the arrival's cost.
      const end = costNow(b, from, health0, cells0, true);
      while (costs.length < READINGS.length - 1) costs.push(end);
      costs.push(end);
      b.lab.host.shutdown();
      const r: Replay = { hash, costs, reseeded: true };
      return r;
    },
  };
}
