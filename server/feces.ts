// Creatures defecate now and then, leaving their species' feces item, and a female dodo now and then lays an
// unfertilised egg in its place (SpeciesDef.feces and eggChance). Not built: these are the places the host calls.

import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { Items } from "./items.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_FECES = 11;

export interface FecesContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly deadlines: DeadlineHeap;
  readonly rules: Rules;
}

export class Feces {
  readonly ctx: FecesContext;
  readonly seed: number;

  constructor(ctx: FecesContext, seed: number) {
    this.ctx = ctx;
    this.seed = seed;
  }

  /** A DEADLINE_FECES entry came due. */
  due(pid: number, stamp: number): void {}

  /** Each tick, after breeding's. */
  step(tick: number): void {}
}
