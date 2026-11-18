// Native development fixtures; no renderer, asset build or alternate world.
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { VEHICLE_ORIGIN, vehiclePlaceFree } from "../../server/vehicle-service.ts";
import type { Host } from "../../server/host.ts";
import { PROVING_ID } from "../../shared/world/proving.ts";
import { Found } from "../../shared/world/structures.ts";

/** Native structure chunks persist the strips. completeExisting repairs a partially seeded development fixture. */
export function seedUrbanRoads(host: Host, completeExisting = false): number {
  const { world } = host;
  if (world.mapId !== PROVING_ID) return 0;
  const kinds = ["asphalt", "gravel", "mud"].map(name => world.reg.index.get(`core:road_${name}`)!);
  if (!completeExisting && world.structs.chunks.some(row => row && row.kind.subarray(0, row.high).some(kind => kinds.includes(kind)))) return 0;
  const found = new Found(); let added = 0;
  for (let lane = 0; lane < kinds.length; lane++) for (let tile = 0; tile < 12; tile++) for (const side of [-1.5, 1.5]) {
    const x = world.spawn.x + 12 + lane * 9 + side, z = world.spawn.z - 6 - tile * 3, y = world.hf.heightAt(x, z);
    // The spatial query returns broadphase candidates, including adjacent nonoverlapping tiles.
    const count = world.structs.query(x - 1.49, z - 1.49, x + 1.49, z + 1.49, found, y - .1, y + .2);
    let occupied = false;
    for (let i = 0; i < count; i++) {
      const ref = found.refs[i]!, row = world.structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535, kind = row.kind[slot]!;
      const angle = row.yaw[slot]! * Math.PI * 2 / 65536, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
      const hx = world.structs.halfXOf(kind), hz = world.structs.halfZOf(kind);
      if (Math.abs(row.x[slot]! - x) < 1.49 + c * hx + s * hz && Math.abs(row.z[slot]! - z) < 1.49 + s * hx + c * hz) { occupied = true; break; }
    }
    if (occupied || [-1.5, 1.5].some(dx => [-1.5, 1.5].some(dz => Math.abs(world.hf.heightAt(x + dx, z + dz) - y) > .02))) continue;
    if (world.structs.add(kinds[lane]!, x, y + 1 / 32, z, 0, 0, 1500) >= 0) added++;
  }
  return added;
}

/** A pair of bays per road frame, facing the spawn. A persisted model keeps its bay identity after being driven away. */
export function seedRoadFleet(host: Host): number {
  const { world, records } = host;
  const placed = new Set<string>(), decoder = new TextDecoder();
  for (const rec of records.byPid.values()) {
    const origin = rec.extra.get(VEHICLE_ORIGIN);
    if (origin) placed.add(decoder.decode(origin));
  }
  let added = 0;
  for (const [i, model] of ROAD_FLEET.entries()) {
    const origin = `fleet/${model.id}`;
    if (placed.has(origin)) continue;
    const definition = world.reg.vehicle[world.reg.index.get(model.id)!]!;
    // Keep the original six bays stable in existing saves. The patrol pair park in front. The tanker, longer than a car,
    // keeps the bay east of the six where it was first parked.
    const tanker = model.id === "core:tanker";
    const front = model.id === "core:patrol_sedan" || model.id === "core:patrol_jeep";
    const x = world.spawn.x + (tanker ? 3.5 : front ? i - 6.5 : i - 2.5) * 4.5;
    const z = world.spawn.z + (front ? 3.1 : 9), y = world.hf.heightAt(x, z), yaw = Math.PI;
    const e = vehiclePlaceFree(world, x, y, z, yaw, definition) ? host.spawnVehicle(model.id, x, z, 0, yaw, { origin }) : -1;
    if (e < 0)
      throw new Error(`The fleet bay for ${model.id} is obstructed at (${x}, ${z})`);
    if (model.id === "core:patrol_sedan") host.urban.setLightMode(e, 1);
    if (model.id === "core:patrol_jeep") host.urban.setLightMode(e, 2);
    added++;
  }
  return added;
}
