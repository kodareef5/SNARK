// Found boats belong to mapped waterfront places. Search the finished geometry; never carve a berth or move the sea.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Registry } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { hashString } from "../../shared/hash.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { isBoatVehicle, type BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { vehicleFitsWorld } from "../../server/vehicle-service.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../../shared/world/collide.ts";
import { mapHeightfield, mapNodes, placeStatics, type MapData, type MapVehicle } from "../../shared/world/mapfile.ts";
import { NodeField } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { BuildingLabel, PublicPlace } from "../mapworld/labels.ts";
import { meets, type Box } from "../mapworld/ruin-obstacles.ts";
import type { HarbourWreckRules } from "./wrecks.ts";

export interface BoatSite { id: string; kind: "civilian" | "rescue" | "police"; x: number; z: number; radius: number; waterfront?: "marina" | "pier" }
const TYPES = { civilian: "core:boat", rescue: "core:boat_rescue", police: "core:boat_police" } as const;

/** Weights by a vessel's content id. */
type Mix = Record<string, number>;
/** A range of fractions to roll in, with its weight: [from, to, weight]. */
type Band = [number, number, number];
/**
 * How a city's harbours are stocked (`harbours` in tools/mapworld/rules/default.json; tools/mapworld/README.md, "Boats").
 * A marina holds `least` to `most`, a share of piers one of at most `longest` metres. `room` is the margin round a hull
 * that no other found vessel's hull may enter, and `apart` how far a site's vessels stand from any other site's.
 */
export interface Harbours {
  marina: { least: number; most: number };
  pier: { share: number; longest: number };
  room: number; apart: number;
  kinds: { marina: Mix; pier: Mix }; styles: Record<string, Mix>; districts: Record<string, Mix>;
  condition: Band[]; fuel: Band[];
  wrecks: HarbourWreckRules;
}
export const HARBOURS: Harbours = JSON.parse(readFileSync(join(import.meta.dir, "../mapworld/rules/default.json"), "utf8")).harbours;
/** The district a point of the map stands in or looks onto, or null. */
export type DistrictAt = (x: number, z: number) => { name: string; style: string } | null;

/** The row of `rows` a hash `h` of 32 bits lands on, by their weights. */
export const pick = <T,>(rows: readonly (readonly [T, number])[], h: number): T => {
  let at = (h / 4294967296) * rows.reduce((n, r) => n + r[1], 0);
  for (const [value, weight] of rows) { if (at < weight) return value; at -= weight; }
  return rows.at(-1)![0];
};

/** Only direct source labels enter this list. A Coast Guard station is an authored rescue site, not a guessed POI API. */
export function mappedBoatSites(places: readonly PublicPlace[], labels: Readonly<Record<string, BuildingLabel>>, toEngine: (e: number, n: number) => [number, number]): BoatSite[] {
  const result: BoatSite[] = [];
  for (const p of places) {
    const kind = p.kind === "marina" || p.kind === "pier" ? "civilian" : p.kind === "beach" ? "rescue" : null;
    if (!kind) continue;
    const [x, z] = toEngine(p.e, p.n);
    // A map's vehicle id is plain printable ASCII of 80 characters at most (shared/world/mapfile.ts), with `boat/` before
    // it and a marina's `#` and berth after it; the name gives way to the place, which keeps it unique.
    const head = `place/${p.kind}/`, at = `@${p.e},${p.n}`;
    const name = (p.name ?? "unnamed").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x21-\x7e]+/g, "_").slice(0, Math.max(0, 80 - "boat/".length - head.length - at.length - 3));
    result.push({ id: `${head}${name}${at}`, kind, x, z, radius: p.kind === "marina" ? 120 : 48, ...(p.kind === "pier" || p.kind === "marina" ? { waterfront: p.kind } : {}) });
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

/** A civilian site's weights: its waterfront's, changed by its district's style and then its name; at a pier, only craft short enough. */
export function siteMix(site: BoatSite, rules: Harbours, district: ReturnType<DistrictAt>, lengthOf: (id: string) => number): [string, number][] {
  const pool = site.waterfront === "pier" ? rules.kinds.pier : rules.kinds.marina;
  return Object.entries({ ...pool, ...(district ? rules.styles[district.style] : {}), ...(district ? rules.districts[district.name] : {}) })
    .filter(([id, w]) => w > 0 && id in pool && (site.waterfront !== "pier" || lengthOf(id) <= rules.pier.longest));
}

/** A found vessel as placed, with the site it belongs to and the district whose weights drew it. */
export interface Berthed extends MapVehicle { id: string; site: string; district: string; }

/**
 * Sparse stable records, a site's in the order of its hash. Each service site holds one of its own livery, up to four of
 * each; each marina several and a share of piers one, drawn from the harbour's weights as its district changes them, each
 * tested where it lies for its own draught, hull and room. Its condition and fuel are ranges the server rolls once a
 * world (server/vehicle-service.ts, foundVehicle); a berth whose vessel has gone gets another (server/car-return.ts).
 */
export function boatSites(map: MapData, reg: Registry, sites: readonly BoatSite[], rules: Harbours = HARBOURS, districtAt: DistrictAt = () => null): Berthed[] {
  const hf = mapHeightfield(map), structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const source = mapNodes(map, hf, reg), nodes = source ? new NodeField(map.dims, reg, source) : null;
  const world: CollisionWorld = { hf, structs, ...(nodes ? { nodes: nodes.store } : {}) };
  const defOf = (id: string): BoatVehicleDefinition => {
    const def = reg.vehicle[reg.index.get(id) ?? -1];
    if (!def || !isBoatVehicle(def)) throw new Error(`harbours weighs ${id}, which is not a vessel of the content`);
    return def;
  };
  for (const id of new Set([rules.kinds.marina, rules.kinds.pier, ...Object.values(rules.styles), ...Object.values(rules.districts)].flatMap(Object.keys))) defOf(id);
  if (rules.condition.length === 0 || rules.fuel.length === 0) throw new Error("harbours has no condition or no fuel bands");
  const found: (Berthed & { def: BoatVehicleDefinition; heading: number })[] = [];
  const hull = (def: BoatVehicleDefinition, x: number, z: number, heading: number, grow: number): Box => ({ x, y: 0, z, yaw: heading * 180 / Math.PI, size: [def.spec.halfWidth * 2 + grow * 2, 1, def.spec.halfLength * 2 + grow * 2] });
  const shore = new Map<string, boolean>();
  /** The first place round the site, nearest first, where this vessel floats clear with its draught and room. */
  const berth = (site: BoatSite, def: BoatVehicleDefinition): [number, number, number, number] | null => {
    const candidates: [number, number, number][] = [[site.x, site.z, (hashString(site.id, 414) & 7) * Math.PI / 4]];
    for (let radius = 8; radius <= site.radius; radius += 8) for (let side = 0; side < 16; side++) {
      const angle = side * Math.PI / 8;
      candidates.push([site.x + Math.sin(angle) * radius, site.z + Math.cos(angle) * radius, angle]);
    }
    for (const [x, z, heading] of candidates) {
      if (x < 8 || z < 8 || x > hf.sizeX - 8 || z > hf.sizeZ - 8 || found.some(v => v.site !== site.id && Math.hypot(v.x - x, v.z - z) < rules.apart) ||
        (map.vehicles ?? []).some(v => Math.hypot(v.x - x, v.z - z) < 16)) continue;
      const water = hf.waterAt(x, z);
      if (!Number.isFinite(water) || water - hf.heightAt(x, z) < def.spec.draft + .2) continue;
      const key = `${x},${z}`;
      if (!shore.has(key)) shore.set(key, shoreAccess(world, x, z));
      if (!shore.get(key)) continue;
      const chunk = chunkAt(map.dims, x, z); nodes?.retain(chunk, 1, 1, () => false);
      try {
        const y = boatRestY(def.spec, water), move = reg.move[reg.index.get(def.id)!]!;
        for (const yaw of [heading, heading + Math.PI / 2, heading + Math.PI, heading - Math.PI / 2]) {
          // Neither's room meets the other's hull.
          if (found.some(v => meets(hull(def, x, z, yaw, rules.room), hull(v.def, v.x, v.z, v.heading, 0)) || meets(hull(v.def, v.x, v.z, v.heading, rules.room), hull(def, x, z, yaw, 0)))) continue;
          // And the upright capsule of its body a server sets any creature down in (server/creatures.ts, spawn).
          if (vehicleFitsWorld(world, x, y, z, yaw, def) && capsuleFree(world, x, y, z, move.radius, move.height)) return [x, y, z, yaw];
        }
      } finally { nodes?.retain(chunk, 1, -1, () => false); }
    }
    return null;
  };
  const counts = { rescue: 0, police: 0 };
  // The rarer service sites first, then the marinas, so the piers' single craft keep off both.
  const rank = (s: BoatSite): number => s.kind !== "civilian" ? 0 : s.waterfront === "marina" ? 1 : 2;
  const order = [...sites].sort((a, b) => rank(a) - rank(b) || hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
  for (const site of order) {
    if (site.kind !== "civilian" && counts[site.kind] >= 4) continue;
    const district = districtAt(site.x, site.z), mix = siteMix(site, rules, district, (id) => defOf(id).spec.halfLength * 2);
    const want = site.kind !== "civilian" || !site.waterfront ? 1 : site.waterfront === "pier" ? Number(hashString(site.id, 211) / 4294967296 < rules.pier.share)
      : rules.marina.least + hashString(site.id, 223) % Math.max(1, rules.marina.most - rules.marina.least + 1);
    for (let k = 0; k < want; k++) {
      // A kind that finds no water deep and clear enough is drawn again, twice, and then gives way to the site's own launch.
      const drawn = site.kind === "civilian" && site.waterfront && mix.length ? [0, 1, 2].map(n => pick(mix, hashString(`${site.id}#${k}${n ? `/${n}` : ""}`, 193))) : [];
      let placed: [string, [number, number, number, number]] | null = null;
      for (const kind of new Set([...drawn, TYPES[site.kind]])) {
        const at = berth(site, defOf(kind));
        if (at) { placed = [kind, at]; break; }
      }
      if (!placed) break;
      const [kind, [x, y, z, heading]] = placed;
      const [cl, ch] = pick(rules.condition.map(b => [b, b[2]] as const), hashString(`${site.id}#${k}`, 1231));
      const [fl, fh] = pick(rules.fuel.map(b => [b, b[2]] as const), hashString(`${site.id}#${k}`, 1237));
      found.push({ id: `boat/${site.id}${k ? `#${k}` : ""}`, kind, x, y, z, yaw: Math.round(heading * 65536 / (Math.PI * 2)) & 65535, condition: [cl, ch], fuel: [fl, fh],
        site: site.id, district: district?.name ?? "", def: defOf(kind), heading });
    }
    if (site.kind !== "civilian" && found.at(-1)?.site === site.id) counts[site.kind]++;
  }
  return found.map(({ def: _def, heading: _heading, ...v }) => v);
}
