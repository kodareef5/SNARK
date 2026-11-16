// Statics that travel between two states when used (shared/sim/travel.ts). A static's state is its fixture record's,
// made the first time it is thrown, and every client is sent all of them when it joins and when one is thrown. Nothing is
// done a tick.

import { RESULT_BUSY, RESULT_OK, S_MOTION } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { MAX_TRAVELLING, THROW_TICKS, readTravelBytes, thrown, travelBytes, travelTicks, writeTravels, type TravelState } from "../shared/sim/travel.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The part of a fixture record that holds its static's travel. */
export const TRAVEL_PART = 0x747276;

export class Travel {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly fixtures: Fixtures;
  private readonly game: GameServer;
  private readonly states = new Map<number, TravelState>();
  private readonly told = new WeakMap<Connection, number>();
  private version: number;

  constructor(world: ServerWorld, records: Records, fixtures: Fixtures, game: GameServer) {
    this.world = world;
    this.records = records;
    this.fixtures = fixtures;
    this.game = game;
    fixtures.each((ref, rec) => {
      const b = rec.extra.get(TRAVEL_PART);
      if (b) this.states.set(ref, readTravelBytes(b));
    });
    this.version = this.states.size > 0 ? 1 : 0;
  }

  /** The static at `ref` is thrown: on toward the state it was not going to, from where it stands. A RESULT code. */
  throw(ref: number): number {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    const facet = this.world.reg.travel[t.kind[ref & 0xffff]!]!;
    const was = this.states.get(ref) ?? null;
    const tick = this.world.tick;
    if (was ? tick - was.at < THROW_TICKS : this.states.size >= MAX_TRAVELLING) return RESULT_BUSY;
    const s = thrown(was, travelTicks(facet), tick);
    this.states.set(ref, s);
    const rec = this.fixtures.ensure(ref);
    rec.extra.set(TRAVEL_PART, travelBytes(s));
    this.records.dirty.add(rec.pid);
    this.version++;
    return RESULT_OK;
  }

  get(ref: number): TravelState | null {
    return this.states.get(ref) ?? null;
  }

  /** Tells the client every static's travel, if it has not been told them as they stand. */
  sync(c: Client): void {
    if ((this.told.get(c.conn) ?? 0) === this.version) return;
    writeTravels(this.game.begin(S_MOTION), this.states);
    this.game.endOwn(c);
    this.told.set(c.conn, this.version);
  }
}
