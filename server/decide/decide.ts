// The decider's place in the tick. Movement code puts a question (`put`: which point, which mover, how deep in trouble) and
// goes on as it does today. This row, right after the creatures have stepped, answers the tick's questions in one fixed
// order: movers a player is close to before those in the background, and among each the deepest in trouble first. It
// stops at a cap for each cost and when the lane has no room. The background holds no share of its own, so it is what
// gives way. A question that is cut keeps today's behaviour and is counted. Nothing waits and nothing outlives its tick.
//
// Who decides a point is a setting (DecidePolicy): off (today's code, and `put` returns at once), watch (answered and
// logged, never applied), rule (the hand weights of shared/decide/rules.ts) or model (trained weights from ./weights).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TICK_RATE } from "../../shared/coords.ts";
import { scoreTable, type Model } from "../../shared/decide/forward.ts";
import type { Profile } from "../../shared/decide/profile.ts";
import { PROFILES } from "../../shared/decide/profiles.ts";
import { RULES } from "../../shared/decide/rules.ts";
import type { Table } from "../../shared/decide/table.ts";
import { readModel } from "../../shared/decide/weights.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import type { Lane } from "../lane.ts";
import type { LineLog } from "./log.ts";

export const OFF = 0, WATCH = 1, RULE = 2, MODEL = 3;
export const POLICIES = ["off", "watch", "rule", "model"] as const;

/** What a question costs to answer: a yes or no from numbers already held, a few probes, or a full ring of them. */
export const COST_YES = 0, COST_PROBE = 1, COST_RING = 2;
/**
 * Questions of each cost answered in one tick, at most. Guesses, to be set by the bench (tools/bench/decide.ts). A full
 * ring of 12 headings measured 66 µs in a dense wood and 125 at its 99th percentile, so four keep a tick's worst near
 * half a millisecond.
 */
export const CAPS: readonly number[] = [64, 32, 4];
/**
 * Questions one tick may hold for movers a player is close to, and for those in the background; more are cut and counted.
 * They are held apart, so however much the background asks it never takes the place of a mover a player is beside.
 */
export const QUEUE = 512;
export const QUEUE_BACK = 256;
/** Rungs of trouble: calm, wary, stuck, a patient escape. */
export const RUNGS = 4;
/** Logged answers of one point that may wait for their outcome. */
const WAITING = 1024;
/** Answers kept for a page that looks. */
const RECENT = 64;
const TUNE_TICKS = 5 * TICK_RATE;

/** Scores table `t` of profile `p` by whoever decides the point being answered, and returns that scorer's temperature. */
export type Ask = (p: Profile, t: Table) => number;

export interface Point {
  readonly name: string;
  /** COST_YES, COST_PROBE or COST_RING. */
  readonly cost: number;
  /** Ticks after a logged answer at which `outcome` is read; 0 for never. */
  readonly horizon: number;
  /** The tables its last answer filled, for the log. */
  readonly tables: readonly { profile: Profile; table: Table }[];
  /** Whether mover `e` is still in the state that put the question. */
  still(e: number, rung: number): boolean;
  /**
   * Fills its tables for `e`, has `ask` score them, and returns the candidate chosen, or -1 where it has nothing to ask.
   * It may be called twice in a tick for one mover (the log compares the rule with a trained scorer), so it changes
   * nothing a second call would read differently.
   */
  answer(e: number, tick: number, rung: number, ask: Ask): number;
  /** Acts on the candidate chosen. */
  apply(e: number, tick: number, rung: number, pick: number): void;
  /** Writes a few numbers of what became of `e` since its answer to `out`, and returns how many. */
  outcome?(e: number, tick: number, out: Float32Array): number;
}

export interface Counts {
  put: number;
  /** Not answered: over the cap, the lane had no room, or the tick held too many questions. */
  cut: number;
  /** Of those put and of those cut, the ones for movers in the background. */
  backPut: number;
  backCut: number;
  /** The mover was gone or no longer in the state that asked, or the point was turned off since. */
  stale: number;
  /** The point had nothing to ask. */
  none: number;
  answered: number;
  applied: number;
  /** Answered by the rule where a trained scorer was asked for and none is loaded. */
  fell: number;
  logged: number;
  closed: number;
}

export interface DecideReport {
  points: { name: string; policy: string; counts: Counts }[];
  caps: readonly number[];
  /** Questions cut because a tick held more than QUEUE or QUEUE_BACK, and the most one tick held of each. */
  overflow: number;
  most: number;
  backMost: number;
  /** Trained scorers loaded by profile, and files refused with why. */
  trained: string[];
  refused: string[];
  log: { written: number; bytes: number; dropped: number } | null;
}

export interface DecideSettings {
  /** `point=policy` pairs, a comma or a space between; `*` is every point not named. */
  policy: string;
  /** One answer in this many is logged; 0 logs none. */
  sample: number;
  megabytes: number;
}

/** What the decider reads of the world: each mover's generation and whether it lives, and where it is if the log is to say (the entity store's columns). */
export interface Movers {
  gen: ArrayLike<number>;
  flags: ArrayLike<number>;
  x?: ArrayLike<number>;
  z?: ArrayLike<number>;
}

/** One answer as the log and an admin's page hold it: the question's tables as they were filled, and the candidate chosen. */
export interface Answered {
  /** Its line in the log, by which its outcome follows; 0 where it was only looked at. */
  id: number;
  t: number;
  point: string;
  rung: number;
  policy: string;
  pick: number;
  /** What the other chooser (the rule, or the trained scorer) would have picked, where both were asked. */
  other?: number;
  x?: number;
  z?: number;
  tables: { profile: string; k: number; state: number[]; rows: number[]; score: number[]; bias: number[]; mask: number[]; out: number[] }[];
}

export interface DecideCtx {
  world: { ents: Movers };
  lane: Lane;
  /** Read every five seconds. Without it every point stays as `set` left it. */
  settings?: () => DecideSettings;
  log?: LineLog | null;
  /** Where trained weights are read from at the start; null reads none. The folder beside this file where not given. */
  weights?: string | null;
  say?: (line: string) => void;
}

const zero = (): Counts => ({ put: 0, cut: 0, backPut: 0, backCut: 0, stale: 0, none: 0, answered: 0, applied: 0, fell: 0, logged: 0, closed: 0 });
const round = (v: number): number => Math.round(v * 1e4) / 1e4;
const list = (a: ArrayLike<number>, n: number): number[] => Array.from({ length: n }, (_, i) => round(a[i]!));

/** A tick's questions of one kind, up close or background, in the order they were put. */
class Asked {
  n = 0;
  most = 0;
  readonly point: Uint8Array;
  readonly ent: Int32Array;
  readonly gen: Int32Array;
  readonly rung: Uint8Array;
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.point = new Uint8Array(size);
    this.ent = new Int32Array(size);
    this.gen = new Int32Array(size);
    this.rung = new Uint8Array(size);
  }
}

/** Logged answers of one point waiting for their horizon, oldest first: every one waits the same time, so a ring is in order. */
class Waiting {
  readonly due = new Int32Array(WAITING);
  readonly ent = new Int32Array(WAITING);
  readonly gen = new Int32Array(WAITING);
  readonly id = new Int32Array(WAITING);
  head = 0;
  count = 0;
}

export class Decide {
  readonly points: Point[] = [];
  readonly counts: Counts[] = [];
  /** The hand rule and the trained scorer for each profile, by its name. */
  readonly rules = new Map<string, Model>();
  readonly trained = new Map<string, Model>();
  /** What each trained scorer's file says of itself (its lab scores), by profile, for a page. */
  readonly abouts = new Map<string, Record<string, unknown>>();
  readonly refused: string[] = [];
  /** Other logs flushed with this one's, so no log of the server's writes inside a tick (Cast's). */
  readonly sinks: LineLog[] = [];
  overflow = 0;
  /**
   * The lab's two hooks (tools/decide), never set in a game. `force` may name the candidate to act on in place of the one
   * chosen (-1 leaves it). `tap` sees every answer while its tables are still filled.
   */
  force: ((point: number, e: number, pick: number) => number) | null = null;
  tap: ((point: number, e: number, tick: number, rung: number, pick: number) => void) | null = null;
  /** What a point knows of mover `e` now (its rung, the heading it holds), for a page or the debug bar; null where nothing does. */
  describe: ((e: number) => Record<string, unknown> | null) | null = null;
  /** The last answers, newest last, kept only while someone looks (`look`): an admin's page shows what a mover saw. */
  readonly recent: Answered[] = [];
  private lookUntil = -1;
  private weightsDir: string | null = null;
  private readonly ctx: DecideCtx;
  private readonly policyOf = new Uint8Array(256);
  private readonly waiting: Waiting[] = [];
  private fallback = OFF;
  private policyText = "";
  private settingText = "";
  private sample = 0;
  private seen = 0;
  private nextId = 1;
  private readonly front = new Asked(QUEUE);
  private readonly back = new Asked(QUEUE_BACK);
  private readonly spent = new Int32Array(3);
  private room = true;
  private readonly outcome = new Float32Array(8);
  private asking = 0;
  private readonly askRule: Ask = (p, t) => {
    scoreTable(this.ruleFor(p), p, t);
    return 1;
  };
  private readonly askModel: Ask = (p, t) => {
    const m = this.trained.get(p.name);
    if (!m) {
      this.counts[this.asking]!.fell++;
      return this.askRule(p, t);
    }
    scoreTable(m, p, t);
    return m.temperature;
  };

  constructor(ctx: DecideCtx) {
    this.ctx = ctx;
    for (const m of RULES) this.rules.set(m.profile, m);
    this.weightsDir = ctx.weights === undefined ? join(import.meta.dir, "weights") : ctx.weights;
    this.reload();
  }

  /** Adds a point and returns the number `put` names it by. */
  add(point: Point): number {
    if (this.points.length >= this.policyOf.length) throw new Error("too many decision points");
    if (this.points.some((p) => p.name === point.name)) throw new Error(`decision point ${point.name} is added twice`);
    const id = this.points.length;
    this.points.push(point);
    this.counts.push(zero());
    this.waiting.push(new Waiting());
    this.set(this.policyText);
    return id;
  }

  /** Whether anything decides `point` but today's code: a hook that must do work before it can put a question asks this first. */
  on(point: number): boolean {
    return this.policyOf[point] !== OFF;
  }

  /** Whether `point`'s answers are acted on (the rule or a trained scorer decides it), not only watched. */
  acts(point: number): boolean {
    return this.policyOf[point]! >= RULE;
  }

  /**
   * Puts a question for this tick: mover `e` at `point`, `rung` deep in trouble. `back` says no player is close to it: it
   * is answered only with what the movers players are close to leave. Does nothing while the point is off.
   */
  put(point: number, e: number, rung: number, back = false): void {
    if (this.policyOf[point] === OFF) return;
    const c = this.counts[point]!, q = back ? this.back : this.front;
    c.put++;
    if (back) c.backPut++;
    if (q.n >= q.size) {
      this.overflow++;
      c.cut++;
      if (back) c.backCut++;
      return;
    }
    const i = q.n++;
    q.point[i] = point;
    q.ent[i] = e;
    q.gen[i] = this.ctx.world.ents.gen[e]!;
    q.rung[i] = rung < RUNGS ? rung : RUNGS - 1;
  }

  /** Sets who decides each point from `point=policy` pairs; a point not named takes `*`'s, or is off. */
  set(text: string): void {
    this.policyText = text;
    this.fallback = OFF;
    const named = new Map<string, number>();
    for (const pair of text.split(/[,\s]+/)) {
      const [name, value] = pair.split("=");
      const policy = POLICIES.indexOf((value ?? "").toLowerCase() as (typeof POLICIES)[number]);
      if (!name || policy < 0) continue;
      if (name === "*") this.fallback = policy;
      else named.set(name, policy);
    }
    for (let i = 0; i < this.points.length; i++) this.policyOf[i] = named.get(this.points[i]!.name) ?? this.fallback;
  }

  step(tick: number): void {
    if (tick % TUNE_TICKS === 0) this.tune();
    const { front, back } = this;
    if (front.n > front.most) front.most = front.n;
    if (back.n > back.most) back.most = back.n;
    if (front.n > 0 || back.n > 0) {
      this.spent.fill(0);
      this.room = true;
      this.answerAll(front, tick, 0);
      this.answerAll(back, tick, 1);
    }
    front.n = back.n = 0;
    // Nobody looks any more: what was kept for a page is let go.
    if (this.recent.length > 0 && tick >= this.lookUntil) this.recent.length = 0;
    for (let p = 0; p < this.points.length; p++) if (this.waiting[p]!.count > 0) this.close(p, tick);
  }

  report(): DecideReport {
    const log = this.ctx.log;
    return {
      points: this.points.map((p, i) => ({ name: p.name, policy: POLICIES[this.policyOf[i]!]!, counts: { ...this.counts[i]! } })),
      caps: CAPS,
      overflow: this.overflow,
      most: this.front.most,
      backMost: this.back.most,
      trained: [...this.trained.keys()],
      refused: [...this.refused],
      log: log ? { written: log.written, bytes: log.bytes, dropped: log.dropped } : null,
    };
  }

  /** Reads the trained weights again, so a scorer the lab has just written decides without a restart. */
  reload(): void {
    this.trained.clear();
    this.abouts.clear();
    this.refused.length = 0;
    if (this.weightsDir !== null) this.load(this.weightsDir);
  }

  /** Keeps the answers of the next `ticks` in `recent`. */
  look(tick: number, ticks: number): void {
    this.lookUntil = tick + ticks;
  }

  /** Writes what the logs hold; a server's shutdown and a test await it. */
  async flush(): Promise<void> {
    await this.ctx.log?.flush();
    for (const s of this.sinks) await s.flush();
  }

  private tune(): void {
    const s = this.ctx.settings?.();
    if (s) {
      // Only a change of the setting itself: a policy set by hand (a test, a tool) stands until the setting is next edited.
      if (s.policy !== this.settingText) {
        this.settingText = s.policy;
        this.set(s.policy);
      }
      this.sample = s.sample;
      if (this.ctx.log) this.ctx.log.cap = s.megabytes * 1024 * 1024;
    }
    void this.flush();
  }

  private answerAll(q: Asked, tick: number, back: number): void {
    const { world, lane } = this.ctx;
    for (let rung = RUNGS - 1; rung >= 0; rung--) {
      for (let i = 0; i < q.n; i++) {
        if (q.rung[i] !== rung) continue;
        const id = q.point[i]!, point = this.points[id]!, c = this.counts[id]!;
        // Turned off since it was put: today's code has already gone on, and nothing is done to the mover.
        if (this.policyOf[id] === OFF) {
          c.stale++;
          continue;
        }
        if (!this.room || this.spent[point.cost]! >= CAPS[point.cost]! || !(this.room = lane.may())) {
          c.cut++;
          c.backCut += back;
          continue;
        }
        const e = q.ent[i]!;
        if (world.ents.gen[e] !== q.gen[i] || (world.ents.flags[e]! & F_ALIVE) === 0 || !point.still(e, rung)) {
          c.stale++;
          continue;
        }
        this.spent[point.cost]!++;
        this.one(id, point, c, e, tick, rung);
      }
    }
  }

  private one(id: number, point: Point, c: Counts, e: number, tick: number, rung: number): void {
    const policy = this.policyOf[id]!;
    const mine = policy === MODEL ? this.askModel : this.askRule;
    const log = this.ctx.log;
    const sampled = log != null && this.sample > 0 && ++this.seen % this.sample === 0;
    this.asking = id;
    // The other chooser first, so the tables left for the log are those of the answer that counts.
    const other = sampled && this.trained.size > 0 ? point.answer(e, tick, rung, mine === this.askModel ? this.askRule : this.askModel) : -2;
    let pick = point.answer(e, tick, rung, mine);
    if (pick < 0) {
      c.none++;
      return;
    }
    c.answered++;
    if (this.force) {
      const forced = this.force(id, e, pick);
      if (forced >= 0) pick = forced;
    }
    this.tap?.(id, e, tick, rung, pick);
    const looked = tick < this.lookUntil;
    if (sampled || looked) {
      const ents = this.ctx.world.ents;
      const row: Answered = {
        id: sampled ? this.nextId++ : 0, t: tick, point: point.name, rung, policy: POLICIES[policy]!, pick,
        ...(other > -2 ? { other } : {}),
        ...(ents.x && ents.z ? { x: Math.round(ents.x[e]! * 10) / 10, z: Math.round(ents.z[e]! * 10) / 10 } : {}),
        tables: point.tables.map(({ profile, table: t }) => ({
          profile: profile.name, k: t.k, state: list(t.state, t.stateWidth), rows: list(t.rows, t.k * t.width),
          score: list(t.score, t.k), bias: list(t.bias, t.k), mask: Array.from(t.mask.subarray(0, t.k)), out: list(t.out, t.k),
        })),
      };
      if (looked) {
        this.recent.push(row);
        if (this.recent.length > RECENT) this.recent.shift();
      }
      if (sampled) {
        log.add(JSON.stringify(row));
        c.logged++;
        if (point.horizon > 0 && point.outcome) this.wait(id, e, tick + point.horizon, row.id);
      }
    }
    if (policy !== WATCH) {
      point.apply(e, tick, rung, pick);
      c.applied++;
    }
  }

  private wait(point: number, e: number, due: number, line: number): void {
    const w = this.waiting[point]!;
    if (w.count >= WAITING) return;
    const at = (w.head + w.count++) % WAITING;
    w.due[at] = due;
    w.ent[at] = e;
    w.gen[at] = this.ctx.world.ents.gen[e]!;
    w.id[at] = line;
  }

  private close(p: number, tick: number): void {
    const w = this.waiting[p]!, point = this.points[p]!, ents = this.ctx.world.ents;
    while (w.count > 0 && w.due[w.head]! <= tick) {
      const e = w.ent[w.head]!, line = w.id[w.head]!;
      const here = ents.gen[e] === w.gen[w.head] && (ents.flags[e]! & F_ALIVE) !== 0;
      const n = here ? point.outcome!(e, tick, this.outcome) : 0;
      this.ctx.log?.add(JSON.stringify(here ? { id: line, t: tick, outcome: list(this.outcome, n) } : { id: line, t: tick, gone: true }));
      this.counts[p]!.closed++;
      w.head = (w.head + 1) % WAITING;
      w.count--;
    }
  }

  private ruleFor(p: Profile): Model {
    const m = this.rules.get(p.name);
    if (!m) throw new Error(`no hand rule for ${p.name}`);
    return m;
  }

  /** Reads every weights file in `dir`. One made for other columns is refused and said: the rule decides in its place. */
  private load(dir: string): void {
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return;
    }
    for (const name of names) {
      let why: string;
      try {
        const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as { profile?: unknown; about?: unknown };
        const p = PROFILES.find((q) => q.name === file.profile);
        const m = p ? readModel(file, p) : `made for ${String(file.profile)}, which is no profile here`;
        if (typeof m !== "string") {
          this.trained.set(m.profile, m);
          if (file.about && typeof file.about === "object") this.abouts.set(m.profile, file.about as Record<string, unknown>);
          else this.abouts.delete(m.profile);
          continue;
        }
        why = m;
      } catch (err) {
        why = err instanceof Error ? err.message : String(err);
      }
      this.refused.push(`${name}: ${why}`);
      this.ctx.say?.(`decide: weights ${name} refused (${why}); the rule decides in their place`);
    }
  }
}
