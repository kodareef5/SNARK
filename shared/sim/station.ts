// Nothing steps a fire. burn() takes it from event to event, so a fire nobody read for an hour comes out the same as one
// read every tick. A test compares the two. The server's Hearth is an inventory (server/stations.ts).

export interface Fire {
  /** The tick the state is worked out to. */
  at: number;
  /** Ticks left of the fuel now burning. 0 when the next piece must be taken. */
  fuel: number;
  /** Ticks the item now cooking has been over the fire. */
  cook: number;
  /**
   * The item now burning (a content index), 0 or absent for none known. Kept and saved, and stepped by nothing until the
   * forge's project (planning/reference/stations-plan.md, S1) leaves what a piece burns into (M4).
   */
  piece?: number;
  /**
   * What the fire is making by itself, a lane per fired recipe under way (M3): the item and the ticks its unit has been
   * under way. Kept and saved, and stepped by nothing until S1.
   */
  lanes?: Lane[];
}

/** One recipe a fire makes by itself (CraftFacet.fired): the item, and the ticks its unit under way has had. */
export interface Lane {
  item: number;
  ticks: number;
}

export interface Hearth {
  /** Spoils the contents up to tick `t`. `t` never goes back. */
  settle(t: number): void;
  /** Takes one piece of fuel. Returns the ticks it burns, or 0 if there is none. */
  feed(): number;
  /** The ticks the first item waiting to cook takes, or 0 if nothing is waiting. */
  waiting(): number;
  /** Turns that item into its cooked form at tick `t`. Returns false if there is no room, and the item waits. */
  done(t: number): boolean;
}

/** Returns the tick the fire went out at, or -1 if it still burns at `now`. Fuel is taken the moment it starts to burn. */
export function burn(fire: Fire, h: Hearth, now: number): number {
  let t = fire.at;
  for (;;) {
    h.settle(t);
    // Cooking finishes before anything else at this tick, so fuel running out at the same tick does not undo it.
    const need = h.waiting();
    if (need === 0) fire.cook = 0;
    else if (fire.cook >= need && h.done(t)) {
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
    // Step to the next event: the fuel ends, the item is cooked, or `now`. A cooked item with no room waits.
    const toCook = need > 0 && fire.cook < need ? need - fire.cook : Infinity;
    const step = Math.min(fire.fuel, toCook, now - t);
    t += step;
    fire.fuel -= step;
    if (need > 0 && fire.cook < need) fire.cook += step;
  }
  fire.at = now;
  return -1;
}
