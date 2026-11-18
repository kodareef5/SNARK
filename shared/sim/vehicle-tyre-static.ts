// Parking uses bounded static tyre impulses, including lateral grip; it does not depend on a perfectly level road.
import { quatRotate } from "../math/quat.ts";
import { clamp, detCos, detSin, len3 } from "../math/scalar.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "./vehicle-rigid.ts";
import type { VehicleSpec, VehicleState, VehicleSurface } from "./vehicle.ts";

export interface StaticTyre {
  x: number; y: number; z: number; nx: number; ny: number; nz: number; load: number; front: boolean; surface: VehicleSurface;
}
interface Constraint { wheel: StaticTyre; fx: number; fy: number; fz: number; sx: number; sy: number; sz: number; limit: number; longLimit: number; long: number; side: number }
const q = new Float64Array(4), v = new Float64Array(3), direction = new Float64Array(3), com = new Float64Array(3);
const constraints: Constraint[] = [];

/** Returns whether the contact footprint and available static friction can support a quiet chassis. */
export function holdParkedTyres(s: VehicleState, p: VehicleSpec, wheels: readonly StaticTyre[], allBraked: boolean, parking: boolean, dt: number): boolean {
  vehicleRotation(s, q); let count = 0;
  for (const wheel of wheels) {
    if (wheel.load <= 0) continue;
    const steering = wheel.front ? s.steering : 0;
    quatRotate(q, 0, detSin(steering), 0, detCos(steering), direction, 0);
    const dot = direction[0]! * wheel.nx + direction[1]! * wheel.ny + direction[2]! * wheel.nz;
    let fx = direction[0]! - dot * wheel.nx, fy = direction[1]! - dot * wheel.ny, fz = direction[2]! - dot * wheel.nz;
    const length = len3(fx, fy, fz); if (length < .01) continue;
    fx /= length; fy /= length; fz /= length;
    const constraint = constraints[count] ?? (constraints[count] = {} as Constraint); count++;
    constraint.wheel = wheel; constraint.fx = fx; constraint.fy = fy; constraint.fz = fz;
    constraint.sx = wheel.ny * fz - wheel.nz * fy; constraint.sy = wheel.nz * fx - wheel.nx * fz; constraint.sz = wheel.nx * fy - wheel.ny * fx;
    constraint.limit = wheel.load * 1.3 * clamp(wheel.surface.grip / 7, 0, 1) * dt;
    constraint.longLimit = allBraked || parking && !wheel.front ? Infinity : wheel.load / (p.gravity ?? 18) * wheel.surface.rolling * dt;
    constraint.long = constraint.side = 0;
  }
  // Accumulated impulses share one friction circle per wheel. Alternating passes avoid favouring the first axle/side.
  for (let pass = 0; pass < 6; pass++) for (let i = 0; i < count; i++) {
    const c = constraints[pass % 2 ? count - i - 1 : i]!, w = c.wheel;
    vehiclePointVelocity(s, p, w.x, w.y, w.z, v);
    let along = c.long - (v[0]! * c.fx + v[1]! * c.fy + v[2]! * c.fz) / vehiclePointInverseMass(s, p, w.x, w.y, w.z, c.fx, c.fy, c.fz);
    let side = c.side - (v[0]! * c.sx + v[1]! * c.sy + v[2]! * c.sz) / vehiclePointInverseMass(s, p, w.x, w.y, w.z, c.sx, c.sy, c.sz);
    along = clamp(along, -c.longLimit, c.longLimit);
    const total = Math.sqrt(along * along + side * side), scale = total > c.limit ? c.limit / total : 1;
    along *= scale; side *= scale;
    const dl = along - c.long, ds = side - c.side; c.long = along; c.side = side;
    applyVehicleImpulse(s, p, w.x, w.y, w.z, c.fx * dl + c.sx * ds, c.fy * dl + c.sy * ds, c.fz * dl + c.sz * ds);
  }
  if (count !== 2 * (p.axles?.length ?? 2)) return false;
  let saturated = 0;
  for (let i = 0; i < count; i++) {
    const c = constraints[i]!;
    if (c.limit < 1e-6 || Math.sqrt(c.long * c.long + c.side * c.side) > c.limit * .99) return false;
    if (Math.abs(c.long) >= c.longLimit * .99) saturated++;
  }
  if (!parking && !allBraked && saturated === count) return false;
  // Gravity's line through the COM must lie inside the outer axle footprint, including on a cross slope.
  const { comX, comY, comZ } = vehicleMassProperties(p, s);
  quatRotate(q, 0, comX, comY, comZ, com, 0);
  const x = s.x + com[0]!, z = s.z + com[2]!; let sign = 0;
  const outer = (corner: number) => wheels[corner < 2 ? corner : count + 1 - corner]!;
  for (let i = 0; i < 4; i++) {
    const a = outer(i), b = outer((i + 1) % 4);
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(cross) < 1e-5) continue;
    if (sign && cross * sign < 0) return false; sign = cross;
  }
  return true;
}
