import { isSkateboard } from "../../../shared/sim/vehicle.ts";
// Where the camera goes, by what the view's subject is: behind or inside a vehicle the body drives, behind the mount it
// rides, with the seat it is a passenger in, or with the body on foot, where a body there is none of looks from where it
// last stood. Riding, a passenger's chase and on foot are where the orbit camera may place it instead. A survivor still
// being made is shown from the front. The last row of the director's three (director.ts).

import { makeHandle } from "../../../shared/ids.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { SESSION_CREATING } from "../../../shared/net/protocol.ts";
import { IMPALE_SLOT, type Seat } from "../../../shared/sim/seats.ts";
import { vehiclePoint } from "../../../shared/sim/vehicle-frame.ts";
import type { AppFrame } from "../frame.ts";
import { bodySeed } from "../render/scene.ts";
import { remoteVehiclePose } from "../vehicle-view.ts";
import { CHASE_BOOM, CHASE_TILT, ORBIT_BACK, type VehicleCameraMotion } from "../viewpoint.ts";
import type { Director } from "./director.ts";

/** Metres the orbit's camera is behind the eye before the body is drawn whole; nearer than the near plane its head is not seen. */
const HEAD_CLEAR = .1;

export function place(d: Director, f: AppFrame): void {
  const session = f.session;
  if (f.alive && f.car) driving(d, f);
  else if (f.alive && session.driving >= 0) riding(d, f);
  else if (f.passenger) seated(d, f);
  else onFoot(d, f);
  // The orbit shows the whole body once the camera is clear of the head.
  if (d.orbit.inUse && d.orbit.shown.back > HEAD_CLEAR) d.own.firstPerson = false;
  d.view.thirdPerson = f.third;
  if (session.sessionState === SESSION_CREATING) preview(d, f);
}

/** The slot of the seat that steers, 1 for the first; 0 where no seat does. */
function driverSlot(seats: readonly Seat[]): number {
  for (let k = 0; k < seats.length; k++) if (seats[k]!.driver) return k + 1;
  return 0;
}

/** The scratch motion as a chase camera's subject moves and how far back its boom holds it. */
function motionOf(d: Director, vx: number, vy: number, vz: number, id: number | undefined, boom: number, anticipate?: boolean, safeY?: number, wantedY?: number): VehicleCameraMotion {
  const m = d.motion;
  m.vx = vx; m.vy = vy; m.vz = vz; m.id = id; m.boom = boom; m.anticipate = anticipate; m.safeY = safeY; m.wantedY = wantedY;
  m.followAfter = m.followEase = m.kick = undefined;
  return m;
}

/** A point of the vehicle at `at`, given in its own frame, into the seat's scratch. */
function pointIn(d: Director, at: Parameters<typeof vehiclePoint>[0], x: number, y: number, z: number): void {
  const local = d.local;
  local[0] = x; local[1] = y; local[2] = z;
  vehiclePoint(at, local, d.seatSpot);
}

/** A vehicle the body drives: its chase camera, or the driver's eye in its cabin. */
function driving(d: Director, f: AppFrame): void {
  const session = f.session, c = f.controls, cam = f.cam, world = f.world, car = f.car!, vehiclePose = f.vehiclePose!, carYaw = f.carYaw;
  const rotor = car.movement === "rotor", boat = car.movement === "boat", at = d.carFrame, spot = d.seatSpot;
  const board = isSkateboard(car), own = session.own, speed = Math.hypot(own.vx, own.vz);
  if (f.third) {
    // The chase camera looks at two thirds of the vehicle's height from a boom one and a half times its length.
    pointIn(d, at, 0, board ? 1 : boat && !car.family ? 1.1 : rotor ? 1.65 : car.spec.height * 2 / 3, rotor || boat ? -.35 : 0);
    // A board's view follows where it travels, not the deck, which spins, slides crosswise and rides switch; a little
    // to the side, to see the rider's stance. It turns after the travel sooner than a car's, and dips as it lands.
    const travel = board && speed > .5 ? Math.atan2(own.vx, own.vz) : carYaw - (own.skate?.switched ? Math.PI : 0);
    const motion = motionOf(d, own.vx, own.vy, own.vz, session.driving, board ? 3.6 : rotor || boat ? Math.max(boat ? 8 : 10, car.spec.halfLength * 2) : car.spec.halfLength * 3);
    if (board) {
      motion.followAfter = 350; motion.followEase = 650;
      if (own.grounded && !d.boardGrounded && d.boardFall > 2) motion.kick = Math.min(2.4, d.boardFall * .35);
      d.boardGrounded = own.grounded; d.boardFall = -own.vy;
    }
    const heading = d.view.placeVehicle(cam, world, spot[0]!, spot[1]!, spot[2]!, c.yaw, c.pitch - (board ? .09 : 0), board ? travel + .24 : carYaw, speed, f.dt, !rotor && !boat, motion);
    if (!rotor && !boat) c.yaw = heading;
  } else {
    const slot = driverSlot(car.seats), ch = f.scene.characters;
    ch.seat(session.bodyKind, f.bx, f.by, f.bz, carYaw, d.own.state, session.tickClock, spot, slot, vehiclePose);
    const seat = ch.seatPose(session.bodyKind, slot, vehiclePose, spot, carYaw, undefined, d.seated);
    if (!seat || !ch.seatedEye(session.ownKind, seat, spot)) {
      const anchor = car.seats[slot - 1]!.anchor;
      pointIn(d, at, anchor[0], anchor[1] + .76, anchor[2] + .05);
    }
    d.view.placeCockpit(cam, spot[0]!, spot[1]!, spot[2]!, at, d.cockpit.yaw, d.cockpit.pitch);
  }
}

/** Authored framing takes precedence over the default boom derived from the saddle and creature's size. */
function mountView(d: Director, f: AppFrame, kind: number, saddle: number): Director["mount"] {
  const reg = f.reg, def = reg.defs[kind], out = d.mount;
  if (def?.type === "species" && def.camera) {
    out.up = def.camera.height; out.boom = def.camera.distance; out.forward = def.camera.forward ?? 0;
    return out;
  }
  const seats = reg.saddleSeats[saddle], slot = seats ? driverSlot(seats) : 0;
  const size = Math.max(f.scene.characters.reach(kind) ?? 0, reg.bodyHeight[kind]!, 2 * reg.bodyRadius[kind]!);
  out.up = slot > 0 ? seats![slot - 1]!.anchor[1] + 0.75 : reg.bodyHeight[kind]! + 0.5; out.boom = 1.5 + 1.2 * size; out.forward = 0;
  return out;
}

/**
 * Riding, the camera is behind where the rider looks, which the mount turns to and flies along: at the rider's head,
 * on a boom as long as the mount is big, and drawn in by whatever is in the way.
 */
function riding(d: Director, f: AppFrame): void {
  const session = f.session, world = f.world, dt = f.dt, lookYaw = f.lookYaw, lookPitch = f.lookPitch, body = d.own;
  const o = session.own, def = f.reg.defs[session.bodyKind];
  const obstruction = def?.type === "species" && def.camera?.avoidBody ? f.scene.prepareCameraBody(body) : null;
  const view = mountView(d, f, body.kind, body.gear[GEAR_WORN]!);
  const identity = makeHandle(body.id, body.generation!);
  const px = f.bx + Math.sin(body.yaw) * view.forward, pz = f.bz + Math.cos(body.yaw) * view.forward;
  // A posed dinosaur solves body clearance and roof height together. Other mounts anticipate the roof from inside their capsule.
  const pivot = obstruction ? f.by + view.up : d.mountCamera.height(world, identity, px, pz, f.by + (f.reg.move[body.kind]?.height ?? 1) * .5, f.by + view.up, o.vx, o.vz, dt);
  const orbit = d.orbit.place(d.chaseRig(lookYaw, lookPitch, view.boom), view.boom, dt);
  d.view.placeVehicle(f.cam, world, px, pivot, pz, orbit ? orbit.yaw : lookYaw, orbit ? orbit.pitch + CHASE_TILT : lookPitch, lookYaw, Math.hypot(o.vx, o.vy, o.vz), dt, false,
    motionOf(d, o.vx, o.vy, o.vz, identity, orbit ? orbit.back : view.boom, !obstruction, d.mountCamera.safeY, d.mountCamera.wantedY), obstruction);
}

/** A passenger: behind its host, in its host's cabin, or at its own eye where it sits. */
function seated(d: Director, f: AppFrame): void {
  const session = f.session, c = f.controls, cam = f.cam, world = f.world, r = f.remote, reg = f.reg, dt = f.dt, eye = f.eye, spot = d.seatSpot;
  const passengerVehicle = f.passengerVehicle, cockpitFrame = f.cockpitFrame, chase = f.chase, lookYaw = f.lookYaw, lookPitch = f.lookPitch;
  let px = f.bx, py = f.by + eye, pz = f.bz, heading = c.yaw, boom: number | undefined, chaseVx = 0, chaseVz = 0;
  if (!chase && passengerVehicle && cockpitFrame) {
    let host = -1;
    for (let i = 0; i < r.count && host < 0; i++) if (r.id[i] === session.own.seat - 1) host = i;
    const anchor = reg.vehicle[r.kind[host] ?? 0]?.seats[session.own.seatSlot - 1]?.anchor;
    if (anchor) {
      pointIn(d, cockpitFrame, anchor[0], anchor[1] + .76, anchor[2] + .05);
      px = spot[0]!; py = spot[1]!; pz = spot[2]!;
    }
  }
  for (let i = 0; i < r.count; i++) {
    const ch = f.scene.characters;
    if (r.id[i] !== session.own.seat - 1 || r.gen[i] !== session.own.seatGen) continue;
    heading = r.yaw[i]!;
    const vehicle = ch.vehicle(r.kind[i]!);
    if (chase) {
      const view = vehicle ? null : mountView(d, f, r.kind[i]!, r.gear[i * GEAR_COUNT + GEAR_WORN]!);
      px = r.x[i]! + Math.sin(heading) * (view?.forward ?? 0); py = r.y[i]! + (view?.up ?? 1); pz = r.z[i]! + Math.cos(heading) * (view?.forward ?? 0);
      if (view) {
        py = d.mountCamera.height(world, makeHandle(r.id[i]!, r.gen[i]!), px, pz, r.y[i]! + (reg.move[r.kind[i]!]?.height ?? 1) * .5, py, undefined, undefined, dt);
        chaseVx = d.mountCamera.vx; chaseVz = d.mountCamera.vz;
      }
      boom = vehicle ? Math.max(6, (reg.vehicle[r.kind[i]!]!.spec.halfLength) * (passengerVehicle ? 2 : 3)) : view?.boom;
    } else if (vehicle) {
      const pose = remoteVehiclePose(r, i, d.hostPose);
      if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, d.own.state, r.tick, spot, session.own.seatSlot, pose)) {
        const seat = ch.seatPose(r.kind[i]!, session.own.seatSlot, pose, spot, heading, undefined, d.seated)!;
        const found = passengerVehicle ? ch.seatedEye(session.ownKind, seat, spot) : ch.seatedOrigin(session.ownKind, seat, spot);
        if (found) { px = spot[0]!; py = spot[1]! + (passengerVehicle ? 0 : eye); pz = spot[2]!; }
      }
    } else {
      // On a saddle, the eye is over the seat's origin as the server has it, posed as its creature is drawn.
      const ms = d.mountState;
      ms.unpack(r.anim[i]!, r.cue[i]!);
      ms.seed = bodySeed(r.id[i]!);
      if (ch.seat(r.kind[i]!, r.x[i]!, r.y[i]!, r.z[i]!, heading, ms, r.tick, spot, session.own.seatSlot, undefined, r.gear[i * GEAR_COUNT + GEAR_WORN]!, -1, false, r.grown[i] ? youngScale(reg.birthScale[r.kind[i]!]!, r.span[i]!, r.grown[i]!, r.tick) : 1)) {
        if (session.own.seatSlot === IMPALE_SLOT) spot[1]! -= ch.impaleDrop(session.ownKind);
        px = spot[0]!; py = spot[1]! + eye; pz = spot[2]!;
      }
    }
    break;
  }
  if (!chase && f.seatEye(world, r, session.tickClock, c.yaw, c.pitch, d.posedEye, false)) { px = d.posedEye[0]!; py = d.posedEye[1]!; pz = d.posedEye[2]!; }
  if (chase) {
    const orbit = d.orbit.place(d.chaseRig(lookYaw, lookPitch, boom ?? CHASE_BOOM), boom ?? CHASE_BOOM, dt);
    const motion = boom === undefined ? (orbit ? motionOf(d, 0, 0, 0, undefined, orbit.back) : undefined)
      : motionOf(d, chaseVx, 0, chaseVz, makeHandle(session.own.seat - 1, session.own.seatGen), orbit ? orbit.back : boom, !passengerVehicle, d.mountCamera.safeY, d.mountCamera.wantedY);
    d.view.placeVehicle(cam, world, px, py, pz, orbit ? orbit.yaw : lookYaw, orbit ? orbit.pitch + CHASE_TILT : lookPitch, heading, 0, dt, false, motion);
  } else if (f.passengerCockpit && cockpitFrame) d.view.placeCockpit(cam, px, py, pz, cockpitFrame, d.cockpit.yaw, d.cockpit.pitch);
  else d.view.place(cam, world, px, py, pz, lookYaw, lookPitch, dt);
}

/** On foot, and with no living body: at the eye, over the shoulder, or round the body in the orbit. */
function onFoot(d: Director, f: AppFrame): void {
  // Knocked down or dying, the view rides the ragdoll (fallen.ts).
  const k = f.fallen, x = k.on ? k.x : f.bx, y = k.on ? k.y : f.by + f.eye, z = k.on ? k.z : f.bz;
  const orbit = d.orbit.place(d.view.own(d.viewRig, f.lookYaw, f.lookPitch), ORBIT_BACK, f.dt);
  if (orbit) d.view.placeRig(f.cam, f.world, x, y, z, orbit, f.dt);
  else d.view.place(f.cam, f.world, x, y, z, f.lookYaw, f.lookPitch, f.dt);
}

/** The creator's view. The camera faces the new survivor from the front, off to one side so the panel does not cover it. */
function preview(d: Director, f: AppFrame): void {
  const session = f.session, cam = f.cam, body = d.own, creator = f.ui.creator, aspect = f.aspect;
  cam.nearLimit = Infinity;
  body.kind = session.ownKind;
  body.x = session.own.x;
  body.y = session.own.y;
  body.z = session.own.z;
  body.yaw = creator.turn;
  body.tick = f.nowMs / (1000 / 30);
  body.firstPerson = false;
  body.id = 0;
  body.look = creator.look;
  body.gear.fill(0);
  body.state.unpack(0);
  body.state.seed = 0;
  f.scene.own = body;
  f.scene.hour = 12;
  // The panel takes the right of a wide window, so the body stands in the middle of the rest.
  const back = 3.3;
  const side = aspect > 1 ? back * Math.tan(cam.fovY / 2) * aspect * Math.min(0.42, 190 / (360 * aspect)) : 0;
  cam.x = body.x + side;
  cam.y = body.y + 1.15;
  cam.z = body.z + back;
  cam.yaw = Math.PI;
  cam.roll = 0;
  cam.pitch = -0.06;
}
