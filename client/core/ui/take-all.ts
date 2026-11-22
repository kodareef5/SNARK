// Take all (client/core/ui/inventory.ts): every stack of the open box into the bag at one press. A stack is a move, a
// move is a command, and the server takes sixteen commands from a session at a time and runs four a tick
// (server/game.ts COMMAND_QUEUE, COMMANDS_PER_TICK), answering BUSY to what it has no room for and never running it.
// So the moves go a few at a time, each waiting for its answer, and one answered BUSY is asked again: a capsule of
// sixty stacks is emptied in half a second, and none is left behind for want of asking.
//
// A press is a job, and a job holds nothing once it is done. While it runs it keeps three things: the slots of the box
// still to ask for, the moves asked and not answered, and the slots of the bag those moves were sent to, which the bag
// does not show taken until the server's word of it arrives. All three are let go when the last answer is in, when the
// box shuts or is another, and at a press that finds no job running, so that a second press on a box still open starts
// from the bag as it is.

import { TICK_RATE } from "../../../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, RESULT_BUSY, RESULT_OK } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";

/** Moves asked and not yet answered at the most: half the server's queue, so that the survivor's other commands fit. */
export const TAKE_WINDOW = 8;
/** Ticks to wait after a BUSY before asking again, for the server to work through what it holds. */
export const TAKE_WAIT = 3;
/** Ticks a move waits for its answer before it is let go and asked again: answers come in a tick or two, so this is one that is lost. */
export const TAKE_PATIENCE = 4 * TICK_RATE;

interface Asked {
  /** The box's slot, the bag's, and the tick it was asked at. */
  readonly slot: number;
  readonly to: number;
  readonly at: number;
}

export class TakeAll {
  /** Slots of the open box still to ask for, in order. */
  private todo: number[] = [];
  /** Moves asked and not answered, by their command's sequence number. */
  private readonly asked = new Map<number, Asked>();
  /** Slots of the bag whose move the server has made and whose stack the bag does not yet show. */
  private readonly landing = new Set<number>();
  /** The tick before which nothing more is asked. */
  private waitUntil = 0;
  /** The box being emptied, as the session holds it: another opened in its place is not this one. */
  private box: object | null = null;

  /** Whether stacks are still being taken. */
  get busy(): boolean {
    return this.todo.length > 0 || this.asked.size > 0;
  }

  /**
   * A press: begins on everything the open box holds now. With no job running it starts clean, whatever an earlier
   * press took. Pressed while one runs, it takes up what has come to the box since, and the moves still waiting for
   * their answers keep their slots of the bag.
   */
  begin(session: ClientSession): void {
    const other = session.open?.inventory;
    if (!other) return;
    if (!this.busy || session.open !== this.box) this.stop();
    this.box = session.open;
    const waiting = new Set([...this.asked.values()].map((m) => m.slot));
    this.todo = [];
    for (let s = 0; s < other.cap; s++) if (other.item[s] !== 0 && !waiting.has(s)) this.todo.push(s);
    this.update(session);
  }

  stop(): void {
    this.todo = [];
    this.asked.clear();
    this.landing.clear();
    this.waitUntil = 0;
    this.box = null;
  }

  /** The server's answer to a command, at the session's `tick`: one of these moves done, refused, or not run and to be asked again. */
  result(seq: number, code: number, tick: number): void {
    const move = this.asked.get(seq);
    if (!move) return;
    this.asked.delete(seq);
    // Done: its slot of the bag is the stack's, which the bag shows when the server's word of it arrives.
    if (code === RESULT_OK) this.landing.add(move.to);
    // Not run for want of room in the queue: it goes back to the head of the line. Anything else is the server's no
    // (the stack is another's by now, or the box has shut), and is not asked twice.
    else if (code === RESULT_BUSY) {
      this.todo.unshift(move.slot);
      this.waitUntil = tick + TAKE_WAIT;
    }
    // The last answer of the job: nothing of it is kept.
    if (!this.busy) this.stop();
  }

  /** Whether a slot of the bag is free for a stack: empty, and not the place of a move asked or just made. */
  private free(own: { item: ArrayLike<number> }, s: number): boolean {
    if (own.item[s] !== 0) return false;
    if (this.landing.has(s)) return false;
    for (const m of this.asked.values()) if (m.to === s) return false;
    return true;
  }

  /** Call every frame: asks for as many of the rest as may wait at once. */
  update(session: ClientSession): void {
    if (!this.busy) return;
    const own = session.inventory;
    const other = session.open?.inventory;
    // The box shut (emptied, or she walked off), or another is open in its place: there is nothing more to take from.
    if (!own || !other || session.open !== this.box) return this.stop();
    const tick = session.tickClock;
    // A stack the bag now shows has landed: its slot is the bag's own to tell of from here on.
    for (const s of this.landing) if (own.item[s] !== 0) this.landing.delete(s);
    // An answer that has not come in seconds is not coming. The move is asked again; if it was made after all, its slot
    // of the box is empty by then and is passed over.
    for (const [seq, m] of this.asked) {
      if (tick - m.at <= TAKE_PATIENCE) continue;
      this.asked.delete(seq);
      this.todo.unshift(m.slot);
    }
    if (tick < this.waitUntil) return;
    while (this.todo.length > 0 && this.asked.size < TAKE_WINDOW) {
      const slot = this.todo[0]!;
      const item = other.item[slot]!;
      // Gone already: somebody else took it first.
      if (item === 0) {
        this.todo.shift();
        continue;
      }
      let to = -1;
      for (let s = 0; s < own.bag && to < 0; s++) if (this.free(own, s)) to = s;
      // No room in the bag. A slot spoken for may yet come free if its move is refused; with none waiting, that is all she can carry.
      if (to < 0) {
        if (this.asked.size === 0) this.stop();
        return;
      }
      const seq = session.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(slot), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(item)));
      // Nothing can be sent now (the session is not in the world): the rest is hers to ask for again.
      if (seq === 0) return this.stop();
      this.todo.shift();
      this.asked.set(seq, { slot, to, at: tick });
    }
    // Everything is asked and answered.
    if (!this.busy) this.stop();
  }
}
