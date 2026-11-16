// Prepare the browser drive fixture through normal timed NPC seating before a player can arrive at its door.
import type { Host } from "../server/host.ts";
import { RESULT_OK } from "../shared/net/protocol.ts";

export async function prepareDriveProbe(host: Host, advance: (ms: number) => Promise<unknown> = ms => Bun.sleep(ms)): Promise<{ car: number; driver: number }> {
  const { x, z } = host.world.spawn, ents = host.world.ents;
  // South is clear acceleration room; the north fixture intentionally holds collision blocks.
  const car = host.spawnVehicle("core:compact", x + 1.6, z - .12, 0, Math.PI);
  const driver = host.spawnCreature("core:civilian", x + .35, z - .24, 1);
  if (car < 0 || driver < 0 || host.urban.seatNpc(driver, car) !== RESULT_OK) throw new Error("drive probe could not start seating the civilian");
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
