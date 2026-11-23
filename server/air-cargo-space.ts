import { CHUNK_SIZE } from "../shared/coords.ts";
import type { AirPose } from "../shared/sim/air-support.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { isWheelVehicle, type VehicleSpec, type WheelVehicleDefinition } from "../shared/sim/vehicle.ts";
import { quatRotate } from "../shared/math/quat.ts";
import { AIR_CARRIER_ART as C, AIR_TRAILER_ART as T } from "../content/vehicles/air-freight-art.ts";
import { castWorld, HIT_NONE, HIT_STRUCTURE, rayHit } from "../shared/world/ray.ts";
import { carMeetsCapsule, carMeetsVehicle } from "../shared/world/vehicle.ts";
import { carShapes } from "../shared/world/vehicle-shapes.ts";
import { StaticVehicleSolids } from "../shared/world/vehicle-solid.ts";
import type { ServerWorld } from "./world.ts";

export function offset(at: AirPose, side: number, height: number, ahead: number): AirPose {
  const sn = Math.sin(at.yaw), cs = Math.cos(at.yaw);
  return { x: at.x + cs * side + sn * ahead, y: at.y + height, z: at.z + cs * ahead - sn * side, yaw: at.yaw };
}

export const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A vehicle's full frame. */
export interface Frame extends AirPose { qx: number; qy: number; qz: number; qw: number }
const q = new Float64Array(4), v = new Float64Array(3);

/** Where a trailer stands with its kingpin on this tractor's fifth wheel, in the tractor's own attitude. */
export function hitchedPose(tractor: Frame, fifthWheel: readonly number[], kingpin: readonly number[] = T.kingpin): Frame {
  vehicleRotation(tractor as never, q);
  quatRotate(q, 0, fifthWheel[0]! - kingpin[0]!, fifthWheel[1]! - kingpin[1]!, fifthWheel[2]! - kingpin[2]!, v, 0);
  return { ...tractor, x: tractor.x + v[0]!, y: tractor.y + v[1]!, z: tractor.z + v[2]! };
}

/** A local point of a frame, in the world. */
export function framePoint(at: Frame, x: number, y: number, z: number): AirPose {
  vehicleRotation(at as never, q);
  quatRotate(q, 0, x, y, z, v, 0);
  return { x: at.x + v[0]!, y: at.y + v[1]!, z: at.z + v[2]!, yaw: at.yaw };
}

function frame(at: AirPose) {
  return { ...at, pitch: 0, roll: 0, qx: 0, qy: Math.sin(at.yaw / 2), qz: 0, qw: Math.cos(at.yaw / 2) };
}

export const isTrailer = (d: unknown): d is WheelVehicleDefinition => !!d && isWheelVehicle(d as never) && !!(d as WheelVehicleDefinition).spec.kingpin;

/** Room and ground for setting a trailer down, opening its rack, and the carrier's column above it. */
export class CargoSpace {
  private readonly solids: StaticVehicleSolids;
  private readonly chassis: VehicleSpec;
  private readonly panels: VehicleSpec;
  private readonly carrier: VehicleSpec;
  private readonly dropColumn: VehicleSpec;
  private readonly widest: number;
  private readonly world: ServerWorld;
  private readonly carrierKind: number;
  constructor(world: ServerWorld, trailer: WheelVehicleDefinition) {
    this.world = world;
    this.carrierKind = world.reg.index.get(C.id) ?? -1;
    this.solids = new StaticVehicleSolids(world);
    const base = trailer.spec, spec = (boxes: NonNullable<VehicleSpec["bodyBoxes"]>): VehicleSpec => ({ ...base, clearance: .03, halfWidth: 3.6, halfLength: 7.4, height: 40, bodyBoxes: boxes });
    this.chassis = spec([...base.bodyBoxes!,
      ...T.axles.map(a => ({ at: [0, T.wheelRadius + .035, a.z] as const, half: [a.track / 2, T.wheelRadius - .035, T.wheelRadius] as const }))]);
    const span = T.container.max[2];
    this.panels = spec([{ at: [-.24, T.deck + 1.2, 0], half: [2.4, 1.15, span] }]);
    const lift = T.deck + 1.65 - .25;
    this.carrier = spec([{ at: [0, lift + 1.4, 0], half: [1.8, 1.4, 4.36] },
      ...C.rotors.map(r => ({ at: [0, lift + r.center[1], r.center[2]] as const, half: [C.rotorRadius, .25, C.rotorRadius] as const }))]);
    this.dropColumn = spec([{ at: [0, 15.5, 0], half: [1.3, 15.42, 4.45] },
      ...C.rotors.map(r => ({ at: [0, 18.65, r.center[2]] as const, half: [C.rotorRadius, 13.5, C.rotorRadius] as const }))]);
    this.widest = Math.max(6, ...world.reg.vehicle.map(d => d ? Math.hypot(d.spec.halfLength, d.spec.halfWidth, d.spec.height) : 0));
  }

  /** The highest ground under the wheels and legs, roads and bridges included; null on water or rough ground. */
  ground(at: AirPose): number | null {
    const hf = this.world.hf;
    let high = -Infinity, low = Infinity;
    for (const z of [T.legs.z, T.axles[0]!.z, T.axles[1]!.z]) for (const x of [-1.07, 1.07]) {
      const p = offset(at, x, 0, z);
      if (p.x < 0 || p.x >= hf.sizeX || p.z < 0 || p.z >= hf.sizeZ) return null;
      let y = hf.heightAt(p.x, p.z);
      const castY = at.y + .62, max = Math.min(3, Math.max(.1, castY - y + .02));
      if (castWorld(this.world, p.x, castY, p.z, 0, -1, 0, max, true) === HIT_STRUCTURE && rayHit.ny > .83) y = Math.max(y, castY - rayHit.t);
      if (y + .02 < hf.waterAt(p.x, p.z)) return null;
      high = Math.max(high, y); low = Math.min(low, y);
    }
    if (high - low > .55 || Math.abs(at.y - high) > 2.5) return null;
    return high;
  }

  /** Nothing in the way: of a trailer set down ("land", with the carrier's column above), or of its open panels. */
  clear(at: AirPose, reason: "land" | "panels", skip: readonly number[]): boolean {
    const spec = reason === "panels" ? this.panels : this.chassis;
    const b = frame(at);
    if (this.solids.blocked(b, b, carShapes(spec))) return false;
    if (reason === "land") {
      const base = frame(offset(at, 0, T.deck, 0)), above = frame(offset(at, 0, 28, 0));
      if (this.solids.blocked(b, above, carShapes(spec)) || this.solids.blocked(base, above, carShapes(this.carrier))) return false;
    }
    const w = this.world, ents = w.ents, pad = this.widest + 8;
    const minX = Math.max(0, Math.floor((at.x - pad) / CHUNK_SIZE)), maxX = Math.min(w.dims.chunksX - 1, Math.floor((at.x + pad) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((at.z - pad) / CHUNK_SIZE)), maxZ = Math.min(w.dims.chunksZ - 1, Math.floor((at.z + pad) / CHUNK_SIZE));
    const target = reason === "land" ? this.dropColumn : spec;
    for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
      for (let e = ents.chunkHead[cz * w.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
        if (skip.includes(e) || !(ents.flags[e]! & F_ALIVE)) continue;
        const seat = ents.seat[e]! - 1;
        if (seat >= 0 && skip.includes(seat) && ents.seatGen[e] === ents.gen[seat]) continue;
        const kind = ents.kind[e]!, def = w.reg.vehicle[kind];
        // A freight carrier lifting off is on its way: it does not hold the panels shut.
        if (kind === this.carrierKind && reason === "panels") continue;
        if (Math.hypot(ents.x[e]! - at.x, ents.z[e]! - at.z) > 8 + (def ? Math.hypot(def.spec.halfWidth, def.spec.halfLength, def.spec.height) : w.reg.bodyRadius[kind]!)) continue;
        if (def) {
          const r = ents.vrow[e]!;
          const p = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[r]!, pitch: ents.vehiclePitch[r]!,
            roll: ents.vehicleRoll[r]!, qx: ents.vehicleQx[r]!, qy: ents.vehicleQy[r]!, qz: ents.vehicleQz[r]!, qw: ents.vehicleQw[r]! };
          if (carMeetsVehicle(target, b, def, p)) return false;
        } else if (carMeetsCapsule(target, b, ents.x[e]!, ents.y[e]!, ents.z[e]!, w.reg.bodyRadius[kind]!, w.reg.bodyHeight[kind]!)) return false;
      }
    }
    return true;
  }

  /** A clear line from body `e`'s eyes to a point beside the rack. */
  sees(at: AirPose, e: number): boolean {
    const ents = this.world.ents, kind = ents.kind[e]!;
    const x = ents.x[e]!, y = ents.y[e]! + this.world.reg.bodyHeight[kind]! * .8, z = ents.z[e]!;
    const dx = at.x - x, dy = at.y - y, dz = at.z - z, dist = Math.hypot(dx, dy, dz);
    return dist < .1 || castWorld(this.world, x, y, z, dx / dist, dy / dist, dz / dist, dist, true) === HIT_NONE;
  }
}
