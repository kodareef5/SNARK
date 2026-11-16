// Statics that move between two states when used (shared/sim/motion.ts). A static's state is its fixture record's,
// made the first time it is thrown, and every client is sent all of them when it joins and when one is thrown. Nothing is
// done a tick.

import { RESULT_BUSY, RESULT_OK, S_MOTION } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { MAX_MOVING, THROW_TICKS, motionBytes, motionTicks, readMotionBytes, thrown, writeMotions, type MotionState } from "../shared/sim/motion.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The part of a fixture record that holds its static's motion. */
export const MOTION_PART = 0x6d6f74;

export class Motion {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly fixtures: Fixtures;
  private readonly game: GameServer;
  private readonly states = new Map<number, MotionState>();
  private readonly told = new WeakMap<Connection, number>();
  private version: number;

  constructor(world: ServerWorld, records: Records, fixtures: Fixtures, game: GameServer) {
    this.world = world;
    this.records = records;
    this.fixtures = fixtures;
    this.game = game;
    fixtures.each((ref, rec) => {
      const b = rec.extra.get(MOTION_PART);
      if (b) this.states.set(ref, readMotionBytes(b));
    });
    this.version = this.states.size > 0 ? 1 : 0;
  }

  /** The static at `ref` is thrown: on toward the state it was not going to, from where it stands. A RESULT code. */
  throw(ref: number): number {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    const facet = this.world.reg.motion[t.kind[ref & 0xffff]!]!;
    const was = this.states.get(ref) ?? null;
    const tick = this.world.tick;
    if (was ? tick - was.at < THROW_TICKS : this.states.size >= MAX_MOVING) return RESULT_BUSY;
    const s = thrown(was, motionTicks(facet), tick);
    this.states.set(ref, s);
    const rec = this.fixtures.ensure(ref);
    rec.extra.set(MOTION_PART, motionBytes(s));
    this.records.dirty.add(rec.pid);
    this.version++;
    return RESULT_OK;
  }

  get(ref: number): MotionState | null {
    return this.states.get(ref) ?? null;
  }

  /** Tells the client every moving static's state, if it has not been told them as they stand. */
  sync(c: Client): void {
    if ((this.told.get(c.conn) ?? 0) === this.version) return;
    writeMotions(this.game.begin(S_MOTION), this.states);
    this.game.endOwn(c);
    this.told.set(c.conn, this.version);
  }
}
