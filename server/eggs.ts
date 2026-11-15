// An egg as an item: taken from where it lies with its genome and hatch time, kept, eaten, and set down again. Not
// built: CMD_TAKE is refused.

import { RESULT_INVALID } from "../shared/net/protocol.ts";
import type { BitReader } from "../shared/net/codec.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export interface EggsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
}

export class Eggs {
  readonly ctx: EggsContext;

  constructor(ctx: EggsContext) {
    this.ctx = ctx;
  }

  /** CMD_TAKE. */
  take(c: Client, r: BitReader): number {
    return RESULT_INVALID;
  }
}
