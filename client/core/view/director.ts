// The view's director: who the camera follows and from where. Three rows of the app's frame are its own. First, as a part
// itself: where the predicted body is this frame, what it rides, drives or sits in, and the view of it, from the eye,
// from behind, in a cockpit or round it in the orbit. Then, once the sight has had its say, `body`: the own body as the
// scene draws it (own-body.ts). Last `place`: the camera put where that view has it (place.ts). The state of all three
// is kept here.

import { AnimState } from "../../../shared/anim/pose.ts";
import { SESSION_ALIVE } from "../../../shared/net/protocol.ts";
import { stanceEye } from "../../../shared/sim/character.ts";
import { GEAR_COUNT } from "../../../shared/sim/entities.ts";
import type { VehicleFrame } from "../../../shared/sim/vehicle-frame.ts";
import { LOOK_SPEED } from "../controls.ts";
import type { AppFrame, FramePart } from "../frame.ts";
import { MountCameraPivot } from "../mount-camera.ts";
import { Orbit, rig, type OrbitRig } from "../orbit.ts";
import { seatScratch, type VehicleRenderPose } from "../render/characters.ts";
import type { OwnBody } from "../render/scene.ts";
import type { RemoteSample } from "../session.ts";
import { predictedVehiclePose, remoteVehiclePose } from "../vehicle-view.ts";
import { CockpitLook, Viewpoint, chasePitch, type VehicleCameraMotion } from "../viewpoint.ts";
import { ownBody } from "./own-body.ts";
import { place } from "./place.ts";

/** `out` as the frame of a vehicle posed as `pose` at a place and heading: only what a VehicleFrame says. */
export function frameOf(out: VehicleFrame, pose: VehicleRenderPose, x: number, y: number, z: number, yaw: number): VehicleFrame {
  out.x = x; out.y = y; out.z = z; out.yaw = yaw; out.pitch = pose.pitch; out.roll = pose.roll;
  out.qx = pose.qx; out.qy = pose.qy; out.qz = pose.qz; out.qw = pose.qw; out.steering = pose.steering;
  return out;
}

const frame = (): VehicleFrame => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });

export class Director implements FramePart {
  /** The view of the own body: the choice of the eye or behind, and where it puts the camera. */
  readonly view = new Viewpoint();
  /** The orbit camera on K, and whether the last frame's view lets it start. */
  readonly orbit = new Orbit();
  orbitFree = false;
  readonly mountCamera = new MountCameraPivot();
  readonly cockpit = new CockpitLook();
  private helicopterViewHost = -1;
  private airId = 0;
  private savedYaw = 0;
  private savedPitch = 0;

  /** The aircraft and the survivor each keep the direction their operator last faced. */
  airControls(f: AppFrame): void {
    const session = f.session, c = f.controls;
    const id = session.airCamera.id;
    const pose = session.airCamera.sample(session.renderClock);
    if (id !== this.airId) {
      c.release();
      if (pose) {
        if (!this.airId) { this.savedYaw = c.yaw; this.savedPitch = c.pitch; }
        c.yaw = pose.yaw;
        c.pitch = pose.pitch;
      } else {
        c.yaw = this.savedYaw;
        c.pitch = this.savedPitch;
      }
      this.airId = id;
    }
    if (pose && f.steer) {
      const dt = Math.min(100, f.dt) / 1000;
      c.yaw -= c.moveX * dt * 1.8;
      c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch + c.moveZ * dt * 1.5));
    }
  }
  /** Eased eye height above the feet, or -1 before the first frame and while there is no living body. */
  eye = -1;
  /** Whether the survivor was on its own feet last frame, to know the frame it rises or gets out of a vehicle, a seat or a saddle. */
  wasOnFoot = false;
  /** Whether the own glider was open at the last frame, and whether the view was stood back for it from the eye. */
  private gliderOpen = false;
  private gliderStoodBack = false;
  /** The own body as the scene draws it, and the seat a passenger's is drawn in. */
  readonly own: OwnBody = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT), id: 0 };
  readonly attachment = { host: 0, slot: 0, generation: 0 };
  /**
   * Scratch, made once: a seat's place, its pose, and the pose of the creature a passenger sits on; a vehicle's frame and
   * pose as the driver has them and as a passenger's host has them; a chase camera's rig and its subject's motion; a
   * mount's framing; a point in a vehicle's own frame; the eye of a body posed in its seat.
   */
  readonly seatSpot = new Float64Array(12);
  readonly seated = seatScratch();
  readonly mountState = new AnimState();
  readonly carFrame = frame();
  readonly hostFrame = frame();
  readonly hostPose: VehicleRenderPose = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0 };
  readonly viewRig = rig();
  readonly motion: VehicleCameraMotion = { vx: 0, vy: 0, vz: 0 };
  readonly mount = { up: 0, boom: 0, forward: 0 };
  readonly local = new Float64Array(3);
  readonly posedEye = new Float64Array(3);
  /** The own body as it is drawn, and the camera placed: rows of the frame after the sight's. */
  readonly body: FramePart = { step: (f) => ownBody(this, f) };
  readonly place: FramePart = { step: (f) => place(this, f) };

  /** The mouse moved by `dx` and `dy` pixels: it turns the look in a cockpit, the orbit while it is on, and else the body. */
  look(f: AppFrame, dx: number, dy: number): void {
    const c = f.controls;
    if (f.session.airCamera.id) { c.look(dx, dy); return; }
    this.cockpitNow(f);
    if (this.cockpit.active) this.cockpit.look(-dx * LOOK_SPEED * c.zoom, -dy * LOOK_SPEED * c.zoom);
    else if (this.orbit.on) this.orbit.look(-dx * LOOK_SPEED * c.zoom, -dy * LOOK_SPEED * c.zoom);
    else c.look(dx, dy);
  }

  /** `out` as a chase camera shows a look of `yaw` and `pitch` on a boom of `boom` metres. */
  chaseRig(yaw: number, pitch: number, boom: number): OrbitRig {
    const out = this.viewRig;
    out.yaw = yaw; out.pitch = chasePitch(pitch); out.back = boom; out.side = out.rise = 0;
    return out;
  }

  /** Refresh the world-space look sent with inputs; a passenger's head follows the same rotated view as the camera. */
  cockpitNow(f: AppFrame): void {
    const s = f.session, r = f.remote, reg = f.reg;
    let host = -1, at: VehicleFrame | undefined;
    if (s.sessionState === SESSION_ALIVE && s.driving >= 0 && (reg.vehicle[s.bodyKind]?.movement === "rotor" || reg.vehicle[s.bodyKind]?.movement === "boat")) {
      host = s.driving;
      const b = s.own;
      at = this.carFrame;
      at.x = b.x; at.y = b.y; at.z = b.z; at.yaw = b.vehicleYaw; at.pitch = b.vehiclePitch; at.roll = b.vehicleRoll;
      at.qx = b.vehicleQx; at.qy = b.vehicleQy; at.qz = b.vehicleQz; at.qw = b.vehicleQw; at.steering = undefined;
    } else if (s.sessionState === SESSION_ALIVE && s.own.seat > 0) {
      for (let i = 0; i < r.count; i++) if (r.id[i] === s.own.seat - 1 && r.gen[i] === s.own.seatGen && (r.vehicleRotorcraft[i] || r.vehicleBoat[i])) {
        host = r.id[i]!;
        at = this.hostOf(r, i);
        break;
      }
    }
    this.cockpitLook(f, host, at);
  }

  /** The frame of the vehicle at `i` of `r`, a passenger's host, into the scratch kept for it. */
  private hostOf(r: RemoteSample, i: number): VehicleFrame {
    return frameOf(this.hostFrame, remoteVehiclePose(r, i, this.hostPose), r.x[i]!, r.y[i]!, r.z[i]!, r.yaw[i]!);
  }

  private cockpitLook(f: AppFrame, host: number, at?: VehicleFrame): void {
    if (host !== this.helicopterViewHost && host >= 0) this.view.thirdPerson = true;
    this.helicopterViewHost = host;
    if (!f.session.thirdPerson) this.view.thirdPerson = false;
    this.cockpit.sync(host, !this.view.thirdPerson, f.controls, at);
  }

  step(f: AppFrame): void {
    const session = f.session, r = f.remote, reg = f.reg, dt = f.dt, view = this.view;
    // The eye interpolates between the last two predicted ticks, so motion is smooth at any frame rate.
    const a = session.alpha;
    const alive = (f.alive = session.sessionState === SESSION_ALIVE);
    const move = (f.move = reg.move[session.bodyKind]);
    // The eye eases toward the stance height, so crouching is a movement and not a cut.
    const eyeNow = (f.eyeNow = alive && move ? stanceEye(move, session.own.stance) : 0);
    // A body that has just appeared starts at its eye height.
    if (!alive) this.eye = -1;
    else this.eye = this.eye < 0 ? eyeNow : this.eye + (eyeNow - this.eye) * Math.min(1, dt / 90);
    f.eye = alive ? this.eye : 0;
    const bx = (f.bx = session.ownPrev.x + (session.own.x - session.ownPrev.x) * a + session.smoothX);
    const by = (f.by = session.ownPrev.y + (session.own.y - session.ownPrev.y) * a + session.smoothY);
    const bz = (f.bz = session.ownPrev.z + (session.own.z - session.ownPrev.z) * a + session.smoothZ);
    const car = (f.car = reg.vehicle[session.bodyKind]);
    const rotor = car?.movement === "rotor", boat = car?.movement === "boat";
    const vehiclePose = (f.vehiclePose = car ? predictedVehiclePose(session.ownPrev, session.own, a, rotor, boat, session.vehicleCorrection) : undefined);
    const carYaw = (f.carYaw = vehiclePose?.qw !== undefined ? Math.atan2(2 * (vehiclePose.qw * vehiclePose.qy! + vehiclePose.qx! * vehiclePose.qz!), 1 - 2 * (vehiclePose.qx! ** 2 + vehiclePose.qy! ** 2))
      : session.ownPrev.vehicleYaw + Math.atan2(Math.sin(session.own.vehicleYaw - session.ownPrev.vehicleYaw), Math.cos(session.own.vehicleYaw - session.ownPrev.vehicleYaw)) * a);
    const passenger = (f.passenger = alive && session.driving < 0 && session.own.seatSlot !== 0 && session.own.seat > 0);
    // A passenger's chase camera is third person, so it obeys the same server rule.
    let passengerVehicle = false, passengerCockpit = false;
    let cockpitFrame: VehicleFrame | undefined = car ? frameOf(this.carFrame, vehiclePose!, bx, by, bz, carYaw) : undefined;
    if (passenger) for (let i = 0; i < r.count; i++) {
      if (r.id[i] !== session.own.seat - 1 || r.gen[i] !== session.own.seatGen) continue;
      passengerVehicle = !!reg.vehicle[r.kind[i]!];
      passengerCockpit = r.vehicleRotorcraft[i] !== 0 || r.vehicleBoat[i] !== 0;
      if (passengerVehicle) cockpitFrame = this.hostOf(r, i);
    }
    f.passengerVehicle = passengerVehicle;
    f.passengerCockpit = passengerCockpit;
    f.cockpitFrame = cockpitFrame;
    const helicopterHost = (rotor || boat) && session.driving >= 0 ? session.driving : passengerCockpit ? session.own.seat - 1 : -1;
    this.cockpitLook(f, helicopterHost, cockpitFrame);
    const chase = (f.chase = passenger && session.thirdPerson && (!passengerCockpit || view.thirdPerson));
    // The orbit goes round the body, its mount or the host of a passenger's chase view (-1 for none). A driver's chase
    // camera and a cockpit look round freely already. A new subject is a view the game forces: the orbit gives way at
    // once, and the camera eases from where it was as between any two views. The rule turning off, or death, eases it out.
    const subject = car || this.cockpit.active || (passenger && !chase) ? -1 : session.driving >= 0 ? session.driving : passenger ? -3 - session.own.seat : -2;
    if (this.orbit.follow(subject)) view.turn();
    this.orbitFree = alive && session.thirdPerson && subject !== -1;
    if (!this.orbitFree) this.orbit.set(false);
    if (!alive || car || (session.driving < 0 && (!chase || passengerVehicle))) this.mountCamera.reset();
    // On foot the view is the one the player chose: from behind unless it chose the eye (Settings.thirdPerson). A survivor
    // rises in it, and comes back to it out of a vehicle, a seat or a saddle, whose views are their own. A page that
    // measures rises at the eye (fromEye).
    const onFoot = alive && session.driving < 0 && !passenger;
    if (onFoot && !this.wasOnFoot) view.thirdPerson = f.settings.thirdPerson && !f.fromEye;
    this.wasOnFoot = onFoot;
    // A server rule can forbid third person. A rider still sees its mount from behind.
    // From the eye a glider's wings are overhead and out of sight, so the view stands back as one is thrown open, where the
    // server allows it, and returns to the eye as it folds. V still chooses between them in the air.
    const gliderOpen = alive && session.driving < 0 && session.own.glide !== 0;
    if (gliderOpen && !this.gliderOpen && !view.thirdPerson && session.thirdPerson) {
      view.thirdPerson = true;
      this.gliderStoodBack = true;
    } else if (!gliderOpen && this.gliderOpen && this.gliderStoodBack) {
      view.thirdPerson = false;
      this.gliderStoodBack = false;
    }
    this.gliderOpen = gliderOpen;
    if (!session.thirdPerson) view.thirdPerson = false;
    // A session without a living body looks from the eye.
    f.third = view.thirdPerson || (alive && !!car && !rotor && !boat);
    if (!alive) view.thirdPerson = false;
    else if (session.driving >= 0 && !car) view.thirdPerson = true;
    f.orbiting = this.orbit.inUse;
  }
}
