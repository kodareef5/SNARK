// Authored compound shapes shared by static collision and every vehicle/actor interaction query.
import { quatMul, quatRotate } from "../math/quat.ts";
import { detCos, detSin, len3 } from "../math/scalar.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import type { BoatSpec, BoatVehicleDefinition, RotorVehicleDefinition, VehicleSpec } from "../sim/vehicle.ts";
import { box, makeSolid, shape, tube, type Shape, type SolidFrame } from "./vehicle-solid.ts";
export interface BoatFrame extends VehicleFrame { steering?: number }
const q = new Float64Array(4), jointQ = new Float64Array(4), point = new Float64Array(3);
const cars = new WeakMap<VehicleSpec, readonly Shape[]>();
/** A rigid underbody bevel beyond each axle keeps the authored approach/departure clearance on built ramps too. */
export function carShapes(p: VehicleSpec): readonly Shape[] {
  const known = cars.get(p); if (known) return known;
  const solid = makeSolid(), axle = Math.min(p.halfLength, p.wheelbase / 2), track = Math.min(p.halfWidth, p.track / 2);
  const rise = Math.min(p.height - p.clearance, (p.halfLength - axle) * .3);
  const sideRise = Math.min(rise, (p.halfWidth - track) * .8), shoulder = axle + sideRise / .3;
  const bumperTop = Math.max(p.clearance + rise + .05, p.height * .35 - .05);
  const roofEnd = Math.max(axle, p.halfLength - .35), endSlope = (p.halfLength - roofEnd) / (p.height - bumperTop);
  const vertices: number[][] = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    vertices.push([x * track, p.clearance, z * axle], [x * p.halfWidth, p.clearance + sideRise, z * shoulder],
      [x * p.halfWidth, p.clearance + rise, z * p.halfLength], [x * p.halfWidth, bumperTop, z * p.halfLength], [x * p.halfWidth, p.height, z * roofEnd]);
  }
  for (let i = 0; i < vertices.length; i++) solid.at.set(vertices[i]!, i * 3);
  // The upper ends slope back toward the cabin, so a bumper is not a broad flat support face on which a car
  // can balance vertically. This is collision geometry, not an upright-rest force.
  const faces = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, endSlope, 1], [0, endSlope, -1], [.8, -1, 0], [-.8, -1, 0], [0, -1, .3], [0, -1, -.3]];
  const edges = [[1, 0, 0], [0, 1, 0], [0, 1, endSlope], [0, 1, -endSlope], [0, 0, 1], [1, .8, 0], [1, -.8, 0], [0, .3, 1], [0, -.3, 1],
    [1, .8, .8 / .3], [1, .8, -.8 / .3], [1, -.8, .8 / .3], [1, -.8, -.8 / .3]];
  solid.corners = vertices.length; solid.faces = faces.length; solid.edges = edges.length;
  for (const [vectors, out] of [[faces, solid.face], [edges, solid.edge]] as const) for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]!, length = len3(v[0]!, v[1]!, v[2]!); out.set(v.map(n => n / length), i * 3);
  }
  const parts = [shape(solid)]; cars.set(p, parts); return parts;
}
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
