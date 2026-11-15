// A living creature's hurt stage, as clients see it (hurtStage in shared/anim/pose.ts), kept in its cue word. Not built:
// nothing is set.

import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export interface HurtContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly survival: Survival;
}

export class Hurt {
  readonly ctx: HurtContext;

  constructor(ctx: HurtContext) {
    this.ctx = ctx;
  }

  /** `rec` lost `points` of health to a blow and lived. */
  harmed(rec: EntityRecord, points: number): void {}

  step(tick: number): void {}
}
