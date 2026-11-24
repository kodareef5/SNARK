// Owner state: what only a survivor's own session is sent of it (S_OWN), a kind at a time, when it changes. The system a
// kind belongs to registers it on `game.own`, from its own file. Once a tick the game walks the table for each session
// (`syncOwn` in server/own.ts), just before its snapshot.
//
// What a session was last sent is kept in `Client.sent`, by kind. A new connection starts with none of it.
//
// Two kinds are sent outside the table: OWN_SESSION by the game as a session's state changes, and OWN_OVERHEAD by
// server/overhead.ts on its own clock.

import type { BitWriter } from "../shared/net/codec.ts";
import { OWN_BUFFS, OWN_HELD, OWN_LOOK, OWN_MARKERS, OWN_OPEN, OWN_PROGRESSION, OWN_RESPAWN, OWN_RULES, OWN_SLOTS, OWN_STATION, OWN_TRIBE, OWN_VITALS, OWN_VOICE, OWN_XP } from "../shared/net/protocol.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord } from "./records.ts";

/**
 * The order the kinds are sent in within a tick. It is the order they were written in before there was a table, not the
 * order protocol.ts declares them in, and tests compare the bytes. A kind not named here follows these, in protocol.ts's
 * order, so a new kind needs no line here.
 */
const ORDER: readonly number[] = [OWN_LOOK, OWN_VITALS, OWN_SLOTS, OWN_RULES, OWN_VOICE, OWN_TRIBE, OWN_BUFFS, OWN_HELD, OWN_OPEN, OWN_STATION, OWN_MARKERS, OWN_XP, OWN_PROGRESSION, OWN_RESPAWN];

/** A kind that is sent whole whenever its version changes. */
export interface OwnKind<V> {
  readonly kind: number;
  /** What a session sent nothing of this kind is taken to hold. Where it is left out, such a session is sent the kind at once. */
  readonly unsent?: V;
  /** What the session should hold now: a version, or the value itself. It is sent when this is not (`!==`) what it was last sent. `undefined` says there is nothing to send. */
  version(c: Client, rec: EntityRecord): V | undefined;
  /** Writes the kind's fields, after its header. */
  write(w: BitWriter, c: Client, rec: EntityRecord): void;
}

/** Sends a session what changed, and remembers in `c.sent` what it sent. */
export type OwnSync = (c: Client, rec: EntityRecord) => void;

export class OwnState {
  private readonly game: GameServer;
  private readonly kinds: number[] = [];
  private readonly rows: OwnSync[] = [];

  constructor(game: GameServer) {
    this.game = game;
  }

  /** Registers a kind sent whole when its version changes. */
  add<V>(row: OwnKind<V>): void {
    const game = this.game;
    const kind = row.kind;
    this.group(kind, (c, rec) => {
      const now = row.version(c, rec);
      const was = c.sent[kind];
      if (now === undefined || now === (was === undefined ? row.unsent : was)) return;
      row.write(game.beginOwn(kind), c, rec);
      game.endOwn(c);
      c.sent[kind] = now;
    });
  }

  /**
   * Registers kinds that are sent together or that keep more than a version: `sync` sends them itself (`game.beginOwn`,
   * `game.endOwn`) and keeps what it sent in `c.sent`, at the kinds it writes. `kind` is the first of them, which places it.
   */
  group(kind: number, sync: OwnSync): void {
    if (this.kinds.includes(kind)) throw new Error(`owner state ${kind} is registered twice`);
    const rank = place(kind);
    let at = this.kinds.length;
    while (at > 0 && place(this.kinds[at - 1]!) > rank) at--;
    this.kinds.splice(at, 0, kind);
    this.rows.splice(at, 0, sync);
  }

  /** Sends `c` what changed of each kind, in the table's order. `rec` is its survivor. */
  sync(c: Client, rec: EntityRecord): void {
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) rows[i]!(c, rec);
  }
}

function place(kind: number): number {
  const at = ORDER.indexOf(kind);
  return at >= 0 ? at : ORDER.length + kind;
}
