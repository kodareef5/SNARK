// The lab's own stand-in for a heading point, so the pipeline can run on the real world before the game's navigation
// points exist (server/decide/nav.ts). When its mover is stuck, pinned or making no progress, it asks which of K
// headings to walk for two seconds: a far table (where the heading leads) and a mid table (how free it is at knee and
// chest height, and how wet), added as a game adds its passes. Acting on a heading sends the mover to a point along it;
// once there, or out of time, it makes for its goal again. It is not the game's point and its weights are not shipped.

import { COST_RING, type Ask, type Point } from "../../server/decide/decide.ts";
import { GOAL_WALK, type Behavior } from "../../server/behavior.ts";
import type { ServerWorld } from "../../server/world.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { addPass } from "../../shared/decide/combine.ts";
import { answer } from "../../shared/decide/forward.ts";
import { MID_SECONDS, RING_FAR, RING_MID } from "../../shared/decide/profiles.ts";
import { Table, tableFor } from "../../shared/decide/table.ts";
import { soon, unit } from "../../shared/decide/units.ts";
import { castWorld, rayHit } from "../../shared/world/ray.ts";

export const STANDIN = "lab.ring";
const K = 12;
const LEG_TICKS = 2 * TICK_RATE;
const THINK = 15;

export interface Mover {
  e: number;
  goal: { x: number; z: number };
  radius: number;
  height: number;
  pace: number;
}

export class StandIn implements Point {
  readonly name = STANDIN;
  readonly cost = COST_RING;
  readonly horizon = 0;
  readonly mid = tableFor(RING_MID, K);
  readonly far = tableFor(RING_FAR, K);
  readonly tables = [{ profile: RING_MID, table: this.mid }, { profile: RING_FAR, table: this.far }];
  private readonly sum = new Table(K, 0, 0);
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly m: Mover;
  /** The tick its leg ends (0 for none), when it was last asked, its last pick, and where it stood two seconds ago. */
  private legUntil = 0;
  private asked = -1000;
  private last = -1;
  private lastAt = -1000;
  private readonly trail: number[] = [];

  constructor(world: ServerWorld, mind: Behavior, m: Mover) {
    this.world = world;
    this.mind = mind;
    this.m = m;
  }

  /** Before each tick: ends a leg that is done, and puts a question when the mover is in trouble. Returns the rung, or -1. */
  due(tick: number): number {
    const { e, goal } = this.m, ents = this.world.ents, mind = this.mind;
    if (this.legUntil > 0 && (tick >= this.legUntil || mind.arrived(e, 1))) {
      this.legUntil = 0;
      mind.goTo(e, goal.x, goal.z, GOAL_WALK);
    }
    this.trail.push(Math.hypot(goal.x - ents.x[e]!, goal.z - ents.z[e]!));
    if (this.trail.length > 2 * TICK_RATE) this.trail.shift();
    if (this.legUntil > 0 || tick - this.asked < THINK) return -1;
    const pressed = mind.stuck[e]! > 0 || mind.pinned[e]! > 0;
    const slow = this.trail.length >= 2 * TICK_RATE && this.trail[0]! - this.trail[this.trail.length - 1]! < 0.25 * this.m.pace;
    if (!pressed && !slow) return -1;
    this.asked = tick;
    return pressed ? 2 : 1;
  }

  still(): boolean {
    return this.legUntil === 0;
  }

  answer(e: number, tick: number, rung: number, ask: Ask): number {
    const ents = this.world.ents, { goal, radius, height, pace } = this.m;
    const x = ents.x[e]!, y = ents.y[e]!, z = ents.z[e]!, facing = (ents.yaw[e]! / 65536) * Math.PI * 2;
    const toGoal = Math.atan2(goal.x - x, goal.z - z), far = this.far, mid = this.mid;
    far.clear(K);
    mid.clear(K);
    far.state[RING_FAR.s.seek] = mid.state[RING_MID.s.seek] = 1;
    far.state[RING_FAR.s.rung] = mid.state[RING_MID.s.rung] = rung / 3;
    far.state[RING_FAR.s.goalSoon] = soon(Math.hypot(goal.x - x, goal.z - z) / pace, 10);
    mid.state[RING_MID.s.pace] = unit(Math.hypot(ents.vx[e]!, ents.vz[e]!), pace);
    mid.state[RING_MID.s.stuck] = this.mind.stuck[e]! > 0 || this.mind.pinned[e]! > 0 ? 1 : 0;
    const fw = RING_FAR.columns.length, mw = RING_MID.columns.length, reach = pace * MID_SECONDS;
    let held = 0, near = 4;
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      const d = Math.abs(((a - facing + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (d < near) [near, held] = [d, i];
      const knee = this.free(x, y + 0.3 * height, z, dx, dz, reach), chest = this.free(x, y + 0.8 * height, z, dx, dz, reach);
      far.rows[i * fw + RING_FAR.c.goal] = Math.cos(a - toGoal);
      far.rows[i * fw + RING_FAR.c.tried] = mid.rows[i * mw + RING_MID.c.tried] = i === this.last && tick - this.lastAt < 5 * TICK_RATE ? 1 : 0;
      mid.rows[i * mw + RING_MID.c.run] = knee / reach;
      mid.rows[i * mw + RING_MID.c.runHigh] = chest / reach;
      mid.rows[i * mw + RING_MID.c.wet] = this.wet(x, z, dx, dz, Math.max(knee, radius));
      if (knee < radius + 0.2) far.mask[i] = mid.mask[i] = 1;
    }
    far.rows[held * fw + RING_FAR.c.held] = mid.rows[held * mw + RING_MID.c.held] = 1;
    const T = ask(RING_MID, mid);
    ask(RING_FAR, far);
    const sum = this.sum;
    sum.clear(K);
    for (let i = 0; i < K; i++) sum.score[i] = far.score[i]!;
    addPass(sum, far, 0);
    addPass(sum, mid, 1);
    return answer("choice", sum, T);
  }

  apply(e: number, tick: number, _rung: number, pick: number): void {
    const ents = this.world.ents, a = (pick / K) * Math.PI * 2, d = this.m.pace * (LEG_TICKS / TICK_RATE);
    this.mind.goTo(e, ents.x[e]! + Math.sin(a) * d, ents.z[e]! + Math.cos(a) * d, GOAL_WALK);
    this.legUntil = tick + LEG_TICKS + TICK_RATE / 2;
    this.last = pick;
    this.lastAt = tick;
  }

  private free(x: number, y: number, z: number, dx: number, dz: number, reach: number): number {
    return castWorld(this.world, x, y, z, dx, 0, dz, reach, true) === 0 ? reach : rayHit.t;
  }

  /** The share of four points along the heading, out to `run`, that stand in water. */
  private wet(x: number, z: number, dx: number, dz: number, run: number): number {
    const hf = this.world.hf;
    let n = 0;
    for (let s = 1; s <= 4; s++) {
      const px = x + (dx * run * s) / 4, pz = z + (dz * run * s) / 4;
      if (hf.waterAt(px, pz) > hf.heightAt(px, pz)) n++;
    }
    return n / 4;
  }
}
