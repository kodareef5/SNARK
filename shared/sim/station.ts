// Nothing steps a fire. burn() takes it from event to event, so a fire nobody read for an hour comes out the same as one
// read every tick. A test compares the two. The server's Hearth is an inventory (server/stations.ts).
//
// At one tick the order is: spoiling settled, cooking finished, each lane's unit finished in content order, then fuel: the
// next piece taken, and what the piece that burnt out leaves (planning/reference/stations-plan.md, M3 and M4).

export interface Fire {
  /** The tick the state is worked out to. */
  at: number;
  /** Ticks left of the fuel now burning. 0 when the next piece must be taken. */
  fuel: number;
  /** Ticks the item now cooking has been over the fire. */
  cook: number;
  /** The item now burning (a content index), 0 or absent for none known: when it burns out the fire gets what it leaves. */
  piece?: number;
  /**
   * What the fire makes by itself (M3), a lane per recipe of the station's that is made by fire, in content order: the item
   * and the ticks its unit has been under way. Absent for a fire that makes nothing by itself.
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
  /** The item the last feed() took, a content index. Without it, nothing burnt leaves anything. */
  fed?(): number;
  /** One piece of `piece` burnt out at tick `t`: the fire gets what it burns into, or nothing if there is no room. */
  burnt?(piece: number, t: number): void;
  /** The ticks the first item waiting to cook takes, or 0 if nothing is waiting. */
  waiting(): number;
  /** Turns that item into its cooked form at tick `t`. Returns false if there is no room, and the item waits. */
  done(t: number): boolean;
  /** The items this fire makes by itself, a lane each, in content order. Without it, none. */
  lanes?(): readonly number[];
  /** The ticks a unit of lane `k` takes, or 0 if its ingredients are not all there. */
  laneNeed?(k: number): number;
  /** Lane `k`'s unit is done at tick `t`: its ingredients are spent and its product made. False if there is no room, and it waits. */
  laneDone?(k: number, t: number): boolean;
}

/** The fire's lanes, one per item it makes, in that order. A lane of an item it no longer makes is dropped. */
function lanesOf(fire: Fire, made: readonly number[]): Lane[] {
  const had = fire.lanes ?? [];
  if (had.length === made.length && had.every((l, k) => l.item === made[k])) return had;
  fire.lanes = made.map((item) => ({ item, ticks: had.find((l) => l.item === item)?.ticks ?? 0 }));
  return fire.lanes;
}

/** Returns the tick the fire went out at, or -1 if it still burns at `now`. Fuel is taken the moment it starts to burn. */
export function burn(fire: Fire, h: Hearth, now: number): number {
  let t = fire.at;
  const made = h.lanes?.() ?? [];
  // A fire that makes nothing by itself keeps no lanes.
  const lanes = made.length > 0 ? lanesOf(fire, made) : [];
  const needs: number[] = lanes.map(() => 0);
  for (;;) {
    h.settle(t);
    // Cooking finishes before anything else at this tick, so fuel running out at the same tick does not undo it.
    const need = h.waiting();
    if (need === 0) fire.cook = 0;
    else if (fire.cook >= need && h.done(t)) {
      fire.cook = 0;
      continue;
    }
    // Then each lane's unit, in content order. One whose ingredients were taken out starts again at nothing; one with no
    // room for its product waits, done.
    let finished = false;
    for (let k = 0; k < lanes.length && !finished; k++) {
      const n = h.laneNeed!(k);
      const lane = lanes[k]!;
      if (n === 0) lane.ticks = 0;
      else if (lane.ticks >= n && h.laneDone!(k, t)) {
        lane.ticks = 0;
        finished = true;
      }
    }
    if (finished) continue;
    if (fire.fuel === 0) {
      // The next piece is taken, then the one that burnt out leaves what it leaves: "the first only appears when the 2nd
      // fuel is consumed" (ark.wiki.gg Charcoal). So a slot the last piece emptied can hold it.
      const was = fire.piece ?? 0;
      const next = h.feed();
      fire.piece = next === 0 ? 0 : (h.fed?.() ?? 0);
      if (was !== 0) h.burnt?.(was, t);
      if (next === 0) {
        fire.at = t;
        return t;
      }
      fire.fuel = next;
    }
    // The fuel taken, or what it left, may be what a lane needs.
    for (let k = 0; k < lanes.length; k++) {
      needs[k] = h.laneNeed!(k);
      if (needs[k] === 0) lanes[k]!.ticks = 0;
    }
    if (t >= now) break;
    // Step to the next event: the fuel ends, the item is cooked, a lane's unit is done, or `now`. A cooked item or a unit
    // with no room waits.
    const toCook = need > 0 && fire.cook < need ? need - fire.cook : Infinity;
    let step = Math.min(fire.fuel, toCook, now - t);
    for (let k = 0; k < lanes.length; k++) if (needs[k]! > 0 && lanes[k]!.ticks < needs[k]!) step = Math.min(step, needs[k]! - lanes[k]!.ticks);
    t += step;
    fire.fuel -= step;
    if (need > 0 && fire.cook < need) fire.cook += step;
    for (let k = 0; k < lanes.length; k++) if (needs[k]! > 0 && lanes[k]!.ticks < needs[k]!) lanes[k]!.ticks += step;
  }
  fire.at = now;
  return -1;
}
