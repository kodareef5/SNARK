// Authored compound shapes shared by static collision and every vehicle/actor interaction query.
import { quatMul, quatRotate } from "../math/quat.ts";
import { detCos, detSin, len3 } from "../math/scalar.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import type { BoatSpec, BoatVehicleDefinition, RotorVehicleDefinition } from "../sim/vehicle.ts";
import { box, shape, tube, type Shape, type SolidFrame } from "./vehicle-solid.ts";
export interface BoatFrame extends VehicleFrame { steering?: number }
const q = new Float64Array(4), jointQ = new Float64Array(4), point = new Float64Array(3);
/** The outboard's axis is yaw=-steering: positive helm turns the bow toward local +X by pushing the stern toward -X. */
export function boatOutboardFrame(frame: BoatFrame, p: BoatSpec): SolidFrame {
  vehicleRotation(frame, q);
  const pivot = p.outboard?.pivot ?? [0, 0, 0];
  quatRotate(q, 0, pivot[0]!, pivot[1]!, pivot[2]!, point, 0);
  const angle = p.outboard ? -(frame.steering ?? 0) : 0;
  jointQ.set([0, detSin(angle / 2), 0, detCos(angle / 2)]); quatMul(q, 0, q, 0, jointQ, 0);
  return { x: frame.x + point[0]!, y: frame.y + point[1]!, z: frame.z + point[2]!, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
}
const boats = new WeakMap<BoatVehicleDefinition, Shape[]>();
export function boatShapes(def: BoatVehicleDefinition): readonly Shape[] {
  let parts = boats.get(def);
  if (!parts) {
    const p = def.spec.propeller, pivot = def.spec.outboard?.pivot ?? [0, 0, 0], at = p.at.map((n, i) => n - pivot[i]!);
    const prop = shape(tube([at[0]!, at[1]!, at[2]! - .06], [at[0]!, at[1]!, at[2]! + .06], [1, 0, 0], [0, 1, 0], p.radius, p.radius, 12), true);
    prop.joint = 0;
    parts = [prop, ...def.spec.hullBoxes.map(b => box(b.at, b.half))];
    for (const b of def.spec.outboard?.boxes ?? []) { const part = box(b.at.map((n, i) => n - pivot[i]!), b.half); part.joint = 0; parts.push(part); }
    boats.set(def, parts);
  }
  return parts;
}
const helicopters = new WeakMap<RotorVehicleDefinition, Shape[]>();
export function helicopterShapes(def: RotorVehicleDefinition): Shape[] {
  const cached = helicopters.get(def); if (cached) return cached;
  const p = def.spec, parts: Shape[] = [];
  for (const r of def.rotors) {
    const n = r.axis, initial = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = [n[1] * initial[2]! - n[2] * initial[1]!, n[2] * initial[0]! - n[0] * initial[2]!, n[0] * initial[1]! - n[1] * initial[0]!];
    const l = len3(u[0]!, u[1]!, u[2]!); for (let i = 0; i < 3; i++) u[i] = u[i]! / l;
    const v = [n[1] * u[2]! - n[2] * u[1]!, n[2] * u[0]! - n[0] * u[2]!, n[0] * u[1]! - n[1] * u[0]!];
    parts.push(shape(tube(r.at.map((c, i) => c - n[i]! * 0.035), r.at.map((c, i) => c + n[i]! * 0.035), u, v, r.radius, r.radius, 24), true));
  }
  parts.push(box([0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength]));
  if (p.engineBox) parts.push(box(p.engineBox.at, p.engineBox.half));
  for (const part of p.bodyBoxes ?? []) parts.push(box(part.at, part.half));
  for (const side of [-1, 1]) parts.push(box([side * p.skidHalfWidth, 0.1, 0.05], [0.075, 0.075, p.skidHalfLength + 0.2]));
  parts.push(shape(tube(p.tail.from, p.tail.to, [1, 0, 0], [0, 1, 0], p.tail.radius, p.tail.tipRadius ?? p.tail.radius, 8)));
  for (const part of p.tail.boxes ?? []) parts.push(box(part.at, part.half));
  helicopters.set(def, parts); return parts;
}
