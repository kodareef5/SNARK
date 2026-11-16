// Found boats belong to mapped waterfront places. Search the finished geometry; never carve a berth or move the sea.
import type { Registry } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { hashString } from "../../shared/hash.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { boatPlacement } from "../../shared/world/boat.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../../shared/world/collide.ts";
import { mapHeightfield, mapNodes, placeStatics, type MapData, type MapVehicle } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { BuildingLabel, PublicPlace } from "../mapworld/labels.ts";

export interface BoatSite { id: string; kind: "civilian" | "rescue" | "police"; x: number; z: number; radius: number }
const TYPES = { civilian: "core:boat", rescue: "core:boat_rescue", police: "core:boat_police" } as const;

/** Only direct source labels enter this list. A Coast Guard station is an authored rescue site, not a guessed POI API. */
export function mappedBoatSites(places: readonly PublicPlace[], labels: Readonly<Record<string, BuildingLabel>>, toEngine: (e: number, n: number) => [number, number]): BoatSite[] {
  const result: BoatSite[] = [];
  for (const p of places) {
    const kind = p.kind === "marina" || p.kind === "pier" ? "civilian" : p.kind === "beach" ? "rescue" : null;
    if (!kind) continue;
    const [x, z] = toEngine(p.e, p.n);
    result.push({ id: `place/${p.kind}/${p.name ?? "unnamed"}@${p.e},${p.n}`, kind, x, z, radius: p.kind === "marina" ? 120 : 48 });
  }
  for (const [id, p] of Object.entries(labels)) {
    const kind = p.kind === "police_station" ? "police" : p.kind === "fire_station" || /coast guard station/i.test(p.name ?? "") ? "rescue" : null;
    if (!kind) continue;
    const [x, z] = toEngine(p.e, p.n);
    result.push({ id: `building/${id}`, kind, x, z, radius: 200 });
  }
  return result;
}

/** A swimmer can reach a nearby bank without crossing a wall or an abrupt rise in the terrain. */
function shoreAccess(world: CollisionWorld, x: number, z: number): boolean {
  const hf = world.hf, water = hf.waterAt(x, z);
  for (let side = 0; side < 16; side++) {
    const nx = Math.sin(side * Math.PI / 8), nz = Math.cos(side * Math.PI / 8);
    let previous = water - 1.35;
    for (let distance = 2; distance <= 64; distance += 2) {
      const px = x + nx * distance, pz = z + nz * distance;
      if (px < 2 || pz < 2 || px >= hf.sizeX - 2 || pz >= hf.sizeZ - 2 || hf.waterAt(px, pz) !== water) break;
      const ground = groundUnder(hf, px, pz, .3), y = Math.max(ground, water - 1.35);
      if (y - previous > 1.4 || !capsuleFree(world, px, y + .02, pz, .3, 1.8)) break;
      if (ground >= water - .35 && hf.slopeCosAt(px, pz) > .7) return true;
      previous = y;
    }
  }
  return false;
}

/** Sparse stable records. The host rolls condition once and persistence prevents destroyed boats from respawning. */
export function boatSites(map: MapData, reg: Registry, sites: readonly BoatSite[], limit = 18): MapVehicle[] {
  const hf = mapHeightfield(map), structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const source = mapNodes(map, hf, reg), nodes = source ? new NodeField(map.dims, reg, source) : null;
  const world: CollisionWorld = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) }, found: MapVehicle[] = [];
  const counts = { civilian: 0, rescue: 0, police: 0 };
  // Give the rarer service sites their own quota before anonymous pier points can fill the map.
  const order = [...sites].sort((a, b) => Number(a.kind === "civilian") - Number(b.kind === "civilian") || hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
  for (const site of order) {
    if (found.length >= limit) break;
    if (counts[site.kind] >= (site.kind === "civilian" ? 10 : 4)) continue;
    const kind = TYPES[site.kind], def = reg.vehicle[reg.index.get(kind)!];
    if (!def || !isBoatVehicle(def)) continue;
    const candidates: [number, number, number][] = [[site.x, site.z, (hashString(site.id, 414) & 7) * Math.PI / 4]];
    for (let radius = 8; radius <= site.radius; radius += 8) for (let side = 0; side < 16; side++) {
      const angle = side * Math.PI / 8;
      candidates.push([site.x + Math.sin(angle) * radius, site.z + Math.cos(angle) * radius, angle]);
    }
    for (const [x, z, heading] of candidates) {
      if (x < 8 || z < 8 || x > hf.sizeX - 8 || z > hf.sizeZ - 8 || found.some(v => Math.hypot(v.x - x, v.z - z) < 180) ||
        (map.vehicles ?? []).some(v => Math.hypot(v.x - x, v.z - z) < 16)) continue;
      const water = hf.waterAt(x, z);
      if (!Number.isFinite(water) || water - hf.heightAt(x, z) < def.spec.draft + .2) continue;
      const chunk = chunkAt(map.dims, x, z); nodes?.retain(chunk, 1, 1, () => false);
      try {
        const y = boatRestY(def.spec, water);
        if (!shoreAccess(world, x, z)) continue;
        for (const yaw of [heading, heading + Math.PI / 2, heading + Math.PI, heading - Math.PI / 2]) {
          if (!boatPlacement(world, x, y, z, yaw, def)) continue;
          found.push({ id: `boat/${site.id}`, kind, x, y, z, yaw: Math.round(yaw * 65536 / (Math.PI * 2)) & 65535, condition: [.58, .88], fuel: [.04, .42] });
          counts[site.kind]++; break;
        }
      } finally { nodes?.retain(chunk, 1, -1, () => false); }
      if (found.at(-1)?.id === `boat/${site.id}`) break;
    }
  }
  return found;
}
