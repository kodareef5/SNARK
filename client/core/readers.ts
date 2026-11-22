// The two tables a session reads the server by: a reader for each kind of server message (S_), and one for each kind of
// owner state (OWN_, the byte after S_OWN). A feature with a message or a kind of its own adds its reader here from its
// own file, and puts what it read on the session. A kind nobody reads is ignored.

import type { BitReader } from "../../shared/net/codec.ts";
import type { ClientSession } from "./session.ts";

export interface Reader {
  readonly kind: number;
  /** Reads from after the kind's byte. One that runs past the end of the message (`r.overflow`) should change nothing. */
  read(session: ClientSession, r: BitReader): void;
}

export class Readers {
  private readonly what: string;
  private readonly rows: (Reader["read"] | undefined)[] = [];

  constructor(what: string) {
    this.what = what;
  }

  add(row: Reader): void {
    if (this.rows[row.kind]) throw new Error(`${this.what} ${row.kind} has two readers`);
    this.rows[row.kind] = row.read;
  }

  /** Whether the kind has a reader, which has then read it. */
  read(kind: number, session: ClientSession, r: BitReader): boolean {
    const read = this.rows[kind];
    if (!read) return false;
    read(session, r);
    return true;
  }
}

export const messages = new Readers("server message");
export const ownKinds = new Readers("owner state");
