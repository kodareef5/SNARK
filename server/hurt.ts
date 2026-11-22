// A living creature's hurt stage, as clients see it (hurtStage in shared/anim/pose.ts), kept in its cue word. It is set
// whenever the body's health or the rate it changes at is settled (Survival.onRated: a blow, mending begun, starving,
// burning, a fall) and when a body is made for its record. Between those its health moves at a steady rate, so the tick it
// next crosses a quarter is known: a deadline sets the stage on that tick. Nothing is looked at while nothing changes.
// A survivor has no stage, and a corpse's is its own (CUE_DEAD).

import { CUE_DEAD, CUE_HURT_SHIFT, hurtStage } from "../shared/anim/pose.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export interface HurtContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly survival: Survival;
  readonly deadlines: DeadlineHeap;
}

export class Hurt {
  readonly ctx: HurtContext;
  private readonly survivor: number;
  /** Per pid, the tick its health next crosses a quarter at the rate it has: the one deadline it waits for. */
  private readonly crossing = new Map<number, number>();
  private readonly deadline: number;
  /** Stages looked at, for tests: work counted, not time. */
  checked = 0;

  constructor(ctx: HurtContext) {
    this.ctx = ctx;
    this.survivor = ctx.world.reg.index.get("core:survivor") ?? 0;
    this.deadline = ctx.deadlines.kind("hurt", (pid, stamp) => this.due(pid, stamp));
    ctx.survival.onRated.on((rec) => this.follow(rec));
  }

  /** `rec` lost `points` of health to a blow and lived. */
  harmed(rec: EntityRecord, points: number): void {
    this.check(rec);
  }

  /** A deadline of its kind came due. A stale one does nothing. */
  private due(pid: number, stamp: number): void {
    if (this.crossing.get(pid) !== stamp) return;
    this.crossing.delete(pid);
    const rec = this.ctx.records.byPid.get(pid);
    if (rec) this.follow(rec);
  }

  /** Sets `rec`'s stage for the health it has now, and waits for the tick its health next crosses a quarter. Call when its health, its rate or its body changes. */
  follow(rec: EntityRecord): void {
    const { world, records, deadlines } = this.ctx;
    const v = rec.vitals;
    if (!v || rec.kind === this.survivor) return;
    this.check(rec);
    const max = v.max[V_HEALTH]!;
    const rate = v.rate[V_HEALTH]!;
    const tick = world.tick;
    let at = 0;
    if (rate !== 0 && max > 0 && !rec.dead && records.entOf.has(rec.pid)) {
      const stage = hurtStage(v.at(V_HEALTH, tick), max);
      // No quarter is left to cross once it is whole and mending, or in the last quarter and failing.
      if (rate > 0 ? stage > 0 : stage < 3) {
        const mark = max * (rate > 0 ? 1 - stage * 0.25 : 0.75 - stage * 0.25);
        at = Math.max(tick + 1, tick + Math.floor((mark - v.at(V_HEALTH, tick)) / rate));
        // The division is rounded, so the tick is found exactly: the first on which the stage is another.
        while (at > tick + 1 && hurtStage(v.at(V_HEALTH, at - 1), max) !== stage) at--;
        while (hurtStage(v.at(V_HEALTH, at), max) === stage && at - tick < 1e9) at++;
      }
    }
    if (at === 0) this.crossing.delete(rec.pid);
    else if (this.crossing.get(rec.pid) !== at) {
      this.crossing.set(rec.pid, at);
      deadlines.push(at, this.deadline, rec.pid, at);
    }
  }

  /** Puts a creature's stage for the health it has now in its cue word, if it is not there already. */
  check(rec: EntityRecord): void {
    const { world, records } = this.ctx;
    const v = rec.vitals;
    const e = records.entOf.get(rec.pid);
    if (!v || e === undefined || rec.kind === this.survivor) return;
    this.checked++;
    const word = world.ents.cue[e]!;
    if ((word & CUE_DEAD) !== 0) return;
    const stage = hurtStage(v.at(V_HEALTH, world.tick), v.max[V_HEALTH]!);
    if (((word >>> CUE_HURT_SHIFT) & 3) === stage) return;
    world.ents.cue[e] = (word & ~(3 << CUE_HURT_SHIFT)) | (stage << CUE_HURT_SHIFT);
    world.history.cued(e);
  }
}
