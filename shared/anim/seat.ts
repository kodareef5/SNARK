// Where a rider sits on its mount: in the seat socket's whole frame on the mount as it is posed, so a rider leans,
// pitches and banks as the seat does. The client draws a rider so (client/core/render/characters.ts).

import { detCos, detSin } from "../math/scalar.ts";
import type { Socket } from "./human.ts";
import { boneToModel, type Solved } from "./skeleton.ts";

/** Metres a rider's origin hangs below its seat, along the seat's up. Matches server/riding.ts. */
export const SEAT_DROP = 0.55;
/** Numbers `seatFrame` writes: the rider's origin, then the rows of its turn. */
export const SEAT_FLOATS = 12;

const socketAt = new Float64Array(3);

/**
 * Writes where a rider sits on a creature posed as `solved`, whose origin is at (x, y, z) and which faces `yaw` radians:
 * the rider's origin at out[0..2], SEAT_DROP below the socket along the seat's up, and the rider's turn at out[3..11], the
 * rows of the matrix that turns by the seat bone's turn from rest and then by the creature's yaw. At rest the turn is the
 * yaw alone and the origin is straight below the socket.
 */
export function seatFrame(solved: Solved, socket: Socket, x: number, y: number, z: number, yaw: number, out: Float64Array): void {
  boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, socketAt);
  const q = solved.rot;
  const b = socket.bone * 4;
  const qx = q[b]!, qy = q[b + 1]!, qz = q[b + 2]!, qw = q[b + 3]!;
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
  // The origin in the creature's own space, then turned by its yaw (x' = c x + s z, z' = c z - s x) and placed.
  const mx = socketAt[0]! - r01 * SEAT_DROP;
  const my = socketAt[1]! - r11 * SEAT_DROP;
  const mz = socketAt[2]! - r21 * SEAT_DROP;
  const s = detSin(yaw);
  const c = detCos(yaw);
  out[0] = x + c * mx + s * mz;
  out[1] = y + my;
  out[2] = z + c * mz - s * mx;
  out[3] = c * r00 + s * r20;
  out[4] = c * r01 + s * r21;
  out[5] = c * r02 + s * r22;
  out[6] = r10;
  out[7] = r11;
  out[8] = r12;
  out[9] = c * r20 - s * r00;
  out[10] = c * r21 - s * r01;
  out[11] = c * r22 - s * r02;
}
