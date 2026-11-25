// A vehicle's hull as upright bodies, which the server's placement and the client's preview both test against what stands
// near, so the two agree on what is in the way.
import { detCos, detSin } from "../math/scalar.ts";
import { boatDrives, isBoatVehicle, isJetVehicle, isRotorVehicle, isWheelVehicle, type VehicleDefinition } from "./vehicle.ts";

export interface HullPart { x: number; y: number; z: number; radius: number; height: number }

/** The upright bodies a vehicle's hull is tested as: along its length, its tail, its rotor's disc, its propeller and outboard. */
export function hullParts(x: number, y: number, z: number, yaw: number, def: VehicleDefinition): HullPart[] {
  const spec = def.spec, sn = detSin(yaw), cs = detCos(yaw), parts: HullPart[] = [];
  const add = (lx: number, ly: number, lz: number, radius: number, height: number): void => { parts.push({ x: x + cs * lx + sn * lz, y: y + ly, z: z - sn * lx + cs * lz, radius, height }); };
  if (isWheelVehicle(def) && def.spec.bodyBoxes) {
    for (const b of def.spec.bodyBoxes) {
      const radius = Math.min(b.half[0], b.half[2]), span = b.half[2] - radius;
      const steps = Math.max(1, Math.ceil(span / radius));
      for (let i = -steps; i <= steps; i++) add(b.at[0], b.at[1] - b.half[1], b.at[2] + span * i / steps, radius, b.half[1] * 2);
    }
    return parts;
  }
  if (isJetVehicle(def)) {
    // A jet's half width is its wing's: each of its boxes is a row of bodies along its longer side, the wing's across.
    for (const b of def.spec.bodyBoxes) {
      const wide = b.half[0] > b.half[2], radius = Math.min(b.half[0], b.half[2]), span = Math.max(b.half[0], b.half[2]) - radius;
      const steps = Math.max(1, Math.ceil(span / radius));
      for (let i = -steps; i <= steps; i++) add(b.at[0] + (wide ? span * i / steps : 0), b.at[1] - b.half[1], b.at[2] + (wide ? 0 : span * i / steps), radius, b.half[1] * 2);
    }
    return parts;
  }
  const along = Math.max(0, spec.halfLength - spec.halfWidth);
  for (let i = -2; i <= 2; i++) add(0, spec.clearance, i * along / 2, spec.halfWidth, spec.height - spec.clearance);
  if (isRotorVehicle(def)) {
    const tail = def.spec.tail;
    for (let i = 0; i <= 8; i++) {
      const at = tail.from.map((v, axis) => v + (tail.to[axis]! - v) * i / 8);
      add(at[0]!, at[1]! - tail.radius, at[2]!, tail.radius, tail.radius * 2);
    }
    const main = def.rotors[0]!;
    parts.push({ x: x + cs * main.at[0] + sn * main.at[2], y: y + main.at[1] - .08, z: z - sn * main.at[0] + cs * main.at[2], radius: main.radius, height: .16 });
  }
  if (isBoatVehicle(def)) {
    const drives = boatDrives(def.spec);
    for (const { propeller: prop } of drives) add(prop.at[0], prop.at[1] - prop.radius, prop.at[2], prop.radius, prop.radius * 2);
    for (const box of [...def.spec.hullBoxes, ...drives.flatMap(d => d.outboard?.boxes ?? [])]) {
      if (Math.abs(box.at[2]) + box.half[2] <= spec.halfLength) continue;
      const radius = Math.min(box.half[0], box.half[2]);
      const steps = Math.max(1, Math.ceil(box.half[2] / radius));
      for (let i = -steps; i <= steps; i++) add(box.at[0], box.at[1] - box.half[1], box.at[2] + i / steps * Math.max(0, box.half[2] - radius), radius, box.half[1] * 2);
    }
  }
  return parts;
}

/**
 * Whether a hull part meets a body standing at `x, y, z` and `height` tall: a vehicle `other` turned `yaw`, met by its
 * footprint, or else an upright body of `radius`.
 */
export function partMeetsBody(part: HullPart, x: number, y: number, z: number, height: number, radius: number, other: VehicleDefinition | null | undefined, yaw: number): boolean {
  if (part.y >= y + height || part.y + part.height <= y) return false;
  const dx = part.x - x, dz = part.z - z;
  const reach = part.radius + radius;
  if (!other) return dx * dx + dz * dz < reach * reach;
  const sn = detSin(yaw), cs = detCos(yaw), lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
  const ox = Math.max(0, Math.abs(lx) - other.spec.halfWidth), oz = Math.max(0, Math.abs(lz) - other.spec.halfLength);
  return ox * ox + oz * oz < part.radius * part.radius;
}
