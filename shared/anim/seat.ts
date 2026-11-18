// Where a rider sits on its mount: in the seat socket's whole frame on the mount as it is posed, so a rider leans,
// pitches and banks as the seat does. The server pins a rider so and hits it there (server/riding.ts, server/combat.ts),
// and the client draws it so (client/core/render/characters.ts).

import type { Registry } from "../content/registry.ts";
import { detCos, detSin } from "../math/scalar.ts";
import type { Seat } from "../sim/seats.ts";
import type { MoveParams } from "../sim/character.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { groundMountPose } from "./ground-mount.ts";
import { creaturePose, type CreatureAnim } from "./creature.ts";
import type { Socket } from "./human.ts";
import type { AnimState } from "./pose.ts";
import { boneToModel, solve, Solved } from "./skeleton.ts";

/** Metres a rider's origin hangs below its seat, along the seat's up. */
export const SEAT_DROP = 0.55;
/** Numbers `seatFrame` writes: the rider's origin, then the rows of its turn. */
export const SEAT_FLOATS = 12;

const socketAt = new Float64Array(3);
const anchorSolved = new Solved(1);
const anchorSocket = { bone: 0, x: 0, y: 0, z: 0 };

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

/** As seatFrame for a seat with no socket to follow: at its anchor on the creature, turned by the creature's yaw alone. */
export function anchorFrame(anchor: readonly [number, number, number], x: number, y: number, z: number, yaw: number, out: Float64Array): void {
  const s = detSin(yaw);
  const c = detCos(yaw);
  out[0] = x + c * anchor[0] + s * anchor[2];
  out[1] = y + anchor[1] - SEAT_DROP;
  out[2] = z + c * anchor[2] - s * anchor[0];
  out[3] = c;
  out[4] = 0;
  out[5] = s;
  out[6] = 0;
  out[7] = 1;
  out[8] = 0;
  out[9] = -s;
  out[10] = 0;
  out[11] = c;
}

/** Seat `slot` (1 for its first) of the saddle `saddle` (an item), or null. */
export function saddleSeat(reg: Registry, saddle: number, slot: number): Seat | null {
  return reg.saddleSeats[saddle]?.[slot - 1] ?? null;
}

/**
 * seatFrame for `seat` on a creature of `anim` (null for one with no rig) posed by `st` at `tick`: on the seat's socket
 * where the rig has it, else at its anchor (anchorFrame).
 */
export function seatOn(anim: CreatureAnim | null, seat: Seat, st: AnimState, tick: number, x: number, y: number, z: number, yaw: number, out: Float64Array, world?: CollisionWorld, move?: MoveParams | null): void {
  const rig = anim?.rig;
  const socket = seat.socket !== undefined ? rig?.sockets.get(seat.socket) : undefined;
  if (!anim || !rig || !socket) {
    if (!world || !move) return anchorFrame(seat.anchor, x, y, z, yaw, out);
    anchorSolved.pos.set(seat.anchor); anchorSolved.rot.set([0, 0, 0, 1]);
    groundMountPose(anchorSolved, st, world, move, x, y, z, yaw);
    return seatFrame(anchorSolved, anchorSocket, x, y, z, yaw, out);
  }
  creaturePose(anim, st, tick, rig.a);
  solve(rig, rig.a, rig.solved);
  if (world && move) groundMountPose(rig.solved, st, world, move, x, y, z, yaw);
  seatFrame(rig.solved, socket, x, y, z, yaw, out);
}
