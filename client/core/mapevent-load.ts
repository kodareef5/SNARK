// The map events' code comes in a file of its own (mapevent-late.ts), fetched the first time a session is told of an
// event: a survivor on a map where none comes never fetches it. Until it has come, the newest feed (S_MAPEVENT) each
// session was sent is kept here, a copy of its bytes, for the late file to read (mapevent/part.ts).

import { BitReader } from "../../shared/net/codec.ts";
import { S_MAPEVENT } from "../../shared/net/protocol.ts";
import { messages } from "./readers.ts";
import type { ClientSession } from "./session.ts";

/** The most bytes a feed takes: shared/mapevent/wire.ts MAPEVENT_BYTES, which is not read here to keep it out of the first frame. */
export const FEED_MOST = 12 * 1024;

/** The newest feed each session was sent that the late file has not taken. */
const held = new WeakMap<ClientSession, Uint8Array>();
/** The sessions told of an event since they came: what is sent them from then on is kept, empty or not. */
const told = new WeakSet<ClientSession>();
const peek = new BitReader();

/** Whether a feed holds a look or an event, from the head writeMapEvents writes: a flag, then two counts of four bits. */
export function holdsEvents(bytes: Uint8Array): boolean {
  peek.reset(bytes);
  if (!peek.bool()) return false;
  const looks = peek.bits(4);
  const rows = peek.bits(4);
  return !peek.overflow && (looks > 0 || rows > 0);
}

/** Whether `s` has been told of an event, so the late code is wanted. */
export function feedTold(s: ClientSession): boolean {
  return told.has(s);
}

/** The newest feed `s` was sent since the last taken, which is then the taker's; undefined where none has come. */
export function takeFeed(s: ClientSession): Uint8Array | undefined {
  const bytes = held.get(s);
  if (bytes) held.delete(s);
  return bytes;
}

let asked: Promise<unknown> | null = null;

/** The map events' code, fetched once. A fetch that fails may be asked again. */
export function askMapEvents(): Promise<unknown> {
  return (asked ??= import("./mapevent-late.ts").catch((e: unknown) => {
    asked = null;
    throw e;
  }));
}

messages.add({
  kind: S_MAPEVENT,
  read(s, r) {
    const bytes = r.blob(FEED_MOST);
    if (r.overflow) return;
    if (holdsEvents(bytes)) told.add(s);
    else if (!told.has(s)) return;
    held.set(s, bytes);
  },
});
