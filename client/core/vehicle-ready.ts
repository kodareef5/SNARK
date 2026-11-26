// Whether a vehicle the client sees is worth walking to: one that would start and has a seat for the viewer. Everything
// it reads is in the snapshot, so the server sends nothing for it. The scene marks these for a moment (shimmer.ts).

import { CUE_DEAD } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { isSkateboard } from "../../shared/sim/vehicle.ts";
import { vehicleWouldRun } from "../../shared/sim/vehicle-presentation.ts";
import type { RemoteSample } from "./session.ts";

/** A bit of the replicated entity flags: a prop, as a destroyed vehicle's wreck is. */
const VIEW_FLAG_PROP = 8;

/**
 * Whether remote body `i` is a vehicle a viewer of tribe `team` could board and drive off: alive and no wreck, with fuel,
 * an engine and a hull that run, a seat free, and nobody's or the viewer's tribe's. Another tribe's is never marked,
 * whatever the server's rules would let be done with it.
 */
export function usableVehicle(reg: Registry, r: RemoteSample, i: number, team: number, occupied?: number): boolean {
  const def = reg.vehicle[r.kind[i]!];
  if (!def || isSkateboard(def)) return false;
  if ((r.flags[i]! & VIEW_FLAG_PROP) !== 0 || (r.cue[i]! & CUE_DEAD) !== 0) return false;
  if (r.team[i] !== 0 && (team === 0 || r.team[i] !== team)) return false;
  if (!vehicleWouldRun(r.vehicleFuel[i]!, r.vehicleEngineCondition[i]!, r.vehicleBoat[i] ? r.vehicleHullCondition[i]! : 1, r.vehicleBoat[i] ? r.vehicleFlooding[i]! : 0)) return false;
  if (occupied !== undefined) return occupied < def.seats.length;
  let taken = 0;
  for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[i]! + 1 && r.seatGen[j] === r.gen[i] && r.seatSlot[j] !== 0) taken++;
  return taken < def.seats.length;
}
