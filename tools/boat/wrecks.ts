// Wrecks a city's harbours hold for scenery: among a share of its marinas' and piers' berths and in the open water off a
// share of them, a vessel of the harbour's own mix, damaged and riding low or sunk on the bottom with its upperworks
// showing (content/vehicles/harbour-wrecks.ts). Each is a static, set down before the found vessels, which keep clear of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formMesh, hulkOf, type HarbourWreckForm } from "../../content/vehicles/harbour-wrecks.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { isBoatVehicle, type BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { filesUnder, SOURCE } from "../art/source.ts";
import { binKey } from "../mapworld/raster.ts";
import { meets, type Box } from "../mapworld/ruin-obstacles.ts";
import type { StaticPiece } from "../mapworld/statics.ts";
import { pick, siteMix, type BoatSite, type DistrictAt, type Harbours } from "./sites.ts";

/**
 * `marina` and `pier` are the shares of such sites with a wreck among their berths and with one in the water off them,
 * `out` metres from the site's point; `sunk` the share sunk rather than afloat; `apart` metres between two wrecks.
 */
export interface HarbourWreckRules { marina: [number, number]; pier: [number, number]; out: [number, number]; sunk: number; apart: number }
/** A wreck as set down, with what it is a wreck of and where it belongs. `kind` is its form's static, or its intact hull's. */
export interface HarbourWreck extends StaticPiece { vessel: string; form: HarbourWreckForm; site: string; district: string; offshore: boolean }
/** What a wreck needs of the finished ground: water and bed heights, whether a point is inside the map, and room in its chunk. */
export interface WreckGround { waterAt(x: number, z: number): number; groundAt(x: number, z: number): number; inside(x: number, z: number, reach: number): boolean; room(x: number, z: number): boolean }

/** The meshes of the art under assets/source/core/vehicles, by id. */
export function vehicleMeshes(): Set<string> {
  return new Set(filesUnder(join(SOURCE, "core/vehicles"), ".snpk").flatMap((f) => parsePack(new Uint8Array(readFileSync(f))).header.meshes.map((m) => m.id)));
}

/**
 * Whether a footprint `box` meets any of `pieces`, each taken as the circle that holds it at any turn and its height
 * either side of its centre, of the registry's kinds, a landmark's among them.
 */
function pieceIndex(pieces: readonly StaticPiece[], reg: Registry): (box: Box) => boolean {
  const bins = new Map<number, number[]>(), reach = new Float32Array(pieces.length), rise = new Float32Array(pieces.length);
  pieces.forEach((p, i) => {
    const k = reg.index.get(p.kind);
    if (k === undefined) return;
    reach[i] = Math.hypot(reg.halfX[k]!, reg.halfZ[k]!); rise[i] = reg.halfY[k]!;
    for (let z = Math.floor((p.z - reach[i]!) / 64); z <= Math.floor((p.z + reach[i]!) / 64); z++) for (let x = Math.floor((p.x - reach[i]!) / 64); x <= Math.floor((p.x + reach[i]!) / 64); x++) {
      const key = binKey(x, z); if (!bins.has(key)) bins.set(key, []); bins.get(key)!.push(i);
    }
  });
  return (box) => {
    const t = box.yaw * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), [w, h, l] = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    const far = Math.hypot(w, l);
    for (let z = Math.floor((box.z - far) / 64); z <= Math.floor((box.z + far) / 64); z++) for (let x = Math.floor((box.x - far) / 64); x <= Math.floor((box.x + far) / 64); x++) {
      for (const i of bins.get(binKey(x, z)) ?? []) {
        const p = pieces[i]!;
        if (p.y + rise[i]! <= box.y - h || p.y - rise[i]! >= box.y + h) continue;
        // The piece's centre in the box's frame, its x along (cos, -sin) and its z along (sin, cos), and the nearest point of the box to it.
        const dx = p.x - box.x, dz = p.z - box.z, u = dx * c - dz * s, v = dx * s + dz * c;
        if (Math.hypot(u - Math.max(-w, Math.min(w, u)), v - Math.max(-l, Math.min(l, v))) < reach[i]!) return true;
      }
    }
    return false;
  };
}

/** `sites` in the pieces' metres. A form whose mesh `made` does not have stands as its vessel's intact hull. */
export function harbourWrecks(sites: readonly BoatSite[], rules: Harbours, reg: Registry, pieces: readonly StaticPiece[], ground: WreckGround, districtAt: DistrictAt, made: (mesh: string) => boolean): HarbourWreck[] {
  const w = rules.wrecks, hits = pieceIndex(pieces, reg), out: HarbourWreck[] = [];
  const defOf = (id: string): BoatVehicleDefinition => {
    const def = reg.vehicle[reg.index.get(id) ?? -1];
    if (!def || !isBoatVehicle(def)) throw new Error(`harbours weighs ${id}, which is not a vessel of the content`);
    return def;
  };
  const footprint = (def: BoatVehicleDefinition, x: number, y: number, z: number, yaw: number, grow: number): Box => ({ x, y: y + def.spec.height / 2, z, yaw, size: [def.spec.halfWidth * 2 + grow * 2, def.spec.height, def.spec.halfLength * 2 + grow * 2] });
  const order = sites.filter((s) => s.kind === "civilian" && s.waterfront).sort((a, b) => hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
  for (const site of order) {
    // Of the vessels that have a hulk: the launch's own wreck is its corpse's.
    const district = districtAt(site.x, site.z), mix = siteMix(site, rules, district, (id) => defOf(id).spec.halfLength * 2).filter(([id]) => reg.index.has(hulkOf(id)));
    if (mix.length === 0) continue;
    const [atBerths, offshore] = site.waterfront === "marina" ? w.marina : w.pier;
    for (const off of [false, true]) {
      const salt = `${site.id}#wreck${off ? "/off" : ""}`;
      if (hashString(salt, 307) / 4294967296 >= (off ? offshore : atBerths)) continue;
      const vessel = pick(mix, hashString(salt, 311)), def = defOf(vessel), spec = def.spec;
      const form: HarbourWreckForm = hashString(salt, 313) / 4294967296 < w.sunk ? "sunk" : "damaged";
      const kind = made(formMesh(vessel, form)) ? hulkOf(vessel, form) : hulkOf(vessel);
      // Among the berths, nearest the place's point first; off it, round a ring that starts where a hash turns it.
      const [from, to] = off ? w.out : [0, site.radius], start = (hashString(salt, 317) % 16) * Math.PI / 8;
      const skew = ((hashString(salt, 331) % 61) - 30) * Math.PI / 180;
      search: for (let r = from; r <= to; r += 8) for (let side = 0; side < (r ? 16 : 1); side++) {
        const angle = start + side * Math.PI / 8, x = site.x + Math.sin(angle) * r, z = site.z + Math.cos(angle) * r;
        if (!ground.inside(x, z, spec.halfLength + 2) || !ground.room(x, z) || out.some((o) => Math.hypot(o.x - x, o.z - z) < w.apart)) continue;
        const water = ground.waterAt(x, z), bed = ground.groundAt(x, z), depth = water - bed;
        // Afloat it rides low with water in it; sunk it sits on the bottom in water shallow enough that its upperworks show.
        if (form === "damaged" ? depth < spec.draft + .2 : depth < spec.draft + .3 || depth > spec.height * .7) continue;
        const y = form === "damaged" ? water - spec.draft * 1.25 : bed, yaw = ((angle + skew) * 180 / Math.PI % 360 + 360) % 360;
        if (hits(footprint(def, x, y, z, yaw, 1)) || out.some((o) => meets(footprint(def, x, y, z, yaw, 1), footprint(defOf(o.vessel), o.x, o.y, o.z, o.yaw, 0)))) continue;
        out.push({ kind, x, y, z, yaw, vessel, form, site: site.id, district: district?.name ?? "", offshore: off });
        break search;
      }
    }
  }
  return out;
}
