// What the use key meets and says at a body the client sees: the prompt under the crosshair, and on a phone the button by
// the thumb (client/core/ui/touch.ts, usePrompt), which is there only while the prompt names the key. The server decides
// every seat (server/urban.ts); this only says what a press would ask for.

import type { Registry } from "../../shared/content/registry.ts";
import { rayVehicle, vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { rayBox } from "../../shared/world/ray.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { RemoteSample } from "./session.ts";
import { remoteVehiclePose } from "./vehicle-view.ts";

const pose: VehicleRenderPose = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0 };
const at = [0, 0, 0];

/**
 * How far along the look `d` (a unit direction from the eye at ox, oy, oz) the use key meets remote body `i`, of scale
 * `size`, or Infinity.
 */
export function lookAt(reg: Registry, r: RemoteSample, i: number, ox: number, oy: number, oz: number, d: ArrayLike<number>, size: number): number {
  const kind = r.kind[i]!, hull = reg.vehicle[kind];
  if (hull?.movement === "boat") return rayVehicle(hull, r.x[i]!, r.y[i]!, r.z[i]!, r.yaw[i]!, ox, oy, oz,
    d[0]!, d[1]!, d[2]!, hull.spec.height, remoteVehiclePose(r, i, pose));
  const radius = reg.bodyRadius[kind]! * size;
  return rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - radius, r.y[i]!, r.z[i]! - radius,
    r.x[i]! + radius, r.y[i]! + reg.bodyHeight[kind]! * size, r.z[i]! + radius);
}

/** The prompt for vehicle `hit` of the sample, seen by a body standing at (ox, oz). */
export function vehiclePrompt(reg: Registry, r: RemoteSample, hit: number, ox: number, oz: number): string {
  const car = reg.vehicle[r.kind[hit]!]!;
  const frame = { ...remoteVehiclePose(r, hit, pose), x: r.x[hit]!, y: r.y[hit]!, z: r.z[hit]!, yaw: r.yaw[hit]! };
  if (car.movement === "boat") {
    vehiclePoint(frame, car.seats[0]!.entry, at);
    if (Math.hypot(ox - at[0]!, oz - at[2]!) > 2) return "Board at the stern";
    for (let slot = 1; slot <= car.seats.length; slot++) {
      let occupied = false;
      for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[hit]! + 1 && r.seatGen[j] === r.gen[hit] && r.seatSlot[j] === slot) occupied = true;
      if (!occupied) return car.seats[slot - 1]!.driver ? "E  take helm" : "E  board as passenger";
    }
    return "Boat full";
  }
  let slot = 0, near = Infinity;
  for (let j = 0; j < car.seats.length; j++) {
    vehiclePoint(frame, car.seats[j]!.entry, at);
    const d = Math.hypot(ox - at[0]!, oz - at[2]!);
    if (d < near) { near = d; slot = j; }
  }
  let occupied = false;
  for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[hit]! + 1 && r.seatGen[j] === r.gen[hit] && r.seatSlot[j] === slot + 1) occupied = true;
  return occupied ? car.seats[slot]!.driver ? "E  carjack driver" : "Passenger seat occupied" : car.seats[slot]!.driver ? "E  enter driver seat" : "E  enter passenger seat";
}
