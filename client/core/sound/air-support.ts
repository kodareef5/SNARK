import { AIR_PHASE, type AirSupportView } from "../../../shared/sim/air-support.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import type { Hear } from "./bodies.ts";
import type { Place } from "./vehicles.ts";

const ROTOR = cueKey("engine/mid"),
  TURBINE = cueKey("engine/high"),
  WASH = cueKey("vehicle/wash");
const TOUCH = cueKey("supply/land"),
  LATCH = cueKey("supply/open"),
  FAN = cueKey("supply/jet");

export class AirSounds {
  private last: AirSupportView | null = null;
  private readonly phases = new Map<number, number>();
  private readonly open = new Map<number, number>();

  update(view: AirSupportView, helicopter: number, machinery: number, hear: Hear, place: Place): void {
    const changed = this.last !== view;
    if (changed) {
      this.phases.clear();
      this.open.clear();
      if (this.last) {
        for (const row of this.last.carriers) this.phases.set(row.id, row.phase);
        for (const row of this.last.pods) this.open.set(row.id, row.open);
      }
      this.last = view;
    }
    for (const row of view.carriers) {
      const base = -1 - row.id * 4;
      const busy = row.phase === AIR_PHASE.lower || row.phase === AIR_PHASE.release;
      place(base, helicopter, ROTOR, row.x, row.y + 4, row.z, busy ? 0.95 : 0.7, true, false);
      place(base - 1, helicopter, TURBINE, row.x, row.y + 4, row.z, busy ? 0.28 : 0.48, true, false);
      if (busy) place(base - 2, helicopter, WASH, row.x, row.y, row.z, 0.52, true, false);
      if (changed && row.phase === AIR_PHASE.release && this.phases.get(row.id) === AIR_PHASE.lower)
        hear(machinery, TOUCH, -1, row.x, row.y, row.z, 0, 0.85, false);
    }
    for (const row of view.drones) {
      place(-4 - row.id * 4, machinery, FAN, row.x, row.y, row.z, 0.32, true, false);
    }
    if (!changed) return;
    for (const row of view.pods) {
      const before = this.open.get(row.id);
      if (before !== undefined && ((before === 0 && row.open > 0) || (before > 0 && row.open === 0)))
        hear(machinery, LATCH, -1, row.x, row.y + 1, row.z, 0, 0.65, false);
    }
  }
}
