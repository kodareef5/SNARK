// Where a rider sits on its mount: in the seat socket's whole frame on the mount as it is posed, so a rider leans,
// pitches and banks as the seat does. The server pins a rider so and hits it there (server/riding.ts, server/combat.ts),
// and the client draws it so (client/core/render/characters.ts).

import type { Registry } from "../content/registry.ts";
import { detCos, detSin } from "../math/scalar.ts";
import type { Seat } from "../sim/seats.ts";
import { RIDER_HANDS, RIDER_FEET, RIDER_KNEES, RIDER_SOLES, RIDER_SOLE_L, RIDER_SOLE_HALF, RIDER_GRIPS, RIDER_GRIP_RADIUS, RIDER_GRIP_LOW, RIDER_GRIP_HIGH, RIDER_FOREARM_ALIGNMENT } from "./rider-controls.ts";
import type { Rig } from "./rigs.ts";
import { poseCreatureOn, type CreatureAnim } from "./creature.ts";
import type { Socket } from "./human.ts";
import type { AnimState } from "./pose.ts";
import { boneToModel, type Solved } from "./skeleton.ts";
import type { CollisionWorld } from "../world/collide.ts";

/** Metres a rider's origin hangs below its seat, along the seat's up. */
export const SEAT_DROP = 0.55;
/** Numbers `seatFrame` writes: the rider's origin, then the rows of its turn. */
export const SEAT_FLOATS = 12;

const socketAt = new Float64Array(3);
const fitFrame = new Float64Array(SEAT_FLOATS);
const fitPoint = new Float64Array(3);

/**
 * Writes where a rider sits on a creature posed as `solved`, whose origin is at (x, y, z) and which faces `yaw` radians:
 * the rider's origin at out[0..2], `drop` (default SEAT_DROP) below the socket along its up, and the turn at out[3..11], the
 * rows of the matrix that turns by the seat bone's turn from rest and then by the creature's yaw. At rest the turn is the
 * yaw alone and the origin is straight below the socket.
 */
export function seatFrame(solved: Solved, socket: Socket, x: number, y: number, z: number, yaw: number, out: Float64Array, drop = SEAT_DROP): void {
  boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, socketAt);
  const q = solved.rot;
  const b = socket.bone * 4;
  const qx = q[b]!, qy = q[b + 1]!, qz = q[b + 2]!, qw = q[b + 3]!;
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
  const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
  const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
  // The origin in the creature's own space, then turned by its yaw (x' = c x + s z, z' = c z - s x) and placed.
  const mx = socketAt[0]! - r01 * drop;
  const my = socketAt[1]! - r11 * drop;
  const mz = socketAt[2]! - r21 * drop;
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
export function seatOn(anim: CreatureAnim | null, seat: Seat, st: AnimState, tick: number, x: number, y: number, z: number, yaw: number, out: Float64Array, world?: CollisionWorld): void {
  const rig = anim?.rig;
  const socket = seat.socket !== undefined ? rig?.sockets.get(seat.socket) : undefined;
  if (!anim || !rig || !socket) return anchorFrame(seat.anchor, x, y, z, yaw, out);
  poseCreatureOn(anim, st, tick, world, x, y, z, yaw);
  seatFrame(rig.solved, socket, x, y, z, yaw, out);
}


/** Writes authored contacts into the rider's local seat frame, retaining the real posed saddle geometry. */
export function riderTargets(rig: Rig, solved: Solved, seat: Seat, out: Float64Array): boolean {
  out[0] = 0;
  out[RIDER_FOREARM_ALIGNMENT] = 0;
  const controls = seat.rider, socket = seat.socket ? rig.sockets.get(seat.socket) : undefined;
  if (!controls || !socket) return false;
  seatFrame(solved, socket, 0, 0, 0, 0, fitFrame);
  const count = controls.knees ? 6 : 4;
  for (let i = 0; i < count; i++) {
    const name = i < 2 ? controls.hands[i] : i < 4 ? controls.feet[i - 2] : controls.knees![i - 4];
    const contact = rig.sockets.get(name!);
    if (!contact) return false;
    boneToModel(solved, contact.bone, contact.x, contact.y, contact.z, fitPoint);
    const x = fitPoint[0]! - fitFrame[0]!, y = fitPoint[1]! - fitFrame[1]!, z = fitPoint[2]! - fitFrame[2]!;
    const at = 1 + i * 3;
    out[at] = fitFrame[3]! * x + fitFrame[6]! * y + fitFrame[9]! * z;
    out[at + 1] = fitFrame[4]! * x + fitFrame[7]! * y + fitFrame[10]! * z;
    out[at + 2] = fitFrame[5]! * x + fitFrame[8]! * y + fitFrame[11]! * z;
  }
  out[0] = RIDER_HANDS | RIDER_FEET | (controls.knees ? RIDER_KNEES : 0);
  if (controls.grips) {
    out[0] |= RIDER_GRIPS;
    out[RIDER_GRIP_RADIUS] = controls.grips.radius;
    out[RIDER_GRIP_LOW] = controls.grips.span[0]; out[RIDER_GRIP_HIGH] = controls.grips.span[1];
    out[RIDER_FOREARM_ALIGNMENT] = controls.grips.forearmAlignment ?? 0;
    // Independently rotating bars are not supported by this upright calibration. Retain marker fitting, with an
    // explicit failed calibration/residual, instead of silently claiming a rotated cylinder was grasped.
    for (const name of controls.hands) if (rig.sockets.get(name)?.bone !== socket.bone) out[RIDER_GRIP_RADIUS] = Number.NaN;
  }
  if (controls.soles) {
    for (let side = 0; side < 2; side++) {
      const contact = rig.sockets.get(controls.soles.sockets[side]!);
      // Sole metadata is optional. Missing or independently rotating supports retain the known ankle contacts.
      if (!contact || contact.bone !== socket.bone) return true;
      boneToModel(solved, contact.bone, contact.x, contact.y, contact.z, fitPoint);
      const x = fitPoint[0]! - fitFrame[0]!, y = fitPoint[1]! - fitFrame[1]!, z = fitPoint[2]! - fitFrame[2]!, at = RIDER_SOLE_L + side * 3;
      out[at] = fitFrame[3]! * x + fitFrame[6]! * y + fitFrame[9]! * z;
      out[at + 1] = fitFrame[4]! * x + fitFrame[7]! * y + fitFrame[10]! * z;
      out[at + 2] = fitFrame[5]! * x + fitFrame[8]! * y + fitFrame[11]! * z;
    }
    out[RIDER_SOLE_HALF] = controls.soles.half[0]; out[RIDER_SOLE_HALF + 1] = controls.soles.half[1];
    out[0] |= RIDER_SOLES;
  }
  return true;
}
