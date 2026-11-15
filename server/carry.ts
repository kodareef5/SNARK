// A survivor picks a small creature up in both arms, holds it and throws it. Not built: CMD_CARRY is refused, and these
// are the places the host calls. A held creature has F_HELD, which the creature tick skips, and CUE_HELD for clients.

import { RESULT_INVALID } from "../shared/net/protocol.ts";
import type { BitReader } from "../shared/net/codec.ts";
import type { Creatures } from "./creatures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export interface CarryContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly creatures: Creatures;
}

export class Carry {
  readonly ctx: CarryContext;

  constructor(ctx: CarryContext) {
    this.ctx = ctx;
  }

  /** CMD_CARRY. */
  command(c: Client, r: BitReader): number {
    return RESULT_INVALID;
  }

  /** Each tick, after riders move with their mounts and before combat aims. */
  step(tick: number): void {}
}
