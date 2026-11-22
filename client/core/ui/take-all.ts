// Take all (client/core/ui/inventory.ts): every stack of the open box into the bag at one press. A stack is a move, a
// move is a command, and the server takes sixteen commands from a session at a time and runs four a tick
// (server/game.ts COMMAND_QUEUE, COMMANDS_PER_TICK), answering BUSY to what it has no room for and never running it.
// So the moves go a few at a time, each waiting for its answer, and one answered BUSY is asked again: a capsule of
// sixty stacks is emptied in half a second, and none is left behind for want of asking.

import { BOX_OPEN, BOX_SELF, CMD_MOVE, RESULT_BUSY, RESULT_OK } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";

/** Moves asked and not yet answered at the most: half the server's queue, so that the survivor's other commands fit. */
export const TAKE_WINDOW = 8;
/** Ticks to wait after a BUSY before asking again, for the server to work through what it holds. */
export const TAKE_WAIT = 3;

export class TakeAll {
  /** Slots of the open box still to ask for, in order. */
  private todo: number[] = [];
  /** Moves asked and not answered: a command's sequence number to the box's slot and the bag's. */
  private readonly asked = new Map<number, readonly [number, number]>();
  /** Slots of the bag spoken for, which the bag will not show taken until the server has said so. */
  private readonly spoken = new Set<number>();
  /** The tick before which nothing more is asked. */
  private waitUntil = 0;
  /** The box being emptied, as the session holds it: another opened in its place is not this one. */
  private box: object | null = null;

  /** Whether stacks are still being taken. */
  get busy(): boolean {
    return this.todo.length > 0 || this.asked.size > 0;
  }

  /** Begins on everything the open box holds now. Pressed again while it runs, it takes up what has come since. */
  begin(session: ClientSession): void {
    const other = session.open?.inventory;
    if (!other) return;
    if (session.open !== this.box) this.stop();
    this.box = session.open;
    const waiting = new Set([...this.asked.values()].map(([slot]) => slot));
    this.todo = [];
    for (let s = 0; s < other.cap; s++) if (other.item[s] !== 0 && !waiting.has(s)) this.todo.push(s);
    this.update(session);
  }

  stop(): void {
    this.todo = [];
    this.asked.clear();
    this.spoken.clear();
    this.waitUntil = 0;
    this.box = null;
  }

  /** The server's answer to a command, at the session's `tick`: one of these moves done, refused, or not run and to be asked again. */
  result(seq: number, code: number, tick: number): void {
    const move = this.asked.get(seq);
    if (!move) return;
    this.asked.delete(seq);
    if (code === RESULT_OK) return;
    this.spoken.delete(move[1]);
    // Not run for want of room in the queue: it goes back to the head of the line. Anything else is the server's no
    // (the stack is another's by now, or the box has shut), and is not asked twice.
    if (code === RESULT_BUSY) {
      this.todo.unshift(move[0]);
      this.waitUntil = tick + TAKE_WAIT;
    }
  }

  /** Call every frame: asks for as many of the rest as may wait at once. */
  update(session: ClientSession): void {
    if (!this.busy) return;
    const own = session.inventory;
    const other = session.open?.inventory;
    // The box shut (emptied, or she walked off), or another is open in its place: there is nothing more to take from.
    if (!own || !other || session.open !== this.box) return this.stop();
    if (session.tickClock < this.waitUntil) return;
    while (this.todo.length > 0 && this.asked.size < TAKE_WINDOW) {
      const slot = this.todo[0]!;
      const item = other.item[slot]!;
      // Gone already: somebody else took it first.
      if (item === 0) {
        this.todo.shift();
        continue;
      }
      let to = -1;
      for (let s = 0; s < own.bag && to < 0; s++) if (own.item[s] === 0 && !this.spoken.has(s)) to = s;
      // No room in the bag. A slot spoken for may yet come free if its move is refused; with none waiting, that is all she can carry.
      if (to < 0) {
        if (this.asked.size === 0) this.stop();
        return;
      }
      const seq = session.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(slot), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(item)));
      // Nothing can be sent now (the session is not in the world): the rest is hers to ask for again.
      if (seq === 0) return this.stop();
      this.todo.shift();
      this.asked.set(seq, [slot, to]);
      this.spoken.add(to);
    }
    // Everything is asked and answered.
    if (!this.busy) this.stop();
  }
}
