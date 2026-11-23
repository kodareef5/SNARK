import { CHUNK_SIZE } from "../shared/coords.ts";
import type { AirPose } from "../shared/sim/air-support.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { isWheelVehicle, type VehicleSpec } from "../shared/sim/vehicle.ts";
import { AIR_FRAME as A } from "../shared/world/air-support-art.ts";
import { castWorld, HIT_NONE, HIT_STRUCTURE, rayHit } from "../shared/world/ray.ts";
import { carMeetsCapsule, carMeetsVehicle } from "../shared/world/vehicle.ts";
import { carShapes } from "../shared/world/vehicle-shapes.ts";
import { StaticVehicleSolids } from "../shared/world/vehicle-solid.ts";
import type { ServerWorld } from "./world.ts";

export const KINGPIN = 3.75;
const FIFTH_WHEEL = -2.6;
const AXLE = -3.125;
const TURN_LIMIT = Math.PI * .43;

export function offset(at: AirPose, side: number, height: number, ahead: number): AirPose {
  const sn = Math.sin(at.yaw), cs = Math.cos(at.yaw);
  return { x: at.x + cs * side + sn * ahead, y: at.y + height, z: at.z + cs * ahead - sn * side, yaw: at.yaw };
}

export const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const wireYaw = (yaw: number) => Math.round(yaw * 65536 / (2 * Math.PI)) & 65535;

/** The old axle rolls toward the new fifth wheel; reversing increases the bend. */
export function towedPose(tractor: AirPose, old?: AirPose): AirPose {
  const pin = offset(tractor, 0, 0, FIFTH_WHEEL);
  if (old) {
    const axle = offset(old, 0, 0, AXLE);
    const yaw = Math.atan2(pin.x - axle.x, pin.z - axle.z);
    pin.yaw += Math.max(-TURN_LIMIT, Math.min(TURN_LIMIT, angle(yaw - tractor.yaw)));
  }
  return offset(pin, 0, 0, -KINGPIN);
}

function frame(at: AirPose) {
  return { ...at, pitch: 0, roll: 0, qx: 0, qy: Math.sin(at.yaw / 2), qz: 0, qw: Math.cos(at.yaw / 2) };
}

export class CargoSpace {
  private ignore = -1;
  private readonly solids: StaticVehicleSolids;
  private readonly bare: VehicleSpec;
  private readonly chassis: VehicleSpec;
  private readonly panels: VehicleSpec;
  private readonly carrier: VehicleSpec;
  private readonly dropColumn: VehicleSpec;
  private readonly widest: number;
  private readonly world: ServerWorld;
  constructor(world: ServerWorld) {
    this.world = world;
    this.solids = new StaticVehicleSolids(world, undefined, ref => ref === this.ignore);
    const base = world.reg.vehicle[world.reg.index.get("core:semi") ?? 0];
    if (!base || !isWheelVehicle(base)) throw Error("Air cargo needs a semi tractor");
    const spec = (boxes: NonNullable<VehicleSpec["bodyBoxes"]>): VehicleSpec => ({ ...base.spec, bodyBoxes: boxes });
    this.bare = spec([{ at: [0, A.height / 2 + .035, 0], half: [A.halfWidth, A.height / 2 - .035, A.halfLength] }]);
    this.chassis = spec([{ at: [0, A.deck + A.height / 2, 0], half: [A.halfWidth, A.height / 2, A.halfLength] },
      { at: [0, 1.19, -1.99], half: [1.26, .11, 2.66] },
      { at: [0, 1.295, 2.66], half: [1.26, .005, 1.99] },
      ...A.axle.map(z => ({ at: [0, A.wheel + .035, z] as const, half: [1.21, A.wheel - .035, A.wheel] as const }))]);
    this.panels = spec([{ at: [-.24, 2.50, 0], half: [3.37, 1.90, 3.92] }]);
    this.carrier = spec([{ at: [0, A.carrierY, 0], half: [1.8, 1.45, 4.36] },
      ...[-A.rotorZ, A.rotorZ].map(z => ({ at: [0, A.carrierY + 1.4, z] as const, half: [A.rotorRadius, .25, A.rotorRadius] as const }))]);
    this.dropColumn = spec([{ at: [0, 15.5, 0], half: [A.halfWidth, 15.42, A.halfLength] },
      ...[-A.rotorZ, A.rotorZ].map(z => ({ at: [0, 18.65, z] as const, half: [A.rotorRadius, 13.5, A.rotorRadius] as const }))]);
    this.widest = Math.max(6, ...world.reg.vehicle.map(v => v ? Math.hypot(v.spec.halfLength, v.spec.halfWidth, v.spec.height) : 0));
  }

  /** Road tops within reach of the wheels count as ground, including bridges. */
  ground(at: AirPose, trailer: boolean, towing: boolean, ignore: number): number | null {
    const hf = this.world.hf;
    let high = -Infinity, low = Infinity;
    const half = trailer ? 4.45 : 3.88;
    for (const z of [-half, 0, half]) for (const x of [-1.19, 1.19]) {
      const p = offset(at, x, 0, z);
      if (p.x < 0 || p.x >= hf.sizeX || p.z < 0 || p.z >= hf.sizeZ) return null;
      let y = hf.heightAt(p.x, p.z);
      const castY = at.y + .62, max = Math.min(3, Math.max(.1, castY - y + .02));
      if (castWorld(this.world, p.x, castY, p.z, 0, -1, 0, max, true) === HIT_STRUCTURE &&
          rayHit.ref !== ignore && rayHit.ny > .83) y = Math.max(y, castY - rayHit.t);
      if (y + .02 < hf.waterAt(p.x, p.z)) return null;
      high = Math.max(high, y); low = Math.min(low, y);
    }
    if (high - low > (towing ? 1.75 : .55) || Math.abs(at.y - high) > (towing ? 1.1 : 2.5)) return null;
    return high;
  }

  clear(at: AirPose, trailer: boolean, reason: "tow" | "land" | "panels", ignore: number, tractor: number, from = at): boolean {
    this.ignore = ignore;
    const spec = reason === "panels" ? this.panels : trailer ? this.chassis : this.bare;
    let start = from, end = at;
    if (reason === "panels" && trailer) { start = offset(from, 0, 1.3, 0); end = offset(at, 0, 1.3, 0); }
    const a = frame(start), b = frame(end);
    if (this.solids.blocked(a, b, carShapes(spec))) return false;
    if (reason === "land") {
      const base = frame(offset(at, 0, trailer ? A.deck : 0, 0));
      const above = frame(offset(at, 0, 28, 0));
      if (this.solids.blocked(b, above, carShapes(spec)) || this.solids.blocked(base, above, carShapes(this.carrier))) return false;
    }
    const w = this.world, ents = w.ents, pad = this.widest + 8;
    const minX = Math.max(0, Math.floor((at.x - pad) / CHUNK_SIZE)), maxX = Math.min(w.dims.chunksX - 1, Math.floor((at.x + pad) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((at.z - pad) / CHUNK_SIZE)), maxZ = Math.min(w.dims.chunksZ - 1, Math.floor((at.z + pad) / CHUNK_SIZE));
    for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
      for (let e = ents.chunkHead[cz * w.dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
        if (e === tractor || !(ents.flags[e]! & F_ALIVE)) continue;
        if (tractor >= 0 && ents.seat[e] === tractor + 1 && ents.seatGen[e] === ents.gen[tractor]) continue;
        const kind = ents.kind[e]!, def = w.reg.vehicle[kind];
        if (Math.hypot(ents.x[e]! - at.x, ents.z[e]! - at.z) > 8 + (def ? Math.hypot(def.spec.halfWidth, def.spec.halfLength, def.spec.height) : w.reg.bodyRadius[kind]!)) continue;
        const target = reason === "land" ? this.dropColumn : spec;
        if (def) {
          const v = ents.vrow[e]!;
          const p = { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!,
            roll: ents.vehicleRoll[v]!, qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! };
          if (carMeetsVehicle(target, b, def, p)) return false;
        } else {
          if (carMeetsCapsule(target, b, ents.x[e]!, ents.y[e]!, ents.z[e]!, w.reg.bodyRadius[kind]!, w.reg.bodyHeight[kind]!)) return false;
        }
      }
    }
    return true;
  }

  transfer(from: AirPose, to: AirPose, ref: number, tractor: number): boolean {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / .75) + 1;
    let previous = from;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const next = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y + A.deck - from.y) * f,
        z: from.z + (to.z - from.z) * f, yaw: from.yaw + angle(to.yaw - from.yaw) * f };
      if (!this.clear(next, false, "tow", ref, tractor, previous)) return false;
      previous = next;
    }
    return true;
  }

  sees(at: AirPose, e: number, ownSolid: number): boolean {
    const ents = this.world.ents, kind = ents.kind[e]!;
    const x = ents.x[e]!, y = ents.y[e]! + this.world.reg.bodyHeight[kind]! * .8, z = ents.z[e]!;
    const dx = at.x - x, dy = at.y + 1 - y, dz = at.z - z, dist = Math.hypot(dx, dy, dz);
    return dist < .1 || castWorld(this.world, x, y, z, dx / dist, dy / dist, dz / dist, dist, true) === HIT_NONE ||
      (rayHit.kind === HIT_STRUCTURE && rayHit.ref === ownSolid);
  }
}
