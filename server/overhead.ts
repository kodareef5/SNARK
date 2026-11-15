// What every client draws over a creature that it cannot work out itself: its pair's mating, in the cue word's mating
// bits (shared/anim/pose.ts). Not built: nothing is set.

import type { Breeding } from "./breeding.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export interface OverheadContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly breeding: Breeding;
}

export class Overhead {
  readonly ctx: OverheadContext;

  constructor(ctx: OverheadContext) {
    this.ctx = ctx;
  }

  /** Each tick, after breeding's. */
  step(tick: number): void {}
}
