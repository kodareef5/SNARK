// `nav.reach`: will this mover arrive within the time its goal allows? Asked when a mover is given a goal (a place, a hunt,
// a leader) and at each think while it has it, from numbers already held, as `nav.snag` is. Nothing acts on the answer
// yet: whoever set the goal reads it (`reachOf`) in place of a fixed timeout. What it keeps of each goal (when it was
// given, the time it allows, the times the mover was stuck on it) is held by a pool slot, so a mover whose slot was taken
// starts its goal's count again.

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

/** Seconds after an answer at which the log reads whether the mover arrived. */
export const REACH_SECONDS = 30;
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
  private taking = 0;

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
    const reach = this;
    this.point = {
      name: "nav.reach", cost: COST_YES, horizon: REACH_SECONDS * TICK_RATE, tables: [{ profile: REACH, table: this.table }],
      still: (e) => (world.ents.flags[e]! & F_AWAKE) !== 0 && aims(mind.wants(e)),
      answer: (e, tick, _rung, ask) => reach.ask(e, tick, ask),
      apply: (e) => reach.keep(e),
      outcome: (e, tick, out) => reach.arrived(e, tick, out),
    };
  }

  /** How likely `e` is to arrive within its goal's time, 0 to 1, or -1 where that is not known. */
  reachOf(e: number): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!);
    return s < 0 ? -1 : this.value[s]!;
  }

  private readonly fresh = (s: number): void => {
    this.mode[s] = 255;
    this.value[s] = -1;
    this.was[s] = 0;
    this.stucks[s] = 0;
    this.from[s] = this.taking;
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
      this.mode[s] = mode;
      this.who[s] = who;
      this.whoGen[s] = who >= 0 ? ents.gen[who]! : 0;
      this.gx[s] = want.x;
      this.gz[s] = want.z;
      this.from[s] = tick;
      this.stucks[s] = 0;
      this.value[s] = -1;
      const ends = mind.goalEnds(e);
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

  /** For the log: whether `e` is where its goal was (1 or 0, -1 where its goal changed or is gone), the share of its time spent. */
  private arrived(e: number, tick: number, out: Float32Array): number {
    const s = this.pool.find(e, this.world.ents.gen[e]!), mind = this.mind, ents = this.world.ents;
    const mode = mind.wants(e), want = mind.want;
    if (s < 0) {
      out[0] = -1;
      return 1;
    }
    out[1] = (tick - this.from[s]!) / (this.allow[s]! > 0 ? this.allow[s]! : 1);
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
