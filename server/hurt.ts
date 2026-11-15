// A living creature's hurt stage, as clients see it (hurtStage in shared/anim/pose.ts), kept in its cue word. A blow sets
// it at once. Whatever else moves health, mending, starving, burning, a fall, is found by a sweep that looks at every
// record once in SWEEP_TICKS, a slice each tick. A survivor has no stage, and a corpse's is its own (CUE_DEAD).

import { CUE_DEAD, CUE_HURT_SHIFT, hurtStage } from "../shared/anim/pose.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

/** Ticks in which every record is looked at once. */
export const SWEEP_TICKS = 3 * TICK_RATE;

export interface HurtContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly survival: Survival;
}

export class Hurt {
  readonly ctx: HurtContext;
  private readonly survivor: number;
  private sweep: Iterator<EntityRecord> | null = null;

  constructor(ctx: HurtContext) {
    this.ctx = ctx;
    this.survivor = ctx.world.reg.index.get("core:survivor") ?? 0;
  }

  /** `rec` lost `points` of health to a blow and lived. */
  harmed(rec: EntityRecord, points: number): void {
    this.check(rec);
  }

  step(tick: number): void {
    const all = this.ctx.records.byPid;
    for (let n = Math.ceil(all.size / SWEEP_TICKS); n > 0; n--) {
      const next = (this.sweep ??= all.values()).next();
      if (next.done) {
        this.sweep = null;
        return;
      }
      this.check(next.value);
    }
  }

  /** Puts a creature's stage for the health it has now in its cue word, if it is not there already. */
  check(rec: EntityRecord): void {
    const { world, records } = this.ctx;
    const v = rec.vitals;
    const e = records.entOf.get(rec.pid);
    if (!v || e === undefined || rec.kind === this.survivor) return;
    const word = world.ents.cue[e]!;
    if ((word & CUE_DEAD) !== 0) return;
    const stage = hurtStage(v.at(V_HEALTH, world.tick), v.max[V_HEALTH]!);
    if (((word >>> CUE_HURT_SHIFT) & 3) === stage) return;
    world.ents.cue[e] = (word & ~(3 << CUE_HURT_SHIFT)) | (stage << CUE_HURT_SHIFT);
    world.history.cued(e);
  }
}
