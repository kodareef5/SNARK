// Why the server refused a press of the use key on a seat: getting into or out of a vehicle, or onto or off a creature.
// The server answers one with a result no command asked for (GameServer.notify). Such a result is a seat's when the press
// was made seated, or at a vehicle or a creature, and is worded here under the crosshair; else the structure menu words
// it, as about the built piece the press was at (planning/workstreams/vehicle-boarding.md).

import { RESULT_BUSY, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, RESULT_SHORT, RESULT_TOO_HIGH, RESULT_WAIT } from "../../shared/net/protocol.ts";

/** What a seat is on: a vehicle by how it moves, or a creature. */
export type Ridden = "wheeled" | "rotor" | "boat" | "creature";

/** The words for a seat action the server refused with `code`. None speaks of a PIN: no seat has one. */
export function seatWords(code: number, ridden: Ridden): string {
  if (code === RESULT_WAIT) return ridden === "rotor" ? "Land first" : ridden === "boat" ? "Let the boat stop first" : ridden === "creature" ? "Not yet" : "Wait until it stops";
  if (code === RESULT_FAR) return ridden === "boat" ? "Come alongside to board" : "Too far away";
  if (code === RESULT_TOO_HIGH) return "Too high to climb aboard here";
  if (code === RESULT_NOT_YOURS) return "That is not your tribe's";
  if (code === RESULT_OBSTRUCTED) return "Something is in the way";
  if (code === RESULT_BUSY) return "Someone else is taking that seat";
  if (code === RESULT_SHORT) return "It has no saddle";
  return "You cannot do that now";
}

export class SeatNotice {
  /** Shown under the crosshair until tick() clears it. */
  notice = "";
  private until = 0;
  /** What the last press of the use key was on, or null for anything but a seat. */
  private ridden: Ridden | null = null;

  /** The use key went down: on a seat of `ridden`, or on anything else. */
  pressed(ridden: Ridden | null): void {
    this.ridden = ridden;
  }

  /** A result: true when it answers the last press on a seat, which this then words; false for the structure menu's. */
  result(seq: number, code: number, nowMs: number): boolean {
    if (seq !== 0 || this.ridden === null) return false;
    if (code !== RESULT_OK && code !== RESULT_INVALID) {
      this.notice = seatWords(code, this.ridden);
      this.until = nowMs + 2500;
    }
    return true;
  }

  tick(nowMs: number): void {
    if (this.notice !== "" && nowMs >= this.until) this.notice = "";
  }
}
