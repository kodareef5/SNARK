// Powered crafting (planning/reference/stations-plan.md, M5): a station with `powered` (the fabricator) makes things only
// while it burns. Progression refuses a job at it while it is out and starts nothing there; this module tells Progression
// when it is lit or goes out. Going out at tick `t`, the fuel run out or turned off, the unit under way waits with the ticks
// it had left at `t` (Job.rest); lit again, it goes on from there and spends nothing more. Both are on the station's own
// record, so a restart in between keeps them (the `progression` component saves `rest`).
//
// ARK's Fabricator page (ark.wiki.gg, read 2026-11-15) says it runs on gasoline and that turning it off uses up the piece
// it was running on; it does not say what becomes of a craft under way. Keeping the progress is the owner's (Decided 3).

import type { Progression } from "./progression.ts";
import type { Stations } from "./stations.ts";
import type { ServerWorld } from "./world.ts";

/** Registers powered crafting on the stations' swap hook. */
export function wirePower(world: ServerWorld, stations: Stations, progression: Progression): void {
  stations.onSwap((rec, t, _from, to) => {
    // The registry may be derived again by a setting, so it is read at each swap.
    const reg = world.reg;
    if (reg.powered[to] !== 1) return;
    if (reg.burning[to] === 1) progression.resume(rec);
    else progression.pause(rec, t);
  });
}
