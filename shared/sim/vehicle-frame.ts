import { quatAxis, quatMul, quatNormalize, quatRotate, quatUnrotate, type Numbers } from "../math/quat.ts";
import { detCos, detSin } from "../math/scalar.ts";
import { rayBox } from "../world/ray.ts";
import { boatDrives, isWheelVehicle, type VehicleDefinition } from "./vehicle.ts";

/**
 * Distance along a ray (unit direction) to a vehicle's hull at (x, y, z) turned `yaw` radians, or Infinity. The hull is the
 * chassis' footprint from the ground up to `top`: its roof for what a look meets, its belt line for what a shot meets, so
 * a shot through the open cabin reaches the people in it. It is the mechanical shape, whatever mesh draws the vehicle.
 */
export function rayVehicle(def: VehicleDefinition, x: number, y: number, z: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, top: number, attitude?: Pick<VehicleFrame, "pitch" | "roll" | "qx" | "qy" | "qz" | "qw" | "steering">): number {
  const s = def.spec, sn = detSin(yaw), cs = detCos(yaw), rx = ox - x, rz = oz - z;
  const boxes = def.movement === "boat" ? def.spec.hullBoxes : isWheelVehicle(def) ? def.spec.bodyBoxes : undefined;
  if (boxes) {
    vehicleRotation({ x, y, z, yaw, pitch: 0, roll: 0, ...attitude }, rayRotation);
    quatUnrotate(rayRotation, 0, rx, oy - y, rz, rayOrigin, 0);
    quatUnrotate(rayRotation, 0, dx, dy, dz, rayDirection, 0);
    let near = Infinity;
    for (const box of boxes) {
      const low = box.at[1] - box.half[1], high = Math.min(top, box.at[1] + box.half[1]);
      if (low >= high) continue;
      near = Math.min(near, rayBox(rayOrigin[0]!, rayOrigin[1]!, rayOrigin[2]!, rayDirection[0]!, rayDirection[1]!, rayDirection[2]!,
        box.at[0] - box.half[0], low, box.at[2] - box.half[2], box.at[0] + box.half[0], high, box.at[2] + box.half[2]));
    }
    if (def.movement === "boat") for (const drive of boatDrives(def.spec)) {
      const motor = drive.outboard;
      if (!motor) continue;
      // The articulated motor yaws by -steering around its authored pivot. Keep rays in that same joint frame.
      const sn = detSin(-(attitude?.steering ?? 0)), cs = detCos(-(attitude?.steering ?? 0)), pivot = motor.pivot;
      const px = rayOrigin[0]! - pivot[0], pz = rayOrigin[2]! - pivot[2];
      const mx = cs * px - sn * pz, mz = sn * px + cs * pz, my = rayOrigin[1]! - pivot[1];
      const vx = cs * rayDirection[0]! - sn * rayDirection[2]!, vz = sn * rayDirection[0]! + cs * rayDirection[2]!;
      for (const box of motor.boxes) {
        const low = box.at[1] - box.half[1], high = Math.min(top, box.at[1] + box.half[1]);
        if (low >= high) continue;
        near = Math.min(near, rayBox(mx, my, mz, vx, rayDirection[1]!, vz,
          box.at[0] - box.half[0] - pivot[0], low - pivot[1], box.at[2] - box.half[2] - pivot[2],
          box.at[0] + box.half[0] - pivot[0], high - pivot[1], box.at[2] + box.half[2] - pivot[2]));
      }
    }
    return near;
  }
  if (attitude?.qx !== undefined && attitude.qy !== undefined && attitude.qz !== undefined && attitude.qw !== undefined) {
    vehicleRotation({ x, y, z, yaw, ...attitude }, rayRotation);
    quatUnrotate(rayRotation, 0, rx, oy - y, rz, rayOrigin, 0);
    quatUnrotate(rayRotation, 0, dx, dy, dz, rayDirection, 0);
    return rayBox(rayOrigin[0]!, rayOrigin[1]!, rayOrigin[2]!, rayDirection[0]!, rayDirection[1]!, rayDirection[2]!, -s.halfWidth, 0, -s.halfLength, s.halfWidth, top, s.halfLength);
  }
  // Into the chassis frame: +X the driver's left (cos, -sin), +Z forward (sin, cos).
  return rayBox(cs * rx - sn * rz, oy - y, sn * rx + cs * rz, cs * dx - sn * dz, dy, sn * dx + cs * dz, -s.halfWidth, 0, -s.halfLength, s.halfWidth, top, s.halfLength);
}

/**
 * Distance along a ray to where the use key meets a vehicle, or Infinity: a boat by its whole hull, keel to roof, so its
 * open cockpit and a catamaran's tunnel are looked at too, and anything else by its hull as rayVehicle has it. Shots and
 * name tags meet only a boat's solid parts.
 */
export function useVehicle(def: VehicleDefinition, x: number, y: number, z: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, attitude?: Pick<VehicleFrame, "pitch" | "roll" | "qx" | "qy" | "qz" | "qw" | "steering">): number {
  const s = def.spec, parts = rayVehicle(def, x, y, z, yaw, ox, oy, oz, dx, dy, dz, s.height, attitude);
  if (def.movement !== "boat") return parts;
  // rayVehicle has just put the ray in the hull's frame.
  return Math.min(parts, rayBox(rayOrigin[0]!, rayOrigin[1]!, rayOrigin[2]!, rayDirection[0]!, rayDirection[1]!, rayDirection[2]!,
    -s.halfWidth, 0, -s.halfLength, s.halfWidth, s.height, s.halfLength));
}

/** A two-sided authored triangle, tested in chassis space so inversion needs no special case. */
function panelTriangle(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): number {
  const dx = rayDirection[0]!, dy = rayDirection[1]!, dz = rayDirection[2]!;
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  const px = dy * vz - dz * vy, py = dz * vx - dx * vz, pz = dx * vy - dy * vx;
  const det = ux * px + uy * py + uz * pz;
  if (Math.abs(det) < 1e-9) return Infinity;
  const x = rayOrigin[0]! - a[0]!, y = rayOrigin[1]! - a[1]!, z = rayOrigin[2]! - a[2]!;
  const u = (x * px + y * py + z * pz) / det;
  if (u < 0 || u > 1) return Infinity;
  const qx = y * uz - z * uy, qy = z * ux - x * uz, qz = x * uy - y * ux;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (vx * qx + vy * qy + vz * qz) / det;
  return t >= 0 ? t : Infinity;
}

/** Projectiles and aiming beams share the same cabin openings and historical attitude. */
export function rayVehicleCover(def: VehicleDefinition, x: number, y: number, z: number, yaw: number,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, attitude: Omit<VehicleFrame, "x" | "y" | "z" | "yaw">): number {
  let t = rayVehicle(def, x, y, z, yaw, ox, oy, oz, dx, dy, dz, def.beltline, attitude);
  if (!def.shotPanels || t === 0) return t;
  // The hull just prepared the local ray when given a quaternion. Also support callers with Euler attitude only.
  if (attitude.qx === undefined || attitude.qy === undefined || attitude.qz === undefined || attitude.qw === undefined) {
    vehicleRotation({ x, y, z, yaw, pitch: attitude.pitch, roll: attitude.roll }, rayRotation);
    quatUnrotate(rayRotation, 0, ox - x, oy - y, oz - z, rayOrigin, 0);
    quatUnrotate(rayRotation, 0, dx, dy, dz, rayDirection, 0);
  }
  const s = def.spec;
  const near = rayBox(rayOrigin[0]!, rayOrigin[1]!, rayOrigin[2]!, rayDirection[0]!, rayDirection[1]!, rayDirection[2]!,
    -s.halfWidth, def.beltline, -s.halfLength, s.halfWidth, s.height, s.halfLength);
  if (near >= t) return t;
  for (const [a,b,c,d] of def.shotPanels) t = Math.min(t, panelTriangle(a,b,c), panelTriangle(a,c,d));
  return t;
}

export interface VehicleFrame { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; qx?: number; qy?: number; qz?: number; qw?: number; steering?: number }
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
  quatNormalize(out, 0);
}

/** Use for seats, approach markers, cameras and hit geometry, never a separate yaw-only attachment. */
export function vehiclePoint(frame: VehicleFrame, local: ArrayLike<number>, out: Numbers): void {
  vehicleRotation(frame, rotation);
  quatRotate(rotation, 0, local[0]!, local[1]!, local[2]!, out, 0);
  out[0] = out[0]! + frame.x; out[1] = out[1]! + frame.y; out[2] = out[2]! + frame.z;
}
