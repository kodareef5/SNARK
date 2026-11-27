// The stuck ladder: movers that are snagged or stuck get out. A calm mover costs nothing and keeps today's code. `nav.snag`
// asks, from numbers already held, whether a mover with a goal will make no progress soon; yes makes it wary. Stuck or
// pinned, or told there is no way, it climbs: wary, stuck, a patient escape. On the ladder it holds a slot of the pool,
// and `nav.ring` chooses which heading it holds next from three passes over a ring of headings (nav-ring.ts). After
// about two seconds of real progress it is calm again and gives its slot up. Nothing gives up from the ladder: where it
// would, the mover climbs, and only the hunt's own limits (its time and its leash) end a hunt.

import { TICK_RATE } from "../../shared/coords.ts";
import { addPass, stick } from "../../shared/decide/combine.ts";
import { answer as choose } from "../../shared/decide/forward.ts";
import { MODES, RING_FAR, RING_MID, RING_NEAR, SNAG, SURE, SURE_SECONDS } from "../../shared/decide/profiles.ts";
import { Table, tableFor } from "../../shared/decide/table.ts";
import { soon, unit } from "../../shared/decide/units.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { PINNED_TICKS, STUCK_TICKS, THINK_TICKS, WAY_NONE, WAY_ON, type Behavior, type Ladder } from "../behavior.ts";
import type { BodyBlocking } from "../blocking.ts";
import type { ServerWorld } from "../world.ts";
import { COST_RING, COST_YES, type Ask, type Decide, type Point } from "./decide.ts";
import { FAR_W, MID_W, NEAR_W, Rings, NEVER } from "./nav-ring.ts";
import { Actions, type Held } from "./actions.ts";
import { Probe } from "./nav-probe.ts";
import { Reach } from "./nav-reach.ts";
import { Pool } from "./pool.ts";

/** Headings in a ring. The lab tries 8, 12 and 16. */
export const K = 12;
/** How much each pass counts when the three are added. */
export const MIX_FAR = 1;
export const MIX_MID = 1;
export const MIX_NEAR = 1;
/** Added to the heading held, so a mover between two near-equal ways does not dither. */
export const STICK = 0.5;
/** A snag this likely makes the mover wary. */
export const SNAG_AT = 0.5;
/**
 * On the stuck rungs a pick `nav.sure` thinks less likely than this to free the mover is passed over for the next best, at
 * most SURE_TRIES times; with none sure enough the surest of those looked at is held.
 */
export const SURE_AT = 0.5;
export const SURE_TRIES = 2;
/** Seconds stuck at which `stuckSoon` is a half. */
const STUCK_HALF = 4;
/** Ticks a heading is held, and while something is within reach, when the near pass is refreshed. */
export const HOLD_TICKS = 20;
export const NEAR_TICKS = 5;
/** Ticks each pass's ring is kept before it is filled again, on the first rung; deeper ones fill all of them every time. */
export const FAR_TICKS = 60;
export const MID_TICKS = THINK_TICKS;
/** Ticks of real progress that make a mover calm, and ticks on the stuck rung without it that make it patient. */
const CALM_TICKS = 2 * TICK_RATE;
const PATIENT_TICKS = 4 * TICK_RATE;
/** Real progress is this share of its pace, toward its goal (or anywhere, for a wanderer), or along a held heading. */
const PROGRESS = 0.35;
/** Ticks a held heading runs before it is judged, and over which the mark of one that led nowhere fades. */
const JUDGE_TICKS = 8;
const TRIED_TICKS = 4 * TICK_RATE;
/** A body that has turned no more than this (65536ths of a turn) in this many ticks, meaning to, is wedged and backs out. */
const WEDGE_TURN = 1820;
const WEDGE_TICKS = 12;
/** Metres the goal may move before the far ring is filled again. */
const GOAL_MOVED = 2;
/** Seconds to the goal at which `goalSoon` is a half. */
const GOAL_HALF = 5;
const TAU = Math.PI * 2;

export class Nav implements Ladder, Held {
  readonly k: number;
  readonly pool: Pool;
  /** The point numbers `put` names them by. */
  snag = -1;
  ring = -1;
  /** What a stuck mover can do besides choose a heading, and its point's number (actions.ts). */
  actions: Actions | null = null;
  doId = -1;
  readonly snagPoint: Point;
  readonly ringPoint: Point;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly decide: Decide;
  private readonly rings: Rings;
  // By slot. The last slot is scratch, for a mover asked about before it has one of its own.
  private readonly owner: Int32Array;
  private readonly rungs: Uint8Array;
  private readonly since: Int32Array;
  private readonly holdK: Int8Array;
  private readonly holdAt: Int32Array;
  private readonly holdUntil: Int32Array;
  private readonly holdX: Float32Array;
  private readonly holdZ: Float32Array;
  private readonly answeredAt: Int32Array;
  private readonly lastPick: Int8Array;
  /** The tick each heading was last found to lead nowhere. */
  private readonly triedAt: Int32Array;
  /** Where it was, and how far from its goal, when last tended, and the tick since which it has made real progress. */
  private readonly lastX: Float32Array;
  private readonly lastZ: Float32Array;
  private readonly lastD: Float32Array;
  /** The nearest it has been to its goal since it came on the ladder. */
  private readonly best: Float32Array;
  private readonly lastAt: Int32Array;
  private readonly calmFrom: Int32Array;
  /** The way it faced when it last turned, and since when. */
  private readonly faceAt: Uint16Array;
  private readonly faceSince: Int32Array;
  private readonly snagTable = tableFor(SNAG, 1);
  private readonly far = tableFor(RING_FAR, 16);
  private readonly mid = tableFor(RING_MID, 16);
  private readonly near = tableFor(RING_NEAR, 16);
  private readonly all = new Table(16, 0, 1);
  private readonly sure = tableFor(SURE, 1);
  /** Of the answer just given: the headings `nav.sure` passed over, a bit each, and how sure it was of the pick. */
  private rejected = 0;
  private picked = -1;
  /** By slot: how sure `nav.sure` was of the heading held (-1 where it was not asked), and where the mover was then. */
  private readonly sureOf: Float32Array;
  private readonly askX: Float32Array;
  private readonly askZ: Float32Array;
  private readonly askD: Float32Array;
  /** By slot: when it came on the stuck rungs, and the share of headings its last ring left open. */
  private readonly stuckAt: Int32Array;
  /** By slot: the heading its last stuck answer asked what it could do along, in 65536ths of a turn. */
  private readonly tryYaw: Uint16Array;
  private readonly waysOf: Float32Array;
  private lastWays = 1;
  private wantPick = 0;
  private readonly dx: Float64Array;
  private readonly dz: Float64Array;
  private taking = -1;

  constructor(world: ServerWorld, mind: Behavior, blocking: BodyBlocking, decide: Decide, k = K, size = 1024) {
    if (k < 3 || k > 16) throw new Error(`a ring of ${k} headings`);
    this.world = world;
    this.mind = mind;
    this.decide = decide;
    this.k = k;
    this.pool = new Pool(size, world.ents.cap);
    const n = size + 1;
    this.dx = Float64Array.from({ length: k }, (_, i) => Math.sin((i / k) * TAU));
    this.dz = Float64Array.from({ length: k }, (_, i) => Math.cos((i / k) * TAU));
    this.rings = new Rings(world, mind, blocking, n, k, this.dx, this.dz);
    this.owner = new Int32Array(n).fill(-1);
    this.rungs = new Uint8Array(n);
    this.since = new Int32Array(n);
    this.holdK = new Int8Array(n).fill(-1);
    this.holdAt = new Int32Array(n);
    this.holdUntil = new Int32Array(n);
    this.holdX = new Float32Array(n);
    this.holdZ = new Float32Array(n);
    this.answeredAt = new Int32Array(n).fill(NEVER);
    this.lastPick = new Int8Array(n).fill(-1);
    this.triedAt = new Int32Array(n * k).fill(NEVER);
    this.lastX = new Float32Array(n);
    this.lastZ = new Float32Array(n);
    this.lastD = new Float32Array(n);
    this.best = new Float32Array(n);
    this.lastAt = new Int32Array(n);
    this.calmFrom = new Int32Array(n);
    this.faceAt = new Uint16Array(n);
    this.faceSince = new Int32Array(n);
    this.sureOf = new Float32Array(n).fill(-1);
    this.askX = new Float32Array(n);
    this.askZ = new Float32Array(n);
    this.askD = new Float32Array(n);
    this.stuckAt = new Int32Array(n);
    this.tryYaw = new Uint16Array(n);
    this.waysOf = new Float32Array(n);
    const nav = this;
    this.snagPoint = {
      name: "nav.snag", cost: COST_YES, horizon: 0, tables: [{ profile: SNAG, table: this.snagTable }],
      still: (e) => nav.moving(e) && mind.wants(e) !== 0,
      answer: (e, _tick, _rung, ask) => nav.askSnag(e, ask),
      apply: (e, tick) => nav.snagged(e, tick),
    };
    this.ringPoint = {
      name: "nav.ring", cost: COST_RING, horizon: SURE_SECONDS * TICK_RATE,
      tables: [{ profile: RING_FAR, table: this.far }, { profile: RING_MID, table: this.mid }, { profile: RING_NEAR, table: this.near }, { profile: SURE, table: this.sure }],
      still: (e) => nav.moving(e),
      answer: (e, tick, rung, ask) => nav.askRing(e, tick, rung, ask),
      apply: (e, tick, rung, pick) => nav.go(e, tick, rung, pick),
      outcome: (e, tick, out) => nav.freed(e, tick, out),
    };
  }

  held(e: number, tick: number): number {
    const s = this.slot(e);
    if (s < 0 || this.holdK[s]! < 0 || tick >= this.holdUntil[s]! || this.mind.pinned[e]! >= PINNED_TICKS) return -1;
    return this.yawOf(this.holdK[s]!);
  }

  act(e: number, tick: number): boolean {
    return this.actions !== null && this.actions.act(e, tick);
  }

  slotOf(e: number): number {
    return this.slot(e);
  }

  trying(e: number): number {
    const s = this.slot(e);
    return s < 0 || this.holdK[s]! < 0 ? -1 : this.tryYaw[s]!;
  }

  rungOf(e: number): number {
    const s = this.slot(e);
    return s < 0 ? 0 : this.rungs[s]!;
  }

  stuckFor(e: number, tick: number): number {
    const s = this.slot(e);
    return s < 0 || this.rungs[s]! < 2 ? 0 : tick - this.stuckAt[s]!;
  }

  ways(e: number): number {
    const s = this.slot(e);
    return s < 0 ? 1 : this.waysOf[s]!;
  }

  wedged(e: number, tick: number): boolean {
    const s = this.slot(e);
    if (s < 0) return false;
    const yaw = this.world.ents.yaw[e]!;
    if (Math.abs(((yaw - this.faceAt[s]! + 32768) & 0xffff) - 32768) > WEDGE_TURN) {
      this.faceAt[s] = yaw;
      this.faceSince[s] = tick;
    }
    return tick - this.faceSince[s]! >= WEDGE_TICKS;
  }

  due(e: number, tick: number): boolean {
    const s = this.slot(e);
    if (s < 0) return false;
    const since = tick - this.answeredAt[s]!;
    return since >= THINK_TICKS || (this.rings.close[s] !== 0 && since >= NEAR_TICKS) || tick >= this.holdUntil[s]! - 1;
  }

  climb(e: number, tick: number): boolean {
    if (!this.decide.acts(this.ring)) return false;
    let s = this.slot(e);
    if (s < 0) s = this.take(e, tick);
    const r = this.rungs[s]! + 1;
    this.rise(e, s, r < 2 ? 2 : r > 3 ? 3 : r, tick);
    this.decide.put(this.ring, e, this.rungs[s]!, this.mind.back(e));
    return true;
  }

  /** Puts `e` on `rung` at once, as its own trouble would: the lab and tests start a scene there. */
  enter(e: number, tick: number, rung: number): void {
    let s = this.slot(e);
    if (s < 0) s = this.take(e, tick);
    this.rise(e, s, rung, tick);
  }

  /** The tick the far ring of `e` was last filled, or NEVER. */
  farFilled(e: number): number {
    const s = this.slot(e);
    return s < 0 ? NEVER : this.rings.farAt[s]!;
  }

  drop(e: number): void {
    const s = this.slot(e);
    if (s >= 0) this.owner[s] = -1;
    this.pool.drop(e);
    this.mind.rung[e] = 0;
  }

  /** What the ladder knows of `e`, for a page or the debug bar: its rung, since when, the heading held and until when, those tried (a bit each), the last chosen, how sure of it. */
  describe(e: number): Record<string, unknown> | null {
    const s = this.slot(e);
    if (s < 0) return null;
    let tried = 0;
    for (let i = 0; i < this.k; i++) if (this.tried(s, i, this.world.tick) > 0) tried |= 1 << i;
    return { rung: this.rungs[s]!, since: this.since[s]!, held: this.holdK[s]!, until: this.holdUntil[s]!, tried, lastPick: this.lastPick[s]!, sure: this.sureOf[s]! };
  }

  private moving(e: number): boolean {
    const ents = this.world.ents;
    return (ents.flags[e]! & F_AWAKE) !== 0 && ents.driven[e] === 0 && !this.mind.flies(e);
  }

  private slot(e: number): number {
    return this.pool.find(e, this.world.ents.gen[e]!);
  }

  private readonly fresh = (s: number): void => {
    const was = this.owner[s]!, e = this.taking, ents = this.world.ents, mind = this.mind;
    // A slot taken from a mover still on the ladder leaves it calm.
    if (was >= 0 && was !== e && this.pool.find(was, ents.gen[was]!) < 0) mind.rung[was] = 0;
    this.owner[s] = e;
    this.rungs[s] = 0;
    this.since[s] = this.world.tick;
    this.holdK[s] = -1;
    this.holdUntil[s] = 0;
    this.answeredAt[s] = NEVER;
    this.lastPick[s] = -1;
    this.triedAt.fill(NEVER, s * this.k, (s + 1) * this.k);
    const mode = mind.wants(e);
    this.lastX[s] = ents.x[e]!;
    this.lastZ[s] = ents.z[e]!;
    this.lastD[s] = this.best[s] = mode !== 0 ? Math.hypot(mind.want.x - ents.x[e]!, mind.want.z - ents.z[e]!) : 0;
    this.lastAt[s] = this.calmFrom[s] = this.faceSince[s] = this.world.tick;
    this.faceAt[s] = ents.yaw[e]!;
    this.stuckAt[s] = this.world.tick;
    this.actions?.clear(s);
    this.rings.clear(s, ents.x[e]!, ents.z[e]!, ents.yaw[e]!, this.world.tick);
  };

  private take(e: number, tick: number): number {
    this.taking = e;
    return this.pool.hold(e, this.world.ents.gen[e]!, tick, this.fresh);
  }

  private rise(e: number, s: number, rung: number, tick: number): void {
    if (rung === this.rungs[s]) return;
    if (rung >= 2 && this.rungs[s]! < 2) this.stuckAt[s] = tick;
    this.rungs[s] = rung;
    this.since[s] = tick;
    this.mind.rung[e] = rung;
  }

  private yawOf(k: number): number {
    return Math.round((k / this.k) * 65536) & 0xffff;
  }

  /** How much heading `i` is marked as leading nowhere, 0 to 1, fading. */
  private tried(s: number, i: number, tick: number): number {
    const v = 1 - (tick - this.triedAt[s * this.k + i]!) / TRIED_TICKS;
    return v > 0 ? v : 0;
  }

  /** Whether the heading held has taken `e` along it at a real pace, or has not run long enough to say. */
  private went(e: number, s: number, tick: number, pace: number): boolean {
    const ran = tick - this.holdAt[s]!, k = this.holdK[s]!;
    if (k < 0 || ran < JUDGE_TICKS) return true;
    const ents = this.world.ents;
    const along = (ents.x[e]! - this.holdX[s]!) * this.dx[k]! + (ents.z[e]! - this.holdZ[s]!) * this.dz[k]!;
    return along >= (PROGRESS * pace * ran) / TICK_RATE;
  }

  private askSnag(e: number, ask: Ask): number {
    const t = this.snagTable, mind = this.mind, ents = this.world.ents, c = SNAG.c;
    t.clear(1);
    const mode = mind.wants(e), want = mind.want, row = t.rows;
    row[c[MODES[mode]!]] = 1;
    const speed = Math.hypot(ents.vx[e]!, ents.vz[e]!);
    row[c.pace] = want.speed > 0.05 ? unit(speed, want.speed) : 0;
    const gains = mind.snagGain[e]!;
    const g0 = ((gains << 24) >> 24) / 127, g1 = ((gains << 16) >> 24) / 127, g2 = ((gains << 8) >> 24) / 127, g3 = (gains >> 24) / 127;
    row[c.gain1] = g0;
    row[c.gain2] = (g0 + g1) / 2;
    row[c.gain4] = (g0 + g1 + g2 + g3) / 4;
    row[c.stuck] = unit(mind.stuck[e]!, STUCK_TICKS);
    row[c.pinned] = unit(mind.pinned[e]!, PINNED_TICKS);
    row[c.onWay] = want.way === WAY_ON ? 1 : 0;
    row[c.noWay] = want.way === WAY_NONE ? 1 : 0;
    const pace = want.speed > want.walk * 0.5 ? want.speed : want.walk * 0.5;
    row[c.goalSoon] = pace > 0 ? soon(Math.hypot(want.x - ents.x[e]!, want.z - ents.z[e]!) / pace, GOAL_HALF) : 1;
    return choose("yes", t, ask(SNAG, t));
  }

  /** A snag likely makes a calm mover wary; one on the ladder is tended. */
  private snagged(e: number, tick: number): void {
    const s = this.slot(e);
    if (s >= 0) this.tend(e, s, tick);
    else if (this.snagTable.out[0]! >= SNAG_AT) this.rise(e, this.take(e, tick), 1, tick);
  }

  private askRing(e: number, tick: number, rung: number, ask: Ask): number {
    const mind = this.mind, ents = this.world.ents, rings = this.rings, k = this.k;
    const p = mind.walkerOf(e);
    if (!p) return -1;
    const mode = mind.wants(e), want = mind.want;
    const found = this.slot(e);
    const s = found >= 0 ? found : this.pool.size;
    const deep = found >= 0 && this.rungs[s]! > rung ? this.rungs[s]! : rung;
    const pace = want.speed > want.walk * 0.5 ? want.speed : want.walk * 0.5;
    rings.begin(e, p, pace, mode, deep);
    const fresh = found < 0 || deep >= 2;
    if (fresh || tick - rings.farAt[s]! >= FAR_TICKS || Math.abs(want.x - rings.farGX[s]!) + Math.abs(want.z - rings.farGZ[s]!) > GOAL_MOVED) rings.fillFar(s, tick);
    if (fresh || tick - rings.midAt[s]! >= MID_TICKS) rings.fillMid(s, tick);
    if (fresh || tick - rings.nearAt[s]! >= NEAR_TICKS) rings.fillNear(s, tick);
    // The heading held, else the one it faces: the ring is the world's, so this is found afresh each time.
    const holds = found >= 0 && this.holdK[s]! >= 0 && tick < this.holdUntil[s]!;
    const held = holds ? this.holdK[s]! : Math.round((ents.yaw[e]! / 65536) * k) % k;
    const failing = found >= 0 && !this.went(e, s, tick, pace) ? this.holdK[s]! : -1;
    const far = this.far, mid = this.mid, near = this.near;
    far.clear(k);
    mid.clear(k);
    near.clear(k);
    const fs = RING_FAR.s, ms = RING_MID.s, ns = RING_NEAR.s;
    const speed = Math.hypot(ents.vx[e]!, ents.vz[e]!);
    const paceShare = want.speed > 0.05 ? unit(speed, want.speed) : 0;
    far.state[fs[MODES[mode]!]] = 1;
    far.state[fs.rung] = deep / 3;
    far.state[fs.goalSoon] = mode !== 0 && pace > 0 ? soon(Math.hypot(want.x - ents.x[e]!, want.z - ents.z[e]!) / pace, GOAL_HALF) : 0;
    mid.state[ms[MODES[mode]!]] = 1;
    mid.state[ms.rung] = deep / 3;
    mid.state[ms.pace] = paceShare;
    mid.state[ms.stuck] = unit(mind.stuck[e]!, STUCK_TICKS);
    near.state[ns.rung] = deep / 3;
    near.state[ns.pace] = paceShare;
    near.state[ns.stuck] = unit(mind.stuck[e]!, STUCK_TICKS);
    near.state[ns.pinned] = unit(mind.pinned[e]!, PINNED_TICKS);
    const fc = RING_FAR.c, mc = RING_MID.c, nc = RING_NEAR.c;
    for (let i = 0; i < k; i++) {
      const tried = i === failing ? 1 : this.tried(s, i, tick), h = i === held ? 1 : 0;
      rings.farRow(s, i, far.rows, i * FAR_W);
      rings.midRow(s, i, mid.rows, i * MID_W);
      near.mask[i] = rings.nearRow(s, i, near.rows, i * NEAR_W);
      far.rows[i * FAR_W + fc.held] = mid.rows[i * MID_W + mc.held] = near.rows[i * NEAR_W + nc.held] = h;
      far.rows[i * FAR_W + fc.tried] = mid.rows[i * MID_W + mc.tried] = near.rows[i * NEAR_W + nc.tried] = tried;
    }
    const all = this.all;
    all.clear(k);
    addPass(all, far, MIX_FAR / ask(RING_FAR, far));
    addPass(all, mid, MIX_MID / ask(RING_MID, mid));
    addPass(all, near, MIX_NEAR / ask(RING_NEAR, near));
    stick(all, held, STICK);
    // Where it would go if nothing stood in the way: what it may act on, if it is stuck.
    let wants = 0;
    for (let i = 1; i < k; i++) if (far.score[i]! > far.score[wants]!) wants = i;
    this.wantPick = wants;
    let pick = choose("choice", all, 1);
    this.rejected = 0;
    this.picked = -1;
    this.lastWays = 1;
    this.sure.clear(0);
    if (deep < 2 || pick < 0) return pick;
    // Stuck, it asks whether the pick would free it, and takes the next best of one it doubts. Standing is never the answer.
    let open = 0;
    for (let i = 0; i < k; i++) if (all.mask[i] === 0) open++;
    this.lastWays = open / k;
    const stuckSoon = soon((tick - (found >= 0 ? this.since[s]! : tick)) / TICK_RATE, STUCK_HALF);
    let best = pick, surest = -1;
    for (let tries = 0; ; tries++) {
      const p = this.askSure(pick, deep, open / k, stuckSoon, ask);
      if (p > surest) {
        surest = p;
        best = pick;
      }
      if (p >= SURE_AT) break;
      // Each doubted heading is marked tried, but for the one held.
      this.rejected |= 1 << pick;
      if (tries >= SURE_TRIES) break;
      all.mask[pick] = 1;
      pick = choose("choice", all, 1);
      if (pick < 0) break;
    }
    // The table left is that of the pick held, for the log, among what was left when it was looked at.
    if (best !== pick) {
      all.mask[best] = 0;
      choose("choice", all, 1);
      this.askSure(best, deep, open / k, stuckSoon, ask);
    }
    this.rejected &= ~(1 << best);
    this.picked = surest;
    return best;
  }

  /** Fills the SURE table for heading `i` of the ring just scored, has it asked, and returns how sure it is. */
  private askSure(i: number, deep: number, ways: number, stuckSoon: number, ask: Ask): number {
    const all = this.all, t = this.sure, c = SURE.c, mid = this.mid.rows, near = this.near.rows, k = all.k;
    let second = 0;
    for (let j = 0; j < k; j++) if (j !== i && all.mask[j] === 0 && all.out[j]! > second) second = all.out[j]!;
    t.clear(1);
    const row = t.rows, m = i * MID_W, wet = mid[m + RING_MID.c.wet]!, hurt = mid[m + RING_MID.c.hurt]!, drop = mid[m + RING_MID.c.drop]!;
    row[c.rung] = deep / 3;
    row[c.ways] = ways;
    row[c.top] = all.out[i]!;
    row[c.lead] = all.out[i]! - second > 0 ? all.out[i]! - second : 0;
    row[c.open] = near[i * NEAR_W + RING_NEAR.c.open]!;
    row[c.run] = mid[m + RING_MID.c.run]!;
    row[c.price] = wet > hurt ? (wet > drop ? wet : drop) : hurt > drop ? hurt : drop;
    row[c.tried] = mid[m + RING_MID.c.tried]!;
    row[c.stuckSoon] = stuckSoon;
    choose("yes", t, ask(SURE, t));
    return t.out[0]!;
  }

  /** For the log: whether `e` has made real progress since its ring was answered (1 or 0, -1 off the ladder), and how far. */
  private freed(e: number, _tick: number, out: Float32Array): number {
    const s = this.slot(e), mind = this.mind, ents = this.world.ents;
    if (s < 0) {
      out[0] = -1;
      return 1;
    }
    const mode = mind.wants(e), want = mind.want, x = ents.x[e]!, z = ents.z[e]!;
    const gain = mode !== 0 ? this.askD[s]! - Math.hypot(want.x - x, want.z - z) : Math.hypot(x - this.askX[s]!, z - this.askZ[s]!);
    const pace = want.speed > want.walk * 0.5 ? want.speed : want.walk * 0.5;
    out[0] = gain >= PROGRESS * pace * SURE_SECONDS ? 1 : 0;
    out[1] = gain;
    return 2;
  }

  /** `e` holds the heading picked, a while, and the one it held before is marked if it led nowhere. */
  private go(e: number, tick: number, rung: number, pick: number): void {
    let s = this.slot(e);
    if (s < 0) {
      s = this.take(e, tick);
      this.rings.copy(this.pool.size, s);
    }
    if (rung > this.rungs[s]!) this.rise(e, s, rung, tick);
    if (this.tend(e, s, tick)) return;
    const ents = this.world.ents, mind = this.mind;
    mind.wants(e);
    const pace = mind.want.speed > mind.want.walk * 0.5 ? mind.want.speed : mind.want.walk * 0.5;
    const was = this.holdK[s]!;
    const led = this.went(e, s, tick, pace);
    if (was >= 0 && !led) this.triedAt[s * this.k + was] = tick;
    if (was !== pick || !led || tick >= this.holdUntil[s]!) {
      this.holdK[s] = pick;
      this.holdAt[s] = tick;
      this.holdX[s] = ents.x[e]!;
      this.holdZ[s] = ents.z[e]!;
    }
    this.holdUntil[s] = tick + (this.rings.close[s] !== 0 ? NEAR_TICKS + 2 : HOLD_TICKS);
    this.answeredAt[s] = tick;
    this.lastPick[s] = pick;
    for (let i = 0; i < this.k; i++) if ((this.rejected & (1 << i)) !== 0) this.triedAt[s * this.k + i] = tick;
    this.sureOf[s] = this.picked;
    this.waysOf[s] = this.lastWays;
    this.askX[s] = ents.x[e]!;
    this.askZ[s] = ents.z[e]!;
    this.askD[s] = Math.hypot(mind.want.x - ents.x[e]!, mind.want.z - ents.z[e]!);
    // Where it asks what it can do: into what it pressed on, else the way it was stuck facing, else the way it would go.
    this.tryYaw[s] = mind.pinned[e]! >= PINNED_TICKS ? (mind.wallYaw[e]! + 32768) & 0xffff : mind.stuck[e]! >= STUCK_TICKS ? ents.yaw[e]! : this.yawOf(this.wantPick);
    mind.hold(e, this.yawOf(pick), this.holdUntil[s]!, tick);
    // Stuck, it asks which of the things it can do would help.
    if (this.rungs[s]! >= 2 && this.doId >= 0) this.decide.put(this.doId, e, this.rungs[s]!, mind.back(e));
  }

  /**
   * Keeps `e`'s trail and measures its progress since it was last tended. Two seconds of real progress make it calm, and
   * it leaves the ladder (true); on the stuck rung four seconds without any make it patient.
   */
  private tend(e: number, s: number, tick: number): boolean {
    const ents = this.world.ents, mind = this.mind;
    const mode = mind.wants(e), want = mind.want;
    const x = ents.x[e]!, z = ents.z[e]!;
    // The trail is the way it came in: kept until it is stuck, and not while it casts about.
    if (this.rungs[s]! < 2) this.rings.trace(s, x, z, tick);
    const dt = tick - this.lastAt[s]!;
    if (dt >= NEAR_TICKS) {
      const d = mode !== 0 ? Math.hypot(want.x - x, want.z - z) : 0;
      // Toward a goal, only ground never won before counts: walking back into the dead end it left is no progress.
      const gain = mode !== 0 ? (d < this.best[s]! ? this.lastD[s]! - d : 0) : Math.hypot(x - this.lastX[s]!, z - this.lastZ[s]!);
      const pace = want.speed > want.walk * 0.5 ? want.speed : want.walk * 0.5;
      if (gain < (PROGRESS * pace * dt) / TICK_RATE || mind.pinned[e] !== 0 || mind.stuck[e]! >= STUCK_TICKS) this.calmFrom[s] = tick;
      if (mode !== 0 && d < this.best[s]!) this.best[s] = d;
      this.lastX[s] = x;
      this.lastZ[s] = z;
      this.lastD[s] = d;
      this.lastAt[s] = tick;
    }
    if (tick - this.calmFrom[s]! >= CALM_TICKS) {
      this.drop(e);
      return true;
    }
    if (this.rungs[s] === 2 && this.calmFrom[s] === tick && tick - this.since[s]! >= PATIENT_TICKS) {
      this.rise(e, s, 3, tick);
      mind.patient(e, tick);
    }
    return false;
  }
}

/** Adds the ladder's points to `decide` and hands `mind` the ladder. */
export function addNav(decide: Decide, world: ServerWorld, mind: Behavior, blocking: BodyBlocking, k = K): Nav {
  const nav = new Nav(world, mind, blocking, decide, k);
  nav.snag = decide.add(nav.snagPoint);
  nav.ring = decide.add(nav.ringPoint);
  mind.snagPoint = nav.snag;
  mind.ringPoint = nav.ring;
  const reach = new Reach(world, mind);
  mind.reachPoint = decide.add(reach.point);
  mind.reacher = reach;
  mind.probePoint = decide.add(new Probe(world, mind).point);
  nav.actions = new Actions(world, mind, blocking, nav, nav.pool.size + 1);
  nav.doId = decide.add(nav.actions.point);
  mind.ladder = nav;
  decide.describe = (e) => nav.describe(e);
  return nav;
}
