// `nav.reach`: will this mover arrive within the time its goal allows? Asked when a mover is given a goal (a place, a hunt,
// a leader) and at each think while it has it, from numbers already held, as `nav.snag` is. Whoever set the goal reads the
// answer (`reachOf`) in place of a fixed timeout: a course gives a leg up early on it (server/courses.ts). What it keeps of
// each goal (when it was given, the time it allows, the times the mover was stuck on it, and of the goal before it whether
// it was reached) is held by a pool slot, so a mover whose slot was taken starts its goal's count again. A logged answer's
// outcome is read at its goal's own deadline.

import { TICK_RATE } from "../../shared/coords.ts";
import { answer as choose } from "../../shared/decide/forward.ts";
import { MODES, REACH } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { soon, unit } from "../../shared/decide/units.ts";
import { F_ALIVE, F_AWAKE } from "../../shared/sim/entities.ts";
import { PINNED_TICKS, STUCK_TICKS, WAY_NONE, WAY_ON, type Behavior } from "../behavior.ts";
import type { ServerWorld } from "../world.ts";
import { COST_YES, type Ask, type Point } from "./decide.ts";
import { Pool } from "./pool.ts";

/** Seconds after an answer at which the log reads whether the mover arrived, where its goal has no deadline of its own. */
export const REACH_SECONDS = 30;
/** What became of a goal: still open, reached, or given up by whoever set it. */
const OPEN = 0, REACHED = 1, MISSED = 2;
/** Horizons a logged answer waits at the most, so long deadlines do not fill the decider's waiting ring. */
const DUE_MOST = 10;
/** A goal with no time of its own allows this many times its straight run at its pace, and this many seconds more. */
export const REACH_SLACK = 3;
export const REACH_EXTRA = 10;
/** Seconds to the goal at which `lineSoon` and `waySoon` are a half, and the stuck spells that count as many. */
const SOON_HALF = 10;
const STUCKS = 4;
/** Metres the goal may move and still be the same goal. */
const SAME_GOAL = 2;
/** Metres a follower or a hunter counts as there, beyond both bodies' radii. */
const NEAR = 3;

export class Reach {
  readonly point: Point;
  readonly pool: Pool;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly table = tableFor(REACH, 1);
  // By slot: the goal as last seen (its mode, and its place or the prey or leader it is), the tick it was given and the ticks
  // it allows, stuck spells on it, whether it was stuck at the last question, and the last answer (-1 for none).
  private readonly gx: Float32Array;
  private readonly gz: Float32Array;
  private readonly mode: Uint8Array;
  private readonly who: Int32Array;
  private readonly whoGen: Int32Array;
  private readonly from: Int32Array;
  private readonly allow: Int32Array;
  private readonly stucks: Uint8Array;
  private readonly was: Uint8Array;
  private readonly value: Float32Array;
  /** By slot: what became of the goal held, and the goal before it, its tick given, ticks allowed and what became of it. */
  private readonly fate: Uint8Array;
  private readonly prevFrom: Int32Array;
  private readonly prevAllow: Int32Array;
  private readonly prevFate: Uint8Array;
  private taking = 0;
  /** The tick a place goal of `e` runs out at, as whoever set it allows (Courses.legEnds); -1 for none. */
  ends: ((e: number) => number) | null = null;

  constructor(world: ServerWorld, mind: Behavior, size = 1024) {
    this.world = world;
    this.mind = mind;
    this.pool = new Pool(size, world.ents.cap);
    this.gx = new Float32Array(size);
    this.gz = new Float32Array(size);
    this.mode = new Uint8Array(size);
    this.who = new Int32Array(size);
    this.whoGen = new Int32Array(size);
    this.from = new Int32Array(size);
    this.allow = new Int32Array(size);
    this.stucks = new Uint8Array(size);
    this.was = new Uint8Array(size);
    this.value = new Float32Array(size).fill(-1);
    this.fate = new Uint8Array(size);
    this.prevFrom = new Int32Array(size);
    this.prevAllow = new Int32Array(size);
    this.prevFate = new Uint8Array(size);
    const reach = this;
    this.point = {
      name: "nav.reach", cost: COST_YES, horizon: REACH_SECONDS * TICK_RATE, tables: [{ profile: REACH, table: this.table }],
      still: (e) => (world.ents.flags[e]! & F_AWAKE) !== 0 && aims(mind.wants(e)),
      answer: (e, tick, _rung, ask) => reach.ask(e, tick, ask),
      apply: (e) => reach.keep(e),
      due: (e, tick) => reach.due(e, tick),
      outcome: (e, tick, out, asked) => reach.arrived(e, tick, out, asked),
      release: () => reach.value.fill(-1),
    };
  }

  /** How likely `e` is to arrive within its goal's time, 0 to 1, or -1 where that is not known. */
  reachOf(e: number): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!);
    return s < 0 ? -1 : this.value[s]!;
  }

  /** As `reachOf`, of the place `e` makes for now: -1 where the answer was of a hunt, a leader or another place. */
  placeOf(e: number): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!), mind = this.mind;
    if (s < 0 || this.mode[s] !== 1 || Math.abs(mind.goalX[e]! - this.gx[s]!) + Math.abs(mind.goalZ[e]! - this.gz[s]!) > SAME_GOAL) return -1;
    return this.value[s]!;
  }

  /** Whoever set `e`'s goal of a place at (x, z) says it was reached, or given up. */
  ended(e: number, ok: boolean, x: number, z: number): void {
    const s = this.pool.find(e, this.world.ents.gen[e]!);
    if (s < 0 || this.mode[s] !== 1 || this.fate[s] !== OPEN || Math.abs(x - this.gx[s]!) + Math.abs(z - this.gz[s]!) > SAME_GOAL) return;
    this.fate[s] = ok ? REACHED : MISSED;
  }

  /** The tick an answer given now about `e` is judged at: its goal's deadline, from the next tick to DUE_MOST horizons on. */
  private due(e: number, tick: number): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!), horizon = REACH_SECONDS * TICK_RATE;
    return s < 0 ? tick + horizon : Math.min(tick + DUE_MOST * horizon, Math.max(tick + 1, this.from[s]! + this.allow[s]!));
  }

  private readonly fresh = (s: number): void => {
    this.mode[s] = 255;
    this.value[s] = -1;
    this.was[s] = 0;
    this.stucks[s] = 0;
    this.from[s] = this.taking;
    this.fate[s] = OPEN;
    this.prevFrom[s] = this.taking;
    this.prevAllow[s] = 0;
    this.prevFate[s] = OPEN;
  };

  private ask(e: number, tick: number, ask: Ask): number {
    const mind = this.mind, ents = this.world.ents, want = mind.want, mode = mind.wants(e);
    if (!aims(mode)) return -1;
    this.taking = tick;
    const s = this.pool.hold(e, ents.gen[e]!, tick, this.fresh);
    const x = ents.x[e]!, z = ents.z[e]!, line = Math.hypot(want.x - x, want.z - z);
    const pace = want.speed > want.walk * 0.5 ? want.speed : want.walk * 0.5;
    // A new goal: its count starts. A place is the same goal within SAME_GOAL; prey or a leader, the same body.
    const who = mode === 3 ? want.prey : mode === 4 ? mind.leader[e]! : -1;
    const same = mode === this.mode[s] && (mode === 1 ? Math.abs(want.x - this.gx[s]!) + Math.abs(want.z - this.gz[s]!) <= SAME_GOAL : who === this.who[s] && ents.gen[who] === this.whoGen[s]);
    if (!same) {
      this.prevFrom[s] = this.from[s]!;
      this.prevAllow[s] = this.allow[s]!;
      this.prevFate[s] = this.fate[s]!;
      this.fate[s] = OPEN;
      this.mode[s] = mode;
      this.who[s] = who;
      this.whoGen[s] = who >= 0 ? ents.gen[who]! : 0;
      this.gx[s] = want.x;
      this.gz[s] = want.z;
      this.from[s] = tick;
      this.stucks[s] = 0;
      this.value[s] = -1;
      const set = mode === 1 && this.ends !== null ? this.ends(e) : -1, ends = set > tick ? set : mind.goalEnds(e);
      this.allow[s] = ends > tick ? ends - tick : Math.round((REACH_SLACK * (pace > 0 ? line / pace : 0) + REACH_EXTRA) * TICK_RATE);
    }
    const stuck = mind.stuck[e]! >= STUCK_TICKS || mind.pinned[e]! >= PINNED_TICKS ? 1 : 0;
    if (stuck !== 0 && this.was[s] === 0 && this.stucks[s]! < 255) this.stucks[s]!++;
    this.was[s] = stuck;
    const t = this.table, c = REACH.c, row = t.rows;
    t.clear(1);
    row[c[MODES[mode]!]] = 1;
    const way = want.way === WAY_ON ? mind.wayLength(e) : line;
    row[c.lineSoon] = pace > 0 ? soon(line / pace, SOON_HALF) : 1;
    row[c.waySoon] = pace > 0 ? soon(way / pace, SOON_HALF) : 1;
    row[c.blocked] = stuck;
    row[c.onWay] = want.way === WAY_ON ? 1 : 0;
    row[c.noWay] = want.way === WAY_NONE ? 1 : 0;
    row[c.stucks] = unit(this.stucks[s]!, STUCKS);
    row[c.spent] = unit(tick - this.from[s]!, this.allow[s]!);
    return choose("yes", t, ask(REACH, t));
  }

  private keep(e: number): void {
    const s = this.pool.find(e, this.world.ents.gen[e]!);
    if (s >= 0) this.value[s] = this.table.out[0]!;
  }

  /**
   * For the log, of the goal held when it was asked at `asked`: whether it was reached by its deadline (1 or 0, -1 where its
   * goal changed with nothing said of it, or is gone), and the share of its time spent.
   */
  private arrived(e: number, tick: number, out: Float32Array, asked = Infinity): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!), mind = this.mind, ents = this.world.ents;
    const mode = mind.wants(e), want = mind.want;
    if (s < 0 || (asked < this.from[s]! && asked < this.prevFrom[s]!)) {
      out[0] = -1;
      return 1;
    }
    // The goal asked about has given way to another: what was said of it, if anything.
    if (asked < this.from[s]!) {
      const f = this.prevFate[s]!;
      out[0] = f === REACHED ? 1 : f === MISSED ? 0 : -1;
      out[1] = (tick - this.prevFrom[s]!) / (this.prevAllow[s]! > 0 ? this.prevAllow[s]! : 1);
      return 2;
    }
    out[1] = (tick - this.from[s]!) / (this.allow[s]! > 0 ? this.allow[s]! : 1);
    if (this.fate[s] !== OPEN) {
      out[0] = this.fate[s] === REACHED ? 1 : 0;
      return 2;
    }
    const at = this.mode[s]!, who = this.who[s]!;
    if (at === 1) out[0] = mind.arrived(e) ? 1 : mode === 1 ? 0 : -1;
    else if (mode !== at || (at === 3 ? want.prey : mind.leader[e]) !== who) {
      // A hunt that ended with its prey dead arrived; any other change of goal says nothing.
      out[0] = at === 3 && who >= 0 && (ents.gen[who] !== this.whoGen[s] || (ents.flags[who]! & F_ALIVE) === 0) ? 1 : -1;
    } else {
      const reg = this.world.reg;
      const room = NEAR + reg.bodyRadius[ents.kind[e]!]! + reg.bodyRadius[ents.kind[who]!]!;
      out[0] = Math.hypot(want.x - ents.x[e]!, want.z - ents.z[e]!) <= room ? 1 : 0;
    }
    return 2;
  }
}

/** Whether a MODES index is a goal `nav.reach` asks of: a place, prey or a leader. */
function aims(mode: number): boolean {
  return mode === 1 || mode === 3 || mode === 4;
}
