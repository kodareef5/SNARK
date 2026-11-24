// Authored compound shapes shared by static collision and every vehicle/actor interaction query.
import { quatMul, quatRotate } from "../math/quat.ts";
import { detCos, detSin, len3 } from "../math/scalar.ts";
import { familyOf } from "../sim/families.ts";
import { vehicleRotation, type VehicleFrame } from "../sim/vehicle-frame.ts";
import { boatDrives, type VehicleDefinition, type BoatDrive, type BoatSpec, type BoatVehicleDefinition, type RotorVehicleDefinition, type VehicleSpec } from "../sim/vehicle.ts";
import { box, makeSolid, shape, tube, type Shape, type SolidFrame, type SolidJoint } from "./vehicle-solid.ts";
export interface BoatFrame extends VehicleFrame { steering?: number }
const q = new Float64Array(4), jointQ = new Float64Array(4), point = new Float64Array(3);
const cars = new WeakMap<VehicleSpec, readonly Shape[]>();
/** A rigid underbody bevel beyond each axle keeps the authored approach/departure clearance on built ramps too. */
export function carShapes(p: VehicleSpec): readonly Shape[] {
  const known = cars.get(p); if (known) return known;
  if (p.bodyBoxes) {
    const parts = p.bodyBoxes.map(b => box(b.at, b.half));
    cars.set(p, parts);
    return parts;
  }
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
export function boatOutboardFrame(frame: BoatFrame, p: BoatDrive): SolidFrame {
  vehicleRotation(frame, q);
  const pivot = p.outboard?.pivot ?? [0, 0, 0];
  quatRotate(q, 0, pivot[0]!, pivot[1]!, pivot[2]!, point, 0);
  const angle = p.outboard ? -(frame.steering ?? 0) : 0;
  jointQ.set([0, detSin(angle / 2), 0, detCos(angle / 2)]); quatMul(q, 0, q, 0, jointQ, 0);
  return { x: frame.x + point[0]!, y: frame.y + point[1]!, z: frame.z + point[2]!, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
}
export const boatMounts = (frame: BoatFrame, p: BoatSpec): SolidFrame[] => boatDrives(p).map(drive => boatOutboardFrame(frame, drive));
export function boatJoints(from: BoatFrame, to: BoatFrame, p: BoatSpec): SolidJoint[] {
  return boatDrives(p).map(drive => {
    const start = boatOutboardFrame(from, drive);
    return { from: start, to: from === to ? start : boatOutboardFrame(to, drive) };
  });
}
const boats = new WeakMap<BoatVehicleDefinition, Shape[]>();
export function boatShapes(def: BoatVehicleDefinition): readonly Shape[] {
  const cached = boats.get(def);
  if (cached) return cached;
  const parts: Shape[] = [];
  // Test exposed propellers first, so a blade contact keeps its hazard when it overlaps the skeg.
  for (const [index, drive] of boatDrives(def.spec).entries()) {
    const p = drive.propeller, pivot = drive.outboard?.pivot ?? [0, 0, 0], at = p.at.map((n, i) => n - pivot[i]!);
    if (!p.enclosed) {
      const prop = shape(tube([at[0]!, at[1]!, at[2]! - .06], [at[0]!, at[1]!, at[2]! + .06], [1, 0, 0], [0, 1, 0], p.radius, p.radius, 12), true);
      prop.joint = index; parts.push(prop);
    }
  }
  for (const b of def.spec.hullBoxes) parts.push(box(b.at, b.half));
  for (const [index, drive] of boatDrives(def.spec).entries()) {
    if (!drive.outboard) continue;
    for (const b of drive.outboard.boxes) {
      const part = box(b.at.map((n, i) => n - drive.outboard!.pivot[i]!), b.half);
      part.joint = index; parts.push(part);
    }
  }
  boats.set(def, parts);
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

const solidRadii = new WeakMap<VehicleDefinition, number>();

/** Maximum reach from the rigid origin in any attitude, including an outboard turned about its own offset pivot. */
export function vehicleSolidRadius(def: VehicleDefinition): number {
  const cached = solidRadii.get(def);
  if (cached !== undefined) return cached;
  const family = familyOf(def);
  if (!family) return 0;
  let radius = 0;
  for (const part of family.parts(def)) {
    const pivot = part.joint === undefined ? undefined : family.jointPivot(def, part.joint);
    radius = Math.max(radius, part.radius + (pivot ? len3(...pivot) : 0));
  }
  solidRadii.set(def, radius);
  return radius;
}
