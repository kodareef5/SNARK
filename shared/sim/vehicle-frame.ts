import { quatAxis, quatMul, quatRotate, type Numbers } from "../math/quat.ts";

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
