// The lab for nav.pick and nav.reach: seeded scenes of a mover with an objective (several choices) or a course (legs in
// an order), each with one fact that changes the right answer, played under today's code (the plain pick, a leg's fixed
// time) and under the rule, and an oracle that forces each answer in a replay of the same scene and reads the cost.
//
//   bun tools/decide/pick.ts [--families wayFar,noWay,...] [--scenes 20] [--first 1] [--ladder] [--out <file>] [--against <file>]
//
// prints a line a family and a creature, the headroom (how far the oracle's pick beats the rule's, as a share of the
// median cost), what one answer costs, and with `--against` an earlier run's file the scenes each policy gained and lost.
// `--ladder` puts the stuck ladder's points under the rule in both arms, so the arms differ only by the pick and reach.
//
// A cost is in seconds: the mean of the seconds to each choice the mover is to end at, weighed by 2 to its priority and
// by one and the pull of the pins it lies in, a choice not reached counting two horizons; and DANGER_PRICE seconds more
// for each second inside a pin that repels, by its pull; less the worth of each detour visited.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { LEG_LEAST } from "../../server/courses.ts";
import { LEAVE, SPARE } from "../../server/decide/decide.ts";
import { pullAt } from "../../server/decide/nav-pick.ts";
import type { Pin } from "../../server/pins.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { COURSE_ONCE, course, worthOf, type Choice, type Objective, type Waypoint } from "../../shared/world/course.ts";
import { ALONE, labelScene, type Answer, type Replayer } from "./label.ts";
import { FLAT_SIDE, MOVERS, bodyOf, type Piece, type Scene } from "./random.ts";
import { freeNear, mapFor } from "./setups.ts";
import { lab, stateHash, type Lab } from "./world.ts";

export const PICK_FAMILIES = ["wayFar", "noWay", "priority", "danger", "detour"] as const;
export const REACH_FAMILIES = ["reachOpen", "shutIn", "longRound", "island"] as const;
export type PickFamily = (typeof PICK_FAMILIES)[number] | (typeof REACH_FAMILIES)[number];

/** Guesses the owner may turn: what a second inside a repelling pin costs, and the least horizon of a scene, in seconds. */
export const DANGER_PRICE = 3;
export const LEAST_SECONDS = 150;
/** A scene's horizon is at least this many times its straight tour at the mover's pace. */
const TOUR_LINES = 4;
/** The team the movers are put in, so that the scene's pins are theirs. */
const TEAM = 77;
const PIECE = 3;

/** A pin of the mover's tribe: its kind (an index of WAYPOINT_KINDS) and radius. */
export interface ScenePin {
  x: number;
  z: number;
  kind: number;
  radius: number;
}

export interface PickScene {
  family: PickFamily;
  seed: number;
  kind: string;
  start: { x: number; z: number; yaw: number };
  /** An objective's choices, or a course's legs in order. */
  choices: Choice[];
  course: boolean;
  pins: ScenePin[];
  pieces: Piece[];
  water?: Scene["water"];
  horizon: number;
  /** The one fact, in words, for the report. */
  fact: string;
}

/** A scene laid out in its own frame (u across, v ahead of the mover), turned a whole quarter and set near the middle. */
class Frame {
  readonly pieces: Piece[] = [];
  readonly ox: number;
  readonly oz: number;
  readonly turn: number;
  constructor(ox: number, oz: number, turn: number) {
    this.ox = ox;
    this.oz = oz;
    this.turn = turn;
  }
  at(u: number, v: number): { x: number; z: number } {
    const [a, b] = [[u, v], [v, -u], [-u, -v], [-v, u]][this.turn]!;
    return { x: this.ox + a!, z: this.oz + b! };
  }
  /** Wall pieces from (u0, v) to (u1, v). */
  across(u0: number, u1: number, v: number): void {
    for (let u = u0 + PIECE / 2; u < u1; u += PIECE) this.piece(u, v, this.turn % 2 === 0 ? 0 : 1);
  }
  /** Wall pieces from (u, v0) to (u, v1). */
  along(u: number, v0: number, v1: number): void {
    for (let v = v0 + PIECE / 2; v < v1; v += PIECE) this.piece(u, v, this.turn % 2 === 0 ? 1 : 0);
  }
  /** A box of walls round (u, v), `half` metres each way. */
  box(u: number, v: number, half: number): void {
    this.across(u - half, u + half, v - half);
    this.across(u - half, u + half, v + half);
    this.along(u - half, v - half, v + half);
    this.along(u + half, v - half, v + half);
  }
  /** The corners (u0, v0) and (u1, v1) as a box of the world. */
  rect(u0: number, v0: number, u1: number, v1: number): { x0: number; z0: number; x1: number; z1: number } {
    const a = this.at(u0, v0), b = this.at(u1, v1);
    return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
  }
  private piece(u: number, v: number, quarter: 0 | 1): void {
    this.pieces.push({ ...this.at(u, v), quarter, storeys: 2 });
  }
}

function weighted(rng: Rng, list: readonly (readonly [string, number])[]): string {
  let r = rng.float() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1]![0];
}

const spot = (p: { x: number; z: number }, priority = 1, radius = 1.5): Waypoint => ({ ...p, radius, kind: 0, priority, pull: 0 });

/** A scene of `family` from `seed`. */
export function drawPick(family: PickFamily, seed: number): PickScene {
  const all = [...PICK_FAMILIES, ...REACH_FAMILIES] as readonly string[];
  const rng = new Rng((seed * 2654435761 + all.indexOf(family) * 131 + 7) >>> 0);
  const kind = weighted(rng, MOVERS), body = bodyOf(kind), r = body.radius;
  const f = new Frame(FLAT_SIDE / 2 + rng.range(-15, 15), FLAT_SIDE / 2 + rng.range(-15, 15), rng.int(4));
  const choices: Choice[] = [], pins: ScenePin[] = [];
  let water: Scene["water"], fact = "", isCourse = false;
  const end = (u: number, v: number, priority = 1) => choices.push({ place: spot(f.at(u, v), priority), detour: false });
  if (family === "wayFar") {
    // The nearer choice by line is behind something the way must go round; the other is in the open.
    const vA = rng.range(10, 18), uA = rng.range(-4, 4), how = (["U", "wall", "water"] as const)[seed % 3]!, H = rng.range(9, 16) + r;
    if (how === "U") {
      const D = rng.range(10, 20);
      f.across(uA - H, uA + H, vA - 4);
      f.along(uA - H, vA - 4, vA + D);
      f.along(uA + H, vA - 4, vA + D);
    } else if (how === "wall") f.across(uA - 2 * H, uA + 2 * H, vA - 4);
    else water = { ...f.rect(uA - 2 * H, vA - 4 - rng.range(4, 8), uA + 2 * H, vA - 3), depth: body.height * 1.3 };
    end(uA, vA);
    const a = rng.range(0.6, 1) * Math.PI * (rng.float() < 0.5 ? -1 : 1), d = vA + rng.range(5, 25);
    end(Math.sin(a) * d, Math.cos(a) * d);
    fact = `the nearer is behind a ${how}`;
  } else if (family === "noWay") {
    // The nearer choice is shut in a box no body gets into; the other is in the open.
    const vA = rng.range(10, 20), uA = rng.range(-5, 5);
    f.box(uA, vA, Math.max(4, 2 * r + 2) + rng.range(0, 3));
    end(uA, vA);
    const a = rng.range(0.5, 1) * Math.PI * (rng.float() < 0.5 ? -1 : 1), d = vA + rng.range(5, 25);
    end(Math.sin(a) * d, Math.cos(a) * d);
    fact = "the nearer is shut in";
  } else if (family === "priority") {
    // A higher priority far off against a lower one close by, at a ratio of lines drawn from a few.
    const near = rng.range(6, 14), ratio = [1.5, 3, 6, 10][seed % 4]!, hi = 3 + rng.int(3), lo = 1 + rng.int(2);
    const opposite = rng.float() < 0.5;
    end(rng.range(-3, 3), near, lo);
    const far = Math.min(90, near * ratio);
    if (opposite) end(rng.range(-3, 3), -far, hi);
    else end(far * (rng.float() < 0.5 ? -1 : 1), rng.range(-3, 3), hi);
    fact = `priority ${hi} at ${ratio} times the line of priority ${lo}, ${opposite ? "opposite" : "to a side"}`;
  } else if (family === "danger") {
    // Two alike; a pin that repels beside the nearer one (odd seeds), or one that draws over the farther (even seeds).
    const vN = rng.range(12, 22), dF = vN + rng.range(5, 20), a = rng.range(0.5, 1) * Math.PI * (rng.float() < 0.5 ? -1 : 1);
    end(rng.range(-3, 3), vN);
    end(Math.sin(a) * dF, Math.cos(a) * dF);
    const radius = rng.range(6, 10);
    if (seed % 2 === 1) {
      const n = choices[0]!.place, off = rng.range(2, 5), b = rng.float() * 2 * Math.PI;
      pins.push({ x: n.x + Math.sin(b) * off, z: n.z + Math.cos(b) * off, kind: 1, radius });
      fact = "a pin that repels beside the nearer";
    } else {
      const p = choices[1]!.place;
      pins.push({ x: p.x, z: p.z + 1, kind: 4, radius });
      fact = "a pin that draws over the farther";
    }
  } else if (family === "detour") {
    // A choice far ahead and a detour beside the way: just off it, far off it, or close but behind a wall.
    const vM = rng.range(40, 70), at = rng.range(0.3, 0.7) * vM, how = (["near", "far", "walled"] as const)[seed % 3]!;
    end(rng.range(-3, 3), vM);
    const side = rng.float() < 0.5 ? -1 : 1, off = how === "near" ? rng.range(6, 10) + r : how === "far" ? rng.range(25, 40) : rng.range(2, 3.5);
    if (how === "walled") f.along(side * (off - 1.2), at - 40, at + 40);
    choices.push({ place: spot(f.at(side * (off + (how === "walled" ? 1 : 0)), at), 1, 1), detour: true });
    fact = `a detour ${how === "walled" ? "beside the way behind a wall" : how === "near" ? "just off the way" : "far off the way"}`;
  } else {
    // A course: the leg studied, then one back near the start that can always be reached.
    isCourse = true;
    const back = () => choices.push({ place: spot(f.at(rng.range(-6, 6), -rng.range(5, 10))), detour: false });
    if (family === "reachOpen") {
      const v = rng.range(20, 50);
      if (rng.float() < 0.5) f.across(-rng.range(5, 15), rng.range(5, 15), v / 2);
      end(rng.range(-8, 8), v);
      fact = "a leg that can be walked";
    } else if (family === "shutIn") {
      const v = rng.range(15, 30);
      f.box(0, v, Math.max(4, 2 * r + 2) + rng.range(0, 3));
      end(0, v);
      fact = "a leg shut in";
    } else if (family === "longRound") {
      // A deep U open away from the mover, the leg inside its far end: the way is a long round, within the leg's time.
      const H = rng.range(8, 14) + r, D = rng.range(30, 60), v0 = rng.range(6, 10);
      f.across(-H, H, v0);
      f.along(-H, v0, v0 + D);
      f.along(H, v0, v0 + D);
      end(0, v0 + rng.range(3, 6));
      fact = `a leg inside a U ${Math.round(D)} m deep, open away`;
    } else {
      // Ringed by water deeper than the body stands in: a dry search finds no way, though it may swim.
      const v = rng.range(18, 30), inner = rng.range(4, 6), wide = rng.range(5, 9);
      const depth = body.height * 1.4;
      water = { ...f.rect(-inner - wide, v - inner - wide, inner + wide, v - inner), depth, more: [f.rect(-inner - wide, v + inner, inner + wide, v + inner + wide), f.rect(-inner - wide, v - inner, -inner, v + inner), f.rect(inner, v - inner, inner + wide, v + inner)] };
      end(0, v);
      fact = "a leg on an island";
    }
    back();
  }
  // Long enough to walk the tour three or four times over, and for a course to spend a leg's whole time.
  let tour = 0, px = f.at(0, 0).x, pz = f.at(0, 0).z;
  for (const c of choices) {
    tour += Math.hypot(c.place.x - px, c.place.z - pz);
    px = c.place.x;
    pz = c.place.z;
  }
  const seconds = Math.max(LEAST_SECONDS, (TOUR_LINES * tour) / body.pace) + (isCourse ? LEG_LEAST : 0);
  const start = f.at(0, 0), yaw = ((f.turn * 16384) + Math.round(rng.range(-0.2, 0.2) * 65536)) & 0xffff;
  const s: PickScene = { family, seed, kind, start: { ...start, yaw }, choices, course: isCourse, pins, pieces: f.pieces, horizon: Math.ceil(seconds) * TICK_RATE, fact };
  if (water) s.water = water;
  return s;
}

/** Who decides: today's code, or the rule for nav.pick and nav.reach; with `ladder`, its points under the rule in both. */
export type Arm = "today" | "rule";

function policyOf(arm: Arm, ladder: boolean): string {
  const nav = ladder ? "nav.snag=rule,nav.ring=rule,nav.sure=rule,nav.probe=rule,nav.do=rule," : "";
  return arm === "rule" ? `${nav}nav.pick=rule,nav.reach=rule` : nav;
}

/** What a play saw. Seconds are from the start; -1 for never. */
export interface Played {
  arrived: number[];
  failed: number[];
  /** Seconds at which the objective or course ran out, -1 where it had not by the horizon. */
  ended: number;
  /** Seconds inside a pin that repels, by its pull. */
  danger: number;
  cost: number;
  /** The choice made for first, and the first detour taken (-1 for none). */
  first: number;
  /** Per nav.pick and nav.reach answer, the microseconds it took; and the decider's row per tick. */
  pickMicros: number[];
  reachMicros: number[];
  /** Per tick with pricing to do, the microseconds Courses' row spent on it. */
  priceMicros: number[];
  decideMicros: number[];
  hash: number;
}

interface Built {
  w: Lab;
  e: number;
  s: PickScene;
  pins: Pin[];
}

function build(s: PickScene): Built {
  const w = lab(mapFor({ map: "flat", family: s.family, seed: s.seed, ...(s.water ? { water: s.water } : {}) } as unknown as Scene), s.seed);
  const reg = w.world.reg, wall = reg.index.get("core:wall_stone")!, body = bodyOf(s.kind);
  for (const p of s.pieces) for (let y = 0; y < p.storeys; y++) w.world.structs.add(wall, p.x, w.world.hf.heightAt(p.x, p.z) + 1.5 + 3 * y, p.z, p.quarter * 16384, 0, 10000);
  const at = freeNear(w, s.start.x, s.start.z, body.radius, body.height);
  const e = w.host.spawnCreature(s.kind, at.x, at.z, 1);
  if (e < 0) throw new Error(`no room for ${s.kind} in ${s.family} ${s.seed}`);
  w.world.ents.team[e] = TEAM;
  w.world.ents.yaw[e] = w.host.creatures.mind.look[e] = s.start.yaw;
  const pins: Pin[] = [];
  for (const p of s.pins) {
    const pin = w.host.pins.place(TEAM, 1, p.x, p.z, p.kind, true, "");
    pin.radius = p.radius;
    pins.push(pin);
  }
  return { w, e, s, pins };
}

/** How the oracle steps in: force the `ordinal`th nav.pick answer to `pick`, or give the first leg up at once or never. */
export interface Force {
  pick?: { ordinal: number; pick: number; seed: number };
  firstLeg?: "now" | "never";
}

/** Plays a scene under `arm`; with `force`, the oracle's hand. `seen` hears each nav.pick answer while its table is filled. */
export function playPick(s: PickScene, arm: Arm, ladder = false, force: Force = {}, seen?: (b: Built, n: number, tick: number, pick: number) => void): Played {
  const b = build(s), { w, e } = b, d = w.host.decide, courses = w.host.courses, mind = w.host.creatures.mind;
  d.set(policyOf(arm, ladder));
  const pickId = d.points.findIndex((p) => p.name === "nav.pick"), reachId = d.points.findIndex((p) => p.name === "nav.reach");
  const out: Played = { arrived: s.choices.map(() => -1), failed: s.choices.map(() => -1), ended: -1, danger: 0, cost: 0, first: -1, pickMicros: [], reachMicros: [], priceMicros: [], decideMicros: [], hash: 0 };
  const t0 = w.world.tick, sec = () => (w.world.tick - t0) / TICK_RATE;
  let answers = 0;
  d.force = (p, who, pick) => {
    if (p !== pickId || who !== e) return LEAVE;
    const n = answers++;
    seen?.(b, n, w.world.tick, pick);
    if (force.pick && n === force.pick.ordinal) {
      out.hash = stateHash(w.world);
      mind.reseed(force.pick.seed);
      return force.pick.pick === ALONE ? SPARE : force.pick.pick;
    }
    return LEAVE;
  };
  for (const [id, into] of [[pickId, out.pickMicros], [reachId, out.reachMicros]] as const) {
    const point = d.points[id]!, answer = point.answer.bind(point);
    (point as { answer: typeof answer }).answer = (...a) => {
      const from = performance.now(), v = answer(...a);
      into.push((performance.now() - from) * 1000);
      return v;
    };
  }
  const picker = w.host.courses.pick as { step?: (tick: number) => void } | null;
  if (picker?.step) {
    const own = picker.step.bind(picker);
    picker.step = (tick) => {
      const from = performance.now();
      own(tick);
      const us = (performance.now() - from) * 1000;
      if (us > 0.5) out.priceMicros.push(us);
    };
  }
  const step = d.step.bind(d);
  d.step = (tick) => {
    const from = performance.now();
    step(tick);
    out.decideMicros.push((performance.now() - from) * 1000);
  };
  if (force.firstLeg) {
    const own = courses.reach;
    courses.reach = (who) => (who === e && courses.of(e)?.at === 0 ? (force.firstLeg === "now" ? 0 : -1) : own ? own(who) : -1);
  }
  let ended = false;
  const owner = {
    arrived: (_e: number, at: number) => void (out.arrived[at] = sec()),
    failed: (_e: number, at: number) => void (out.failed[at] = sec()),
    ended: () => void (ended = true),
  };
  if (s.course) courses.give(e, course(s.choices.map((c) => c.place), COURSE_ONCE), owner);
  else courses.aim(e, { choices: s.choices } as Objective, owner);
  const ents = w.world.ents;
  for (let t = 0; t < s.horizon && !ended; t++) {
    w.tick();
    if (t === 0) out.first = s.course ? 0 : courses.making(e);
    for (const p of b.pins) if (p.pull < 0 && Math.hypot(ents.x[e]! - p.x, ents.z[e]! - p.z) <= p.radius) out.danger -= p.pull / TICK_RATE;
  }
  out.ended = ended ? sec() : -1;
  out.cost = costOf(s, b.pins, out);
  w.host.shutdown();
  return out;
}

/** The cost of a play, in seconds (the file's head says how it is made). */
export function costOf(s: PickScene, pins: readonly Pin[], p: Played): number {
  const miss = (2 * s.horizon) / TICK_RATE;
  let sum = 0, weight = 0, worth = 0;
  s.choices.forEach((c, i) => {
    if (c.detour) {
      if (p.arrived[i]! >= 0) worth += worthOf(c);
      return;
    }
    const w = 2 ** c.place.priority * (1 + Math.max(0, pullAt(pins, c.place)));
    sum += w * (p.arrived[i]! >= 0 ? p.arrived[i]! : miss);
    weight += w;
  });
  return sum / weight + DANGER_PRICE * p.danger - worth;
}

/** The replayer label.ts drives: nav.pick's answers of a scene under the rule, and one forced in a replay. */
export function pickReplayer(ladder: boolean): Replayer<PickScene> {
  return {
    survey(s) {
      const got: Answer[] = [];
      playPick(s, "rule", ladder, {}, (b, _n, tick, pick) => {
        const t = b.w.host.decide.points.find((p) => p.name === "nav.pick")!.tables[0]!.table;
        got.push({ tables: [{ profile: "nav.pick", k: t.k, state: t.state.slice(), rows: t.rows.slice(0, t.k * t.width), bias: t.bias.slice(0, t.k), mask: t.mask.slice(0, t.k) }], pick, hash: stateHash(b.w.world), tick });
      });
      return got;
    },
    replay(s, ordinal, pick, seed) {
      const p = playPick(s, "rule", ladder, { pick: { ordinal, pick, seed } });
      return p.hash === 0 ? null : { hash: p.hash, costs: [p.cost, p.cost, p.cost], reseeded: true };
    },
  };
}

/** One scene as the report keeps it. */
export interface PickSeen {
  family: string;
  seed: number;
  kind: string;
  fact: string;
  course: boolean;
  /** Per choice, 1 for a detour, which is never an end. */
  detours: number[];
  today: Played;
  rule: Played;
  /** The oracle: the cost of each candidate forced at the first answer, or of the first leg given up at once and never. */
  forced: number[];
  /** The candidate the rule picked at the first answer, -1 for a course. */
  rulePick: number;
}

/** One scene played by both arms and by the oracle. */
export function seePick(s: PickScene, ladder = false): PickSeen {
  const today = playPick(s, "today", ladder), rule = playPick(s, "rule", ladder);
  let forced: number[] = [], rulePick = -1;
  if (s.course) forced = [playPick(s, "rule", ladder, { firstLeg: "now" }).cost, playPick(s, "rule", ladder, { firstLeg: "never" }).cost];
  else {
    const l = labelScene(pickReplayer(ladder), s, { seed: s.seed, family: s.family, map: "flat" }, { kind: "choice", seeds: 1, ordinal: 0 });
    if (l.decision) {
      const k = l.decision.tables[0]!.k, R = l.decision.readings;
      forced = Array.from({ length: k }, (_, c) => l.decision!.costs[c * R + R - 1]!);
      rulePick = l.decision.pick;
    }
  }
  const slim = (p: Played): Played => ({ ...p, decideMicros: [] });
  return { family: s.family, seed: s.seed, kind: s.kind, fact: s.fact, course: s.course, detours: s.choices.map((c) => (c.detour ? 1 : 0)), today: slim(today), rule: slim(rule), forced, rulePick };
}

/** How many of a scene's ends `p` reached. */
export function endsOf(s: PickSeen, p: Played): number {
  return p.arrived.reduce((n, t, i) => n + (t >= 0 && s.detours[i] === 0 ? 1 : 0), 0);
}

/** The ends today reached that the rule did not, and the reverse. */
export function swaps(s: PickSeen): { lost: number; gained: number } {
  let lost = 0, gained = 0;
  s.today.arrived.forEach((t, i) => {
    if (s.detours[i] !== 0) return;
    const r = s.rule.arrived[i]!;
    if (t >= 0 && r < 0) lost++;
    if (t < 0 && r >= 0) gained++;
  });
  return { lost, gained };
}

/** A course's first leg given up before its fixed time, by `p`: rightly where today did not reach it either. */
export function earlyGiveUp(s: PickSeen, p: Played): "right" | "wrong" | null {
  const at = p.failed[0]!;
  if (!s.course || at < 0 || at >= LEG_LEAST) return null;
  return s.today.arrived[0]! >= 0 ? "wrong" : "right";
}

const median = (v: readonly number[]): number => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1]! : NaN);
const pct = (v: readonly number[], q: number): number => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))]! : NaN);
const mean = (v: readonly number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "-");

/** The oracle's best of a scene, and the rule's own cost as the oracle played it. */
export function headroomOf(s: PickSeen): { best: number; rule: number } | null {
  const ok = s.forced.filter((c) => Number.isFinite(c));
  if (!ok.length) return null;
  const rule = s.course ? s.rule.cost : Number.isFinite(s.forced[s.rulePick] ?? NaN) ? s.forced[s.rulePick]! : s.rule.cost;
  return { best: Math.min(...ok, rule), rule };
}

/** A line for a group of scenes: ends reached and mean cost under each arm, swaps, early give-ups, and the headroom. */
export function groupLine(name: string, list: readonly PickSeen[]): string {
  const ends = list.reduce((n, s) => n + s.detours.filter((d) => d === 0).length, 0);
  const got = (arm: "today" | "rule") => list.reduce((n, s) => n + endsOf(s, s[arm]), 0);
  const cost = (arm: "today" | "rule") => mean(list.map((s) => s[arm].cost));
  const done = (arm: "today" | "rule") => mean(list.filter((s) => s[arm].ended >= 0).map((s) => s[arm].ended));
  let lost = 0, gained = 0, worse = 0, better = 0;
  for (const s of list) {
    const w = swaps(s);
    lost += w.lost;
    gained += w.gained;
    if (s.rule.cost > s.today.cost + 0.5) worse++;
    if (s.rule.cost < s.today.cost - 0.5) better++;
  }
  const early = list.map((s) => earlyGiveUp(s, s.rule)).filter((g) => g !== null);
  const rooms = list.map(headroomOf).filter((h) => h !== null);
  const room = rooms.length ? mean(rooms.map((h) => h.rule - h.best)) / median(rooms.map((h) => h.rule)) : NaN;
  const give = list.some((s) => s.course) ? `; legs given up early ${early.filter((g) => g === "right").length} rightly, ${early.filter((g) => g === "wrong").length} wrongly` : "";
  return `${name}: ${list.length} scenes, ${ends} ends; today reaches ${got("today")} at ${f1(cost("today"))} s a scene (done in ${f1(done("today"))} s), the rule ${got("rule")} at ${f1(cost("rule"))} s (done in ${f1(done("rule"))} s); ends gained ${gained}, lost ${lost}; cheaper in ${better}, dearer in ${worse}${give}; headroom ${Number.isFinite(room) ? (100 * room).toFixed(1) + "%" : "-"}`;
}

/** Scenes played in both runs where `arm` now reaches more ends (gained) or fewer (lost). */
export function againstPick(was: readonly PickSeen[], now: readonly PickSeen[], arm: "today" | "rule"): { gained: PickSeen[]; lost: PickSeen[] } {
  const before = new Map(was.map((s) => [`${s.family}/${s.seed}`, s]));
  const gained: PickSeen[] = [], lost: PickSeen[] = [];
  for (const s of now) {
    const b = before.get(`${s.family}/${s.seed}`);
    if (!b || b.kind !== s.kind) continue;
    const a0 = endsOf(b, b[arm]), a1 = endsOf(s, s[arm]);
    if (a1 > a0) gained.push(s);
    if (a1 < a0) lost.push(s);
  }
  return { gained, lost };
}

/** Every line of a report on `all`, and against `was` where given. */
export function report(all: readonly PickSeen[], was?: readonly PickSeen[]): string[] {
  const out: string[] = [];
  for (const family of [...new Set(all.map((s) => s.family))]) {
    const of = all.filter((s) => s.family === family);
    out.push(groupLine(family, of));
    for (const kind of [...new Set(of.map((s) => s.kind))].sort()) out.push("  " + groupLine(kind.replace("core:", ""), of.filter((s) => s.kind === kind)));
  }
  for (const [name, list] of [["objectives", all.filter((s) => !s.course)], ["courses", all.filter((s) => s.course)], ["all", all]] as const) if (list.length) out.push(groupLine(name, list));
  for (const s of all) {
    const w = swaps(s);
    if (w.lost > 0) out.push(`  - ${s.family} ${s.seed} ${s.kind}: the rule lost ${w.lost} end(s) today reached (${s.fact})`);
    if (w.gained > 0) out.push(`  + ${s.family} ${s.seed} ${s.kind}: the rule gained ${w.gained} end(s) (${s.fact})`);
    if (earlyGiveUp(s, s.rule) === "wrong") out.push(`  ! ${s.family} ${s.seed} ${s.kind}: the rule gave up at ${f1(s.rule.failed[0]!)} s a leg today reached at ${f1(s.today.arrived[0]!)} s`);
  }
  const picks = all.flatMap((s) => s.rule.pickMicros), reaches = all.flatMap((s) => s.rule.reachMicros);
  const minutes = all.reduce((n, s) => n + Math.max(1, s.rule.ended >= 0 ? s.rule.ended : (s.rule.arrived.length ? Math.max(...s.rule.arrived) : 0)), 0) / 60;
  out.push(`one nav.pick answer: median ${f1(median(picks))} µs, 99th percentile ${f1(pct(picks, 0.99))}, most ${f1(Math.max(...picks, 0))}; ${picks.length} answers, ${f1(picks.length / minutes)} a mover-minute`);
  const prices = all.flatMap((s) => s.rule.priceMicros);
  out.push(`pricing in Courses' row, a tick with any to do: median ${f1(median(prices))} µs, 99th percentile ${f1(pct(prices, 0.99))}, most ${f1(Math.max(...prices, 0))}; ${prices.length} such ticks, ${f1(prices.length / minutes)} a mover-minute`);
  out.push(`one nav.reach answer: median ${f1(median(reaches))} µs, 99th percentile ${f1(pct(reaches, 0.99))}; ${f1(reaches.length / minutes)} a mover-minute`);
  if (was) for (const arm of ["rule", "today"] as const) {
    const { gained, lost } = againstPick(was, all, arm);
    out.push(`against the earlier run, ${arm === "rule" ? "the rule" : "today"}: gained ${gained.length}, lost ${lost.length}`);
    for (const s of gained) out.push(`  + ${s.family} ${s.seed} ${s.kind}`);
    for (const s of lost) out.push(`  - ${s.family} ${s.seed} ${s.kind}`);
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const families = (arg("--families")?.split(",") ?? [...PICK_FAMILIES, ...REACH_FAMILIES]) as PickFamily[];
  const n = Number(arg("--scenes") ?? 20), first = Number(arg("--first") ?? 1), ladder = process.argv.includes("--ladder");
  const all: PickSeen[] = [];
  for (const family of families) {
    const seen = Array.from({ length: n }, (_, i) => seePick(drawPick(family, first + i), ladder));
    all.push(...seen);
    console.log(groupLine(family, seen));
  }
  const file = arg("--out") ?? ".cache/decide/pick.json";
  mkdirSync(".cache/decide", { recursive: true });
  writeFileSync(file, JSON.stringify(all));
  const was = arg("--against");
  console.log("");
  for (const line of report(all, was ? (JSON.parse(readFileSync(was, "utf8")) as PickSeen[]) : undefined)) console.log(line);
}
