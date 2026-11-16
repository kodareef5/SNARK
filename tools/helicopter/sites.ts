// Contextual found aircraft. The map author supplies sites; physical placement always uses the playable world geometry.
import type { Registry } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";
import { chunkAt } from "../../shared/coords.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { helicopterPlacement } from "../../shared/world/helicopter.ts";
import { mapHeightfield, mapNodes, placeStatics, type MapData, type MapVehicle } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";

export interface HelicopterSite { id: string; kind: "hospital" | "police" | "civilian"; x: number; z: number; radius: number }
const TYPES = { hospital: "core:helicopter_rescue", police: "core:helicopter_police", civilian: "core:helicopter" } as const;

/** Stable sparse placements, with persistent condition ranges consumed once by the host's normal parked-vehicle path. */
export function helicopterSites(map: MapData, reg: Registry, sites: readonly HelicopterSite[], limit = 12): MapVehicle[] {
  const hf = mapHeightfield(map), structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const source = mapNodes(map, hf, reg), nodes = source ? new NodeField(map.dims, reg, source) : null;
  const world: CollisionWorld = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) }, found: MapVehicle[] = [];
  const order = [...sites].sort((a, b) => hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
  const counts = { hospital: 0, police: 0, civilian: 0 };
  for (const site of order) {
    if (found.length >= limit) break;
    if (counts[site.kind] >= 4 || found.some(v => Math.hypot(v.x - site.x, v.z - site.z) < 250)) continue;
    const kind = TYPES[site.kind], def = reg.vehicle[reg.index.get(kind)!];
    if (def?.movement !== "rotor") continue;
    const yaw = (hashString(site.id, 453) & 3) * Math.PI / 2;
    // Try a complete rooftop first, then nearby yards. Holes, slopes, water, trees and rotor/tail obstructions reject it.
    const candidates: [number, number][] = [[site.x, site.z]];
    for (const radius of [Math.max(12, site.radius + 8), Math.max(24, site.radius + 18)]) for (let k = 0; k < 8; k++) candidates.push([site.x + Math.cos(k * Math.PI / 4) * radius, site.z + Math.sin(k * Math.PI / 4) * radius]);
    for (const [x, z] of candidates) {
      if (x < 8 || z < 8 || x > hf.sizeX - 8 || z > hf.sizeZ - 8) continue;
      const chunk = chunkAt(map.dims, x, z); nodes?.retain(chunk, 1, 1, () => false);
      try {
        const top = hf.heightAt(x, z) + 180;
        if (castWorld(world, x, top, z, 0, -1, 0, 200) === HIT_NONE) continue;
        const y = top - rayHit.t;
        if (!helicopterPlacement(world, x, y, z, yaw, def)) continue;
        found.push({ id: `helicopter/${site.id}`, kind, x, y, z, yaw: Math.round(yaw * 65536 / (Math.PI * 2)) & 65535, condition: [.28, .88], fuel: [.08, .55] });
        counts[site.kind]++; break;
      } finally { nodes?.retain(chunk, 1, -1, () => false); }
    }
  }
  return found;
}
