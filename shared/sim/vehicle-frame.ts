import { quatAxis, quatMul, quatNormalize, quatRotate, quatUnrotate, type Numbers } from "../math/quat.ts";
import { detCos, detSin } from "../math/scalar.ts";
import { rayBox } from "../world/ray.ts";
import type { VehicleDefinition } from "./vehicle.ts";

/**
 * Distance along a ray (unit direction) to a vehicle's hull at (x, y, z) turned `yaw` radians, or Infinity. The hull is the
 * chassis' footprint from the ground up to `top`: its roof for what a look meets, its belt line for what a shot meets, so
 * a shot through the open cabin reaches the people in it. It is the mechanical shape, whatever mesh draws the vehicle.
 */
export function rayVehicle(def: VehicleDefinition, x: number, y: number, z: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, top: number, attitude?: Pick<VehicleFrame, "pitch" | "roll" | "qx" | "qy" | "qz" | "qw">): number {
  const s = def.spec, sn = detSin(yaw), cs = detCos(yaw), rx = ox - x, rz = oz - z;
  if (attitude?.qx !== undefined && attitude.qy !== undefined && attitude.qz !== undefined && attitude.qw !== undefined) {
    vehicleRotation({ x, y, z, yaw, ...attitude }, rayRotation);
    quatUnrotate(rayRotation, 0, rx, oy - y, rz, rayOrigin, 0);
    quatUnrotate(rayRotation, 0, dx, dy, dz, rayDirection, 0);
    return rayBox(rayOrigin[0]!, rayOrigin[1]!, rayOrigin[2]!, rayDirection[0]!, rayDirection[1]!, rayDirection[2]!, -s.halfWidth, 0, -s.halfLength, s.halfWidth, top, s.halfLength);
  }
  // Into the chassis frame: +X the driver's left (cos, -sin), +Z forward (sin, cos).
  return rayBox(cs * rx - sn * rz, oy - y, sn * rx + cs * rz, cs * dx - sn * dz, dy, sn * dx + cs * dz, -s.halfWidth, 0, -s.halfLength, s.halfWidth, top, s.halfLength);
}

export interface VehicleFrame { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; qx?: number; qy?: number; qz?: number; qw?: number }
const rayRotation = new Float64Array(4), rayOrigin = new Float64Array(3), rayDirection = new Float64Array(3);
const yaw = new Float64Array(4), roll = new Float64Array(4), pitch = new Float64Array(4), rotation = new Float64Array(4);

/** Same attitude convention as the chassis collision: yaw * roll * nose-up pitch. */
export function vehicleRotation(frame: VehicleFrame, out: Numbers): void {
  if (frame.qx !== undefined && frame.qy !== undefined && frame.qz !== undefined && frame.qw !== undefined) {
    out[0] = frame.qx; out[1] = frame.qy; out[2] = frame.qz; out[3] = frame.qw;
    quatNormalize(out, 0); return;
  }
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
