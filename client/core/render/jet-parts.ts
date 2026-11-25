// What moves on a jet as it is drawn: its gear folding up and down, its wheels rolling, its nozzle and lift fan's doors
// swinging to VTOL, its control surfaces following how it turns, and its afterburner's glow. Each is eased per jet from
// its pose, the pilot's from the predicted body and an observer's from the snapshot's drive and nozzle words, so all
// draw it alike. It decides nothing.

import { TICK_RATE } from "../../../shared/coords.ts";
import { quatAxis } from "../../../shared/math/quat.ts";

/** A jet rig's moving bones by index, -1 where the model lacks one. */
export interface JetRig {
  gearNose: number; gearLeft: number; gearRight: number;
  wheelNose: number; wheelLeft: number; wheelRight: number;
  nozzle: number; doorTop: number; doorBottom: number;
  aileronLeft: number; aileronRight: number;
  stabilatorLeft: number; stabilatorRight: number;
  rudderLeft: number; rudderRight: number;
  burner: number;
}

export function jetRig(names: readonly string[]): JetRig {
  const bone = (name: string): number => names.indexOf(name);
  return {
    gearNose: bone("gear_nose"), gearLeft: bone("gear_main_left"), gearRight: bone("gear_main_right"),
    wheelNose: bone("wheel_nose"), wheelLeft: bone("wheel_main_left"), wheelRight: bone("wheel_main_right"),
    nozzle: bone("nozzle"), doorTop: bone("liftfan_door_top"), doorBottom: bone("liftfan_door_bottom"),
    aileronLeft: bone("aileron_left"), aileronRight: bone("aileron_right"),
    stabilatorLeft: bone("stabilator_left"), stabilatorRight: bone("stabilator_right"),
    rudderLeft: bone("rudder_left"), rudderRight: bone("rudder_right"),
    burner: bone("burner"),
  };
}

/** What a jet's parts are drawn from: its wheels down (1) or up (0), its nozzle's swing, its wheels' roll, its attitude and its burner. */
export interface JetPose {
  gear: number;
  nozzle: number;
  wheelAngle: number;
  qx: number; qy: number; qz: number; qw: number;
  burner: boolean;
}

/** A jet's pose from how it is drawn: its gear and burner from its drive word, its nozzle from its rotor word, into `out`. */
export function jetPoseOf(v: { gear?: number; shifting?: boolean; rotorPhase?: number; wheelAngle: number; qx?: number; qy?: number; qz?: number; qw?: number }, yaw: number, out: JetPose): JetPose {
  out.gear = v.gear ?? 1; out.nozzle = v.rotorPhase ?? 0; out.wheelAngle = v.wheelAngle; out.burner = v.shifting === true;
  if (v.qw !== undefined) { out.qx = v.qx!; out.qy = v.qy!; out.qz = v.qz!; out.qw = v.qw; }
  else { out.qx = out.qz = 0; out.qy = Math.sin(yaw / 2); out.qw = Math.cos(yaw / 2); }
  return out;
}

/** Radians: the gear folded, the nozzle at VTOL, the doors open, and the most a surface deflects. */
export const GEAR_FOLD = 1.55;
export const NOZZLE_DOWN = -Math.PI / 2;
export const DOOR_OPEN = -1.2;
export const SURFACE_MOST = .35;
/** Seconds the gear takes to fold, and the share of a surface's way it goes in a second toward what it wants. */
const GEAR_SECONDS = 3;
const SURFACE_EASE = 8;
/** Radians a surface turns for each radian a second the jet turns about its axis. */
const SURFACE_GAIN = .5;
/** Ticks a jet not drawn is remembered for. */
const FORGET = 300;

interface Eased {
  gear: number; pitch: number; roll: number; yaw: number;
  qx: number; qy: number; qz: number; qw: number;
  at: number;
}

export class JetParts {
  private readonly eased = new Map<number, Eased>();
  /** The surfaces' deflections the last `pose` left, for tests: pitch, roll and yaw, in radians. */
  readonly last = { gear: 1, pitch: 0, roll: 0, yaw: 0 };

  /**
   * Sets the local rotations of jet `id`'s moving bones in `rot` (four numbers a bone) at tick clock `clock` (fractional
   * ticks), from `pose`.
   */
  pose(rot: Float32Array | Float64Array, rig: JetRig, id: number, pose: JetPose, clock: number): void {
    let e = this.eased.get(id);
    if (!e) {
      e = { gear: pose.gear, pitch: 0, roll: 0, yaw: 0, qx: pose.qx, qy: pose.qy, qz: pose.qz, qw: pose.qw, at: clock };
      this.eased.set(id, e);
    }
    const dt = Math.max(0, Math.min(.25, (clock - e.at) / TICK_RATE));
    // The turn since it was last drawn, in its own frame: the rates its controls are working for.
    let pitchRate = 0, rollRate = 0, yawRate = 0;
    if (dt > 1e-4) {
      // conj(previous) * now, small: twice its vector part over the time is the body's rate.
      const ax = -e.qx, ay = -e.qy, az = -e.qz, aw = e.qw, bx = pose.qx, by = pose.qy, bz = pose.qz, bw = pose.qw;
      let rx = aw * bx + ax * bw + ay * bz - az * by;
      let ry = aw * by - ax * bz + ay * bw + az * bx;
      let rz = aw * bz + ax * by - ay * bx + az * bw;
      const rw = aw * bw - ax * bx - ay * by - az * bz;
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; }
      pitchRate = -2 * rx / dt; yawRate = 2 * ry / dt; rollRate = 2 * rz / dt;
    }
    const k = 1 - Math.exp(-SURFACE_EASE * dt), clampTo = (v: number): number => Math.max(-SURFACE_MOST, Math.min(SURFACE_MOST, v));
    e.pitch += (clampTo(pitchRate * SURFACE_GAIN) - e.pitch) * k;
    e.roll += (clampTo(rollRate * SURFACE_GAIN) - e.roll) * k;
    e.yaw += (clampTo(yawRate * SURFACE_GAIN) - e.yaw) * k;
    const step = dt / GEAR_SECONDS;
    e.gear = pose.gear > e.gear ? Math.min(pose.gear, e.gear + step) : Math.max(pose.gear, e.gear - step);
    e.qx = pose.qx; e.qy = pose.qy; e.qz = pose.qz; e.qw = pose.qw; e.at = clock;
    const last = this.last;
    last.gear = e.gear; last.pitch = e.pitch; last.roll = e.roll; last.yaw = e.yaw;

    const fold = (1 - e.gear) * GEAR_FOLD, set = (b: number, x: number, y: number, z: number, angle: number): void => { if (b >= 0) quatAxis(rot, b * 4, x, y, z, angle); };
    // The nose leg folds forward into its bay, the mains inward under the wing.
    set(rig.gearNose, 1, 0, 0, -fold);
    set(rig.gearLeft, 0, 0, 1, fold);
    set(rig.gearRight, 0, 0, 1, -fold);
    for (const b of [rig.wheelNose, rig.wheelLeft, rig.wheelRight]) set(b, 1, 0, 0, pose.wheelAngle);
    const nozzle = Math.max(0, Math.min(1, pose.nozzle));
    set(rig.nozzle, 1, 0, 0, nozzle * NOZZLE_DOWN);
    set(rig.doorTop, 1, 0, 0, nozzle * DOOR_OPEN);
    set(rig.doorBottom, 1, 0, 0, nozzle * DOOR_OPEN);
    // The flaperons against each other with the roll; the stabilators together with the pitch and apart with the roll.
    set(rig.aileronLeft, 1, 0, 0, -e.roll);
    set(rig.aileronRight, 1, 0, 0, e.roll);
    set(rig.stabilatorLeft, 1, 0, 0, e.pitch - e.roll * .5);
    set(rig.stabilatorRight, 1, 0, 0, e.pitch + e.roll * .5);
    set(rig.rudderLeft, 0, 1, 0, e.yaw);
    set(rig.rudderRight, 0, 1, 0, e.yaw);
  }

  /** Forgets the jets not drawn for a while. Once a frame. */
  sweep(clock: number): void {
    if (this.eased.size === 0) return;
    for (const [id, e] of this.eased) if (clock - e.at > FORGET) this.eased.delete(id);
  }
}
