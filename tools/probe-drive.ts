// Prepare the browser drive fixture through normal timed NPC seating before a player can arrive at its door.
import type { Host } from "../server/host.ts";
import { isWheelVehicle } from "../shared/sim/vehicle.ts";
import { RESULT_OK } from "../shared/net/protocol.ts";

export async function prepareDriveProbe(host: Host, advance: (ms: number) => Promise<unknown> = ms => Bun.sleep(ms), id = "core:compact"): Promise<{ car: number; driver: number }> {
  const { x, z } = host.world.spawn, ents = host.world.ents;
  // South is clear acceleration room; the north fixture intentionally holds collision blocks.
  const def = host.world.reg.vehicle[host.world.reg.index.get(id) ?? 0];
  if (!def || !isWheelVehicle(def)) throw new Error(`No road vehicle named ${id}`);
  const seat = def.seats.find(s => s.driver)!;
  const car = host.spawnVehicle(id, x + .35 + seat.entry[0], z - .24 + seat.entry[2], 0, Math.PI);
  if (car < 0) throw new Error(`drive probe could not spawn ${id}`);
  const point = [0, 0, 0], civilian = host.world.reg.index.get("core:civilian")!;
  host.urban.door(car, seat, host.world.reg.move[civilian]!.radius, point);
  const driver = host.spawnCreature("core:civilian", point[0]!, point[2]!, 1);
  if (driver < 0) throw new Error("drive probe could not spawn its driver");
  const entry = host.urban.seatNpc(driver, car);
  if (entry !== RESULT_OK) throw new Error(`drive probe could not start seating the civilian in ${id} (result ${entry})`);
  const actor = ents.pid[driver]!, vehicle = ents.pid[car]!;
  // seatNpc starts a door action, not an immediate seat assignment. A fast browser join otherwise puts its
  // survivor in that entry corridor before commit, correctly cancelling the NPC and hiding the car's use prompt.
  for (let waited = 0; waited <= 2000; waited += 50) {
    if (host.urban.occupancy.occupant(vehicle, "driver") === actor) return { car, driver };
    if (!host.urban.occupancy.pending(actor)) throw new Error("drive probe civilian seat entry was cancelled");
    if (waited < 2000) await advance(50);
  }
  throw new Error("drive probe civilian seat entry timed out");
}
