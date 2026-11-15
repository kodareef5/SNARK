// A creature's body lies where it fell, is harvested with a tool, decays and is gone. Not built: a body still leaves the
// world as it dies, and these are the places the host calls.

import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import type { GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_CORPSE = 10;

export interface CorpsesContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly deadlines: DeadlineHeap;
  readonly rules: Rules;
}

export class Corpses {
  readonly ctx: CorpsesContext;
  readonly seed: number;

  constructor(ctx: CorpsesContext, seed: number) {
    this.ctx = ctx;
    this.seed = seed;
  }

  /** `rec` died of `cause` (a CAUSE_ of server/survival.ts), struck last by `by` (a pid, or 0). Its body is still in the world. */
  fell(rec: EntityRecord, cause: number, by: number): void {}

  /** A DEADLINE_CORPSE entry came due. */
  due(pid: number, stamp: number): void {}

  step(tick: number): void {}
}
