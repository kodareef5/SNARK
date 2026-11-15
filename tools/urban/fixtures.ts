// Native development fixtures; no renderer, asset build or alternate world.
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
