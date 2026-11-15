import { quatAxis, quatMul, quatRotate, type Numbers } from "../math/quat.ts";
import { detCos, detSin } from "../math/scalar.ts";
import { rayBox } from "../world/ray.ts";
import type { VehicleDefinition } from "./vehicle.ts";

/**
 * Distance along a ray (unit direction) to a vehicle's hull at (x, y, z) turned `yaw` radians, or Infinity. The hull is the
 * chassis' footprint from the ground up to `top`: its roof for what a look meets, its belt line for what a shot meets, so
 * a shot through the open cabin reaches the people in it. It is the mechanical shape, whatever mesh draws the vehicle.
 */
export function rayVehicle(def: VehicleDefinition, x: number, y: number, z: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, top: number): number {
  const s = def.spec, sn = detSin(yaw), cs = detCos(yaw), rx = ox - x, rz = oz - z;
  // Into the chassis frame: +X the driver's left (cos, -sin), +Z forward (sin, cos).
  return rayBox(cs * rx - sn * rz, oy - y, sn * rx + cs * rz, cs * dx - sn * dz, dy, sn * dx + cs * dz, -s.halfWidth, 0, -s.halfLength, s.halfWidth, top, s.halfLength);
}

export interface VehicleFrame { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }
const yaw = new Float64Array(4), roll = new Float64Array(4), pitch = new Float64Array(4), rotation = new Float64Array(4);

/** Same attitude convention as the chassis collision: yaw * roll * nose-up pitch. */
export function vehicleRotation(frame: VehicleFrame, out: Numbers): void {
  quatAxis(yaw, 0, 0, 1, 0, frame.yaw);
  quatAxis(roll, 0, 0, 0, 1, frame.roll);
  quatAxis(pitch, 0, 1, 0, 0, -frame.pitch);
  quatMul(out, 0, yaw, 0, roll, 0);
  quatMul(out, 0, out, 0, pitch, 0);
}

/** Use for seats, approach markers, cameras and hit geometry, never a separate yaw-only attachment. */
export function vehiclePoint(frame: VehicleFrame, local: ArrayLike<number>, out: Numbers): void {
  vehicleRotation(frame, rotation);
  quatRotate(rotation, 0, local[0]!, local[1]!, local[2]!, out, 0);
  out[0] = out[0]! + frame.x; out[1] = out[1]! + frame.y; out[2] = out[2]! + frame.z;
}
