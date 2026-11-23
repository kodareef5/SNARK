// When a loadout is handed out: to a survivor as it is made, with its tames; again after each death where the loadout
// says so, to one who rises with nothing, without tames, so that deaths make no creatures; and when an admin asks.
// The book says which loadout a role is given (server/loadout/store.ts).

import { CHOOSE_DIED } from "../../shared/net/protocol.ts";
import type { Loadout } from "../../shared/loadout/book.ts";
import { Rng } from "../../shared/rng.ts";
import type { Creative } from "../creative.ts";
import type { Client } from "../game.ts";
import type { Items } from "../items.ts";
import type { EntityRecord, Records } from "../records.ts";
import type { ServerWorld } from "../world.ts";
import { apply, type Applied, type ApplyOptions } from "./apply.ts";
import type { LoadoutStore } from "./store.ts";
import type { TameContext } from "./tame.ts";

export interface LoadoutsContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly items: Items;
  readonly creative: Creative;
  readonly store: LoadoutStore;
  /** What a body's load and gear make of it is worked out again (the host's refreshBody). */
  refresh(rec: EntityRecord): void;
}

export class Loadouts {
  /** Counters: loadouts handed to new survivors, and to the risen. */
  firsts = 0;
  rises = 0;
  readonly store: LoadoutStore;
  private readonly ctx: LoadoutsContext;
  private readonly giving: TameContext;

  constructor(ctx: LoadoutsContext, seed: number) {
    this.ctx = ctx;
    this.store = ctx.store;
    this.giving = { world: ctx.world, records: ctx.records, items: ctx.items, rng: new Rng(seed) };
  }

  /**
   * The loadout the session's role is given, or undefined if the book names one it lacks. The role is the admins' where
   * everyone is given it too: a session has not been given it yet when its first body is made.
   */
  of(c: Client): Loadout | undefined {
    return this.store.assigned(c.admin || this.ctx.creative.forAll);
  }

  /** Hands `loadout` to `rec` now, and its body shows it at once. */
  give(rec: EntityRecord, loadout: Loadout, opts: ApplyOptions = {}): Applied {
    const out = apply(this.giving, rec, loadout, opts);
    this.ctx.refresh(rec);
    return out;
  }

  /** The survivor `rec` of `c` was just made: it is given its role's loadout, tames and all. */
  first(c: Client, rec: EntityRecord): void {
    const loadout = this.of(c);
    if (!loadout || loadout.entries.length === 0) return;
    this.give(rec, loadout, { tames: true });
    this.firsts++;
  }

  /** The survivor `rec` of `c` rose, for the reason `why` (CHOOSE_): after a death, with nothing, it is given a respawn loadout again. */
  risen(c: Client, rec: EntityRecord, why: number): void {
    if (why !== CHOOSE_DIED) return;
    const loadout = this.of(c);
    if (!loadout?.respawn || loadout.entries.length === 0 || this.ctx.items.inv(rec).used() !== 0) return;
    this.give(rec, loadout);
    this.rises++;
  }
}
