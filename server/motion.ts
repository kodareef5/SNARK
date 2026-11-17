// Statics that move between two states when used (shared/sim/motion.ts). A static's state is its fixture record's,
// made the first time it is thrown. A client is sent every state when it joins, and then each static as it is thrown.
// Nothing is done a tick.

import { RESULT_BUSY, RESULT_OK, S_MOTION } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { MAX_MOVING, THROW_TICKS, motionBytes, motionTicks, readMotionBytes, thrown, writeMotions, type MotionState } from "../shared/sim/motion.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** The part of a fixture record that holds its static's motion. */
export const MOTION_PART = 0x6d6f74;
/** Throws remembered for the clients not yet told of them. One further behind is told every state again. */
const THROWS_KEPT = 1024;

export class Motion {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly fixtures: Fixtures;
  private readonly game: GameServer;
  private readonly states = new Map<number, MotionState>();
  /** The statics thrown, in order, the first of them the `base`-th throw since the start. */
  private readonly throws: number[] = [];
  private base = 0;
  /** By connection, the throws it has been told of. */
  private readonly told = new WeakMap<Connection, number>();

  constructor(world: ServerWorld, records: Records, fixtures: Fixtures, game: GameServer) {
    this.world = world;
    this.records = records;
    this.fixtures = fixtures;
    this.game = game;
    fixtures.each((ref, rec) => {
      const b = rec.extra.get(MOTION_PART);
      if (b) this.states.set(ref, readMotionBytes(b));
    });
  }

  /** The static at `ref` is thrown: on toward the state it was not going to, from where it stands. A RESULT code. */
  throw(ref: number): number {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    const facet = this.world.reg.motion[t.kind[ref & 0xffff]!]!;
    const was = this.states.get(ref) ?? null;
    const tick = this.world.tick;
    if (was && tick - was.at < THROW_TICKS) return RESULT_BUSY;
    const s = thrown(was, motionTicks(facet), tick);
    this.states.set(ref, s);
    const rec = this.fixtures.ensure(ref);
    rec.extra.set(MOTION_PART, motionBytes(s));
    this.records.dirty.add(rec.pid);
    if (this.throws.length === THROWS_KEPT) {
      this.throws.splice(0, THROWS_KEPT / 2);
      this.base += THROWS_KEPT / 2;
    }
    this.throws.push(ref);
    return RESULT_OK;
  }

  get(ref: number): MotionState | null {
    return this.states.get(ref) ?? null;
  }

  /** Tells the client the states it has not been told as they stand: every one after its welcome, then those thrown since. */
  sync(c: Client): void {
    const told = this.told.get(c.conn);
    const now = this.base + this.throws.length;
    if (told === now) return;
    const refs = told === undefined || told < this.base ? [...this.states.keys()] : [...new Set(this.throws.slice(told - this.base))];
    for (let i = 0; i < refs.length; i += MAX_MOVING) {
      writeMotions(this.game.begin(S_MOTION), this.states, refs.slice(i, i + MAX_MOVING));
      this.game.endOwn(c);
    }
    this.told.set(c.conn, now);
  }
}
