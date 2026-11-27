// Scenes on the real lab world (world.ts): a scene from random.ts is built on its map with its walls, water, trees and
// standing bodies, its mover sent to its goal, and played tick by tick. One loop serves a whole episode (the scoreboard's
// headline) and a label's replay (label.ts): the replay forces a candidate at one answer of the point, reseeds the
// mover's luck there when the movement code allows it, and reads the cost one second on, five, and at the end.

import { GOAL_WALK } from "../../server/behavior.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { Model } from "../../shared/decide/forward.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";
import { miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { READINGS } from "./dataset.ts";
import { ALONE, type Answer, type Replay, type Replayer } from "./label.ts";
import { bodyOf, type Scene } from "./random.ts";
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
  /** Bodies that stand, and when each is let go. */
  standers: { e: number; until: number; then?: { x: number; z: number } }[];
}

/** The nearest place to (x, z), out to 24 m, where a body of `r` and `h` stands free. */
function freeNear(b: Lab, x: number, z: number, r: number, h: number): { x: number; z: number } {
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

/** A scene on its own lab world, its mover making for its goal. */
export function build(s: Scene): Built {
  const w = lab(mapFor(s), s.seed);
  const reg = w.world.reg, wall = reg.index.get("core:wall_stone")!;
  for (const p of s.pieces) for (let y = 0; y < p.storeys; y++) w.world.structs.add(wall, p.x, w.world.hf.heightAt(p.x, p.z) + 1.5 + 3 * y, p.z, p.quarter * 16384, 0, 10000);
  const body = bodyOf(s.kind), mind = w.host.creatures.mind;
  const start = freeNear(w, s.start.x, s.start.z, body.radius, body.height);
  const goal = s.map === "miami" ? freeNear(w, s.goal.x, s.goal.z, body.radius, body.height) : s.goal;
  const standers: Built["standers"] = [];
  for (const st of s.standers) {
    const e = w.host.spawnCreature(st.kind, st.x, st.z, 1);
    if (e < 0) continue;
    mind.stay(e, st.until + s.horizon * 4);
    standers.push({ e, until: st.until, then: st.then });
  }
  const mover = w.host.spawnCreature(s.kind, start.x, start.z, 1);
  if (mover < 0) throw new Error(`${s.kind} could not be put down for ${s.family} ${s.seed}`);
  w.world.ents.yaw[mover] = mind.look[mover] = s.start.yaw;
  mind.stay(mover, s.horizon * 4);
  mind.goTo(mover, goal.x, goal.z, GOAL_WALK);
  return { scene: s, lab: w, mover, goal, body, arrive: Math.max(1.5, body.radius + 0.5), standers };
}

export interface Hooks {
  /** The point studied, and who decides it: "off" (today's code), "rule" or "model". */
  point: string;
  policy: "off" | "rule" | "model";
  models?: readonly Model[];
  /** Sees each answer of the point (`n` counts them from 0) while its tables are filled; returns a candidate to act on, or -1 for the chooser's. */
  answered?(n: number, tick: number, pick: number): number;
  /** Called before the tick in which answer `n` is due, so it may be left alone (ALONE). */
  ahead?(n: number): boolean;
  /** Stops the play once this holds. */
  stop?(tick: number): boolean;
  extra?: Installer;
}

/** What a play saw of its mover. */
export interface Trace {
  arrivedAt: number;
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

/** Plays a built scene under `hooks` until it arrives, the hooks stop it, or `limit` ticks pass. */
export function play(b: Built, hooks: Hooks, limit = b.scene.horizon): Trace {
  const w = b.lab, d = w.host.decide, mind = w.host.creatures.mind, ents = w.world.ents;
  for (const m of hooks.models ?? []) d.trained.set(m.profile, m);
  const point = install(b, hooks.point, hooks.extra);
  const policy = `${hooks.point}=${hooks.policy}`;
  d.set(policy);
  const trace: Trace = { arrivedAt: -1, ticks: 0, stuckTicks: 0, decideMicros: [], answers: 0 };
  d.force = (p, _e, pick) => (p === point.id && hooks.answered ? hooks.answered(trace.answers, w.world.tick, pick) : -1);
  d.tap = (p) => {
    if (p === point.id) trace.answers++;
  };
  // A lab world keeps no log, and the flush every five seconds would hold the whole world in a promise until the job ends.
  d.flush = () => Promise.resolve();
  const step = d.step.bind(d);
  let spent = 0;
  d.step = (tick) => {
    const from = performance.now();
    step(tick);
    spent = (performance.now() - from) * 1000;
  };
  let watching = false;
  for (let t = 0; t < limit; t++) {
    const tick = w.world.tick;
    if (Math.hypot(b.goal.x - ents.x[b.mover]!, b.goal.z - ents.z[b.mover]!) <= b.arrive) {
      trace.arrivedAt = t;
      break;
    }
    if (hooks.stop?.(tick)) break;
    for (const s of b.standers) if (s.then && tick === s.until) mind.goTo(s.e, s.then.x, s.then.z, GOAL_WALK);
    point.before(tick);
    const alone = hooks.ahead?.(trace.answers) ?? false;
    if (alone !== watching) {
      d.set(alone ? `${hooks.point}=watch` : policy);
      watching = alone;
    }
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
    arrived: t.arrivedAt >= 0, ticks: t.ticks, healthLost: Math.max(0, health0 - healthShare(b)), stuckTicks: t.stuckTicks,
    searches: mind.searches - searches0, cells: mind.searched - cells0, end: { x: b.lab.world.ents.x[b.mover]!, z: b.lab.world.ents.z[b.mover]! }, cost: costNow(b, tick0, health0, cells0, true), decideMicros: t.decideMicros,
  };
  b.lab.host.shutdown();
  return result;
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

/** The game's scenes for label.ts. */
export function gameReplayer(point: string, under: Under): Replayer<Scene> {
  return {
    survey(s) {
      const b = build(s), d = b.lab.host.decide, out: Answer[] = [];
      const waiting: { e: number; due: number; at: number }[] = [];
      let id = -1;
      play(b, {
        point, policy: under.policy, models: under.models, extra: under.extra,
        answered: (_n, tick, pick) => {
          id = d.points.findIndex((p) => p.name === point);
          const p = d.points[id]!;
          out.push({ tables: served(b, id), pick, hash: stateHash(b.lab.world), tick });
          if (p.horizon > 0 && p.outcome) waiting.push({ e: b.mover, due: tick + p.horizon, at: out.length - 1 });
          return -1;
        },
        stop: (tick) => {
          const o = new Float32Array(8);
          while (waiting.length && waiting[0]!.due <= tick) {
            const w = waiting.shift()!;
            if (d.points[id]!.outcome!(w.e, tick, o) > 0) out[w.at]!.outcome = o[0]!;
          }
          return false;
        },
      });
      b.lab.host.shutdown();
      return out;
    },
    replay(s, ordinal, force, seed) {
      const b = build(s), mind = b.lab.host.creatures.mind as unknown as { reseed?: (n: number) => void; searched: number };
      let hash = -1, from = -1, reseeded = false, health0 = 1, cells0 = 0;
      const costs: number[] = [];
      play(b, {
        point, policy: under.policy, models: under.models, extra: under.extra,
        ahead: (n) => force === ALONE && n === ordinal,
        answered: (n) => {
          if (n !== ordinal) return -1;
          hash = stateHash(b.lab.world);
          from = b.lab.world.tick;
          health0 = healthShare(b);
          cells0 = mind.searched;
          if (typeof mind.reseed === "function") {
            mind.reseed(seed);
            reseeded = true;
          }
          return force >= 0 ? force : -1;
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
      const r: Replay = { hash, costs, reseeded };
      return r;
    },
  };
}
