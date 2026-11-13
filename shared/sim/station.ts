// A fire that burns and cooks, worked out from the last time anyone looked.
//
// Nothing steps a fire. Its state is three numbers: the tick it has been
// worked out up to, how long what is burning on it has left, and how long
// the thing waiting to be cooked has been over it. Asked for its state at a
// later tick, it is taken there one event at a time: a piece of fuel is
// used up and the next is taken, or there is none and it goes out; the thing
// over it is done and becomes what it becomes, and the next is put over.
// Between events only time passes.
//
// So a fire nobody watched for an hour and one looked at every tick come to
// exactly the same: what lay on it spoiled when it would have, each thing
// was done at the tick it would have been, and it went out at the tick the
// last of the fuel ran out. A test holds the two against each other.
//
// What lies on the fire is whoever calls this's affair, reached through a
// `Hearth`. The server's is an inventory (server/stations.ts).

export interface Fire {
  /** The tick the fire has been worked out up to. */
  at: number;
  /** Ticks left of the piece of fuel now burning; 0 when the next must be taken. */
  fuel: number;
  /** Ticks the thing now waiting to be cooked has been over the fire. */
  cook: number;
}

export interface Hearth {
  /** Bring what lies on the fire up to tick `t`: things spoil. Called with ticks that never go back. */
  settle(t: number): void;
  /** Take one piece of fuel off the pile: the ticks it burns, or 0 if there is none. */
  feed(): number;
  /** The ticks the first thing waiting to be cooked takes, or 0 if nothing is waiting. */
  waiting(): number;
  /** That thing is done, at tick `t`: make it what it becomes. False if there is no room for that, and it waits. */
  done(t: number): boolean;
}

/**
 * Take a burning fire from where it was worked out to up to tick `now`.
 * Returns the tick it went out at, or -1 if it is still burning at `now`.
 * Fuel is taken at the moment it starts to burn.
 */
export function burn(fire: Fire, h: Hearth, now: number): number {
  let t = fire.at;
  for (;;) {
    h.settle(t);
    // What has had its time is done before anything else at this tick: the fuel running out at the same moment does not undo it.
    const need = h.waiting();
    if (need === 0) fire.cook = 0;
    else if (fire.cook >= need && h.done(t)) {
      // Done, and off the fire: the next thing, if there is one, starts from nothing.
      fire.cook = 0;
      continue;
    }
    if (fire.fuel === 0) {
      const next = h.feed();
      if (next === 0) {
        fire.at = t;
        return t;
      }
      fire.fuel = next;
    }
    if (t >= now) break;
    // To the next thing that happens: the fuel burning ends, the thing over it is done, or now. (Done with no room for it, it waits.)
    const toCook = need > 0 && fire.cook < need ? need - fire.cook : Infinity;
    const step = Math.min(fire.fuel, toCook, now - t);
    t += step;
    fire.fuel -= step;
    if (need > 0 && fire.cook < need) fire.cook += step;
  }
  fire.at = now;
  return -1;
}
