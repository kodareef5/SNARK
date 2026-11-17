// Car rigid-body math shared by wheel forces, static collision and authoritative dynamic contacts.
import { quatAxis, quatMul, quatNormalize, quatRotate, quatUnrotate, type Numbers } from "../math/quat.ts";
import { detAtan2, detCos, detSin, len3 } from "../math/scalar.ts";
import { vehicleMass } from "./vehicle-drivetrain.ts";
import { vehicleRotation, type VehicleFrame } from "./vehicle-frame.ts";
import type { VehicleHullSpec } from "./vehicle.ts";

/** x/y/z is the authored ground-base origin. Linear velocity is at the COM. Body-local omega is (-pitchRate,yawRate,rollRate). */
export interface VehicleRigidState extends VehicleFrame {
  vx: number; vy: number; vz: number; pitchRate: number; yawRate: number; rollRate: number; payloadMass: number; flooding?: number;
}
export interface VehicleRigidSpec extends VehicleHullSpec { wheelbase?: number; track?: number; yawInertia?: number; centerOfMass?: readonly number[]; displacement?: number; liftMass?: number }
export interface VehicleMassProperties { mass: number; inverseMass: number; ix: number; iy: number; iz: number; comX: number; comY: number; comZ: number }
const properties: VehicleMassProperties = { mass: 0, inverseMass: 0, ix: 0, iy: 0, iz: 0, comX: 0, comY: 0, comZ: 0 };
const q = new Float64Array(4), turn = new Float64Array(4), arm = new Float64Array(3), v = new Float64Array(3), local = new Float64Array(3), up = new Float64Array(3), ahead = new Float64Array(3);
/** Scratch result, consumed before another helper call. The yaw inertia retains the existing axle/track tuning. */
export function vehicleMassProperties(p: VehicleRigidSpec, s: Pick<VehicleRigidState, "payloadMass" | "flooding">): VehicleMassProperties {
  const mass = vehicleMass(p, s) + (p.displacement ?? 0) * .38 * (s.flooding ?? 0), length = p.halfLength * 2, width = p.halfWidth * 2;
  properties.mass = mass; properties.inverseMass = 1 / mass; properties.comX = p.centerOfMass?.[0] ?? 0; properties.comY = p.centerOfMass?.[1] ?? (p.liftMass ? 0 : p.height * .35); properties.comZ = p.centerOfMass?.[2] ?? 0;
  properties.ix = mass * (length * length + p.height * p.height) / 12;
  properties.iy = mass * ((p.wheelbase ?? length) * (p.wheelbase ?? length) + (p.track ?? width) * (p.track ?? width)) / 12 * (p.yawInertia ?? (p.wheelbase ? 1.2 : 1));
  properties.iz = mass * (width * width + p.height * p.height) / 12;
  return properties;
}
function localArm(s: VehicleRigidState, p: VehicleRigidSpec, x: number, y: number, z: number): void {
  vehicleRotation(s, q); quatUnrotate(q, 0, x - s.x, y - s.y, z - s.z, arm, 0); const { comX, comY, comZ } = vehicleMassProperties(p, s); arm[0] -= comX; arm[1] -= comY; arm[2] -= comZ;
}
/** World velocity at a world point. `out` may be a caller-owned typed scratch vector. */
export function vehiclePointVelocity(s: VehicleRigidState, p: VehicleRigidSpec, x: number, y: number, z: number, out: Numbers): void {
  localArm(s, p, x, y, z);
  const wx = -s.pitchRate, wy = s.yawRate, wz = s.rollRate;
  quatRotate(q, 0, wy * arm[2]! - wz * arm[1]!, wz * arm[0]! - wx * arm[2]!, wx * arm[1]! - wy * arm[0]!, out, 0);
  out[0] += s.vx; out[1] += s.vy; out[2] += s.vz;
}
/** Effective inverse mass along a unit world direction, including rotational response at the world point. */
export function vehiclePointInverseMass(s: VehicleRigidState, p: VehicleRigidSpec, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  localArm(s, p, x, y, z); quatUnrotate(q, 0, nx, ny, nz, local, 0);
  const { inverseMass, ix, iy, iz } = vehicleMassProperties(p, s);
  const tx = arm[1]! * local[2]! - arm[2]! * local[1]!, ty = arm[2]! * local[0]! - arm[0]! * local[2]!, tz = arm[0]! * local[1]! - arm[1]! * local[0]!;
  return inverseMass + tx * tx / ix + ty * ty / iy + tz * tz / iz;
}
/** Apply a world impulse (N*s) at a world point. No damage, authority or restitution policy lives here. */
export function applyVehicleImpulse(s: VehicleRigidState, p: VehicleRigidSpec, x: number, y: number, z: number, jx: number, jy: number, jz: number): void {
  localArm(s, p, x, y, z); quatUnrotate(q, 0, jx, jy, jz, local, 0);
  const { inverseMass, ix, iy, iz } = vehicleMassProperties(p, s);
  s.vx += jx * inverseMass; s.vy += jy * inverseMass; s.vz += jz * inverseMass;
  s.pitchRate -= (arm[1]! * local[2]! - arm[2]! * local[1]!) / ix;
  s.yawRate += (arm[2]! * local[0]! - arm[0]! * local[2]!) / iy;
  s.rollRate += (arm[0]! * local[1]! - arm[1]! * local[0]!) / iz;
}
/** Integrates the COM and rotates the authored origin around it. Euler fields are derived presentation only. */
export function integrateVehiclePose(s: VehicleRigidState, p: VehicleRigidSpec, dt: number): void {
  const { comX, comY, comZ } = vehicleMassProperties(p, s);
  vehicleRotation(s, q); quatRotate(q, 0, comX, comY, comZ, v, 0);
  const cx = s.x + v[0]! + s.vx * dt, cy = s.y + v[1]! + s.vy * dt, cz = s.z + v[2]! + s.vz * dt;
  const wx = -s.pitchRate, wy = s.yawRate, wz = s.rollRate, speed = len3(wx, wy, wz);
  if (speed > 1e-10) { quatAxis(turn, 0, wx / speed, wy / speed, wz / speed, speed * dt); quatMul(q, 0, q, 0, turn, 0); quatNormalize(q, 0); }
  s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
  quatRotate(q, 0, comX, comY, comZ, v, 0); s.x = cx - v[0]!; s.y = cy - v[1]!; s.z = cz - v[2]!;
  quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, ahead, 0);
  const horizontal = Math.sqrt(ahead[0]! * ahead[0]! + ahead[2]! * ahead[2]!);
  if (horizontal > 1e-6) s.yaw = detAtan2(ahead[0]!, ahead[2]!);
  s.pitch = detAtan2(ahead[1]!, horizontal); s.roll = detAtan2(-(up[0]! * detCos(s.yaw) - up[2]! * detSin(s.yaw)), up[1]!);
}
