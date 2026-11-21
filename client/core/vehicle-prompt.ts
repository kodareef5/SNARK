// What the use key meets and says at a body the client sees: the prompt under the crosshair, and on a phone the button by
// the thumb (client/core/ui/touch.ts, usePrompt), which is there only while the prompt names the key. The server decides
// every seat (server/urban.ts) by the same rules: a vehicle is looked at by its hull, and a boat boarded wherever along
// it a body can climb over (shared/sim/boat-boarding.ts).

import type { Registry } from "../../shared/content/registry.ts";
import { BOARD_FAR, BOARD_HIGH, boatBoarding, type BoatBoard } from "../../shared/sim/boat-boarding.ts";
import { rayVehicle, useVehicle, vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { rayBox } from "../../shared/world/ray.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { Ridden } from "./seat-notice.ts";
import type { RemoteSample } from "./session.ts";
import { remoteVehiclePose } from "./vehicle-view.ts";

const pose: VehicleRenderPose = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0 };
const at = [0, 0, 0];
const board: BoatBoard = { x: 0, y: 0, z: 0, top: 0 };

/**
 * How far along the look `d` (a unit direction from the eye at ox, oy, oz) remote body `i`, of scale `size`, is met, or
 * Infinity. With `use`, as the use key meets it: a boat by its whole hull. Else as a name tag or an order does: a boat by
 * its solid parts, so the crew in its open cockpit are seen.
 */
export function lookAt(reg: Registry, r: RemoteSample, i: number, ox: number, oy: number, oz: number, d: ArrayLike<number>, size: number, use = false): number {
  const kind = r.kind[i]!, hull = reg.vehicle[kind];
  if (hull) return (use ? useVehicle : rayVehicleLook)(hull, r.x[i]!, r.y[i]!, r.z[i]!, r.yaw[i]!, ox, oy, oz, d[0]!, d[1]!, d[2]!, remoteVehiclePose(r, i, pose));
  const radius = reg.bodyRadius[kind]! * size;
  return rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, r.x[i]! - radius, r.y[i]!, r.z[i]! - radius,
    r.x[i]! + radius, r.y[i]! + reg.bodyHeight[kind]! * size, r.z[i]! + radius);
}
const rayVehicleLook: typeof useVehicle = (def, x, y, z, yaw, ox, oy, oz, dx, dy, dz, attitude) => rayVehicle(def, x, y, z, yaw, ox, oy, oz, dx, dy, dz, def.spec.height, attitude);

/** What a seat on remote body kind `kind` is on, for the words of a refusal, or null where it is no vehicle and has no saddle. */
export function riddenOf(reg: Registry, kind: number, saddled: boolean): Ridden | null {
  const def = reg.vehicle[kind];
  if (def) return def.movement === "rotor" ? "rotor" : def.movement === "boat" ? "boat" : "wheeled";
  return saddled ? "creature" : null;
}

/**
 * The prompt for vehicle `hit` of the sample, seen by a body with its feet at (ox, oy, oz), `swimming` or not, and the
 * water's surface at `water` there.
 */
export function vehiclePrompt(reg: Registry, r: RemoteSample, hit: number, ox: number, oy: number, oz: number, water: number, swimming: boolean): string {
  const car = reg.vehicle[r.kind[hit]!]!;
  const frame = { ...remoteVehiclePose(r, hit, pose), x: r.x[hit]!, y: r.y[hit]!, z: r.z[hit]!, yaw: r.yaw[hit]! };
  if (car.movement === "boat") {
    // The server also asks that a body out of the water stand on something; a jump beside a boat is not refused here.
    const reach = boatBoarding(car, frame, ox, oy, oz, water, swimming, true, board);
    if (reach === BOARD_FAR) return "Come alongside to board";
    if (reach === BOARD_HIGH) return "Too high to climb aboard here";
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
  const taken = (k: number): boolean => {
    for (let j = 0; j < r.count; j++) if (r.seat[j] === r.id[hit]! + 1 && r.seatGen[j] === r.gen[hit] && r.seatSlot[j] === k + 1) return true;
    return false;
  };
  const door = car.seats[slot]!;
  if (door.driver) return taken(slot) ? "E  carjack driver" : "E  enter driver seat";
  // Passenger seats may share one door, as the bus's do: the server takes the first free one behind it.
  for (let k = 0; k < car.seats.length; k++) {
    const seat = car.seats[k]!;
    if (!seat.driver && seat.door === door.door && seat.entry.every((n, i) => n === door.entry[i]) && !taken(k)) return "E  enter passenger seat";
  }
  return "Passenger seat occupied";
}
