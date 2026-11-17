// One full-attitude render representation for every vehicle, its passengers and remote observers.
import { TICK_DT } from "../../shared/coords.ts";
import { quatNlerp } from "../../shared/math/quat.ts";
import type { Body } from "../../shared/sim/character.ts";
import { interpolateRotorPhase } from "../../shared/sim/vehicle-presentation.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { RemoteSample } from "./session.ts";
import type { VehicleCorrection } from "./vehicle-correction.ts";

const qa = new Float64Array(4), qb = new Float64Array(4), q = new Float64Array(4);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function predictedVehiclePose(a: Body, b: Body, t: number, rotor: boolean, boat = false, correction?: VehicleCorrection): VehicleRenderPose {
  const pose: VehicleRenderPose = {
    pitch: mix(a.vehiclePitch, b.vehiclePitch, t), roll: mix(a.vehicleRoll, b.vehicleRoll, t), steering: mix(a.steering, b.steering, t),
    wheelAngle: a.wheelAngle + Math.atan2(Math.sin(b.wheelAngle - a.wheelAngle), Math.cos(b.wheelAngle - a.wheelAngle)) * t,
    groundPitch: mix(a.vehicleGroundPitch, b.vehicleGroundPitch, t), groundRoll: mix(a.vehicleGroundRoll, b.vehicleGroundRoll, t),
    rideOffset: mix(a.vehicleRideOffset, b.vehicleRideOffset, t), grounded: b.grounded,
  };
  if (boat) pose.wheelAngle = interpolateRotorPhase(a.wheelAngle, b.wheelAngle, a.vehicleRpm * a.vehicleGear, b.vehicleRpm * b.vehicleGear, TICK_DT, t);
  if (a.vehicleQx || a.vehicleQy || a.vehicleQz || a.vehicleQw || b.vehicleQx || b.vehicleQy || b.vehicleQz || b.vehicleQw) {
    qa.set([a.vehicleQx, a.vehicleQy, a.vehicleQz, a.vehicleQw]); qb.set([b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw]);
    quatNlerp(q, 0, qa, 0, qb, 0, t);
    correction?.apply(q);
    pose.qx = q[0]!; pose.qy = q[1]!; pose.qz = q[2]!; pose.qw = q[3]!;
    pose.engineRpm = mix(a.vehicleRpm, b.vehicleRpm, t); pose.engineOn = b.vehicleEngineOn;
    pose.hullCondition = b.vehicleHullCondition; pose.flooding = b.vehicleFlooding;
    pose.rotorRpm = mix(a.vehicleRotorRpm, b.vehicleRotorRpm, t);
    pose.rotorPhase = interpolateRotorPhase(a.vehicleRotorPhase, b.vehicleRotorPhase, a.vehicleRotorRpm, b.vehicleRotorRpm, TICK_DT, t);
    pose.engineCondition = b.vehicleEngineCondition; pose.rotorCondition = b.vehicleRotorCondition;
  }
  return pose;
}

/** Remote entity `i`'s vehicle pose; into `out` when given, for a caller that keeps none of it past its own use. */
export function remoteVehiclePose(r: RemoteSample, i: number, out?: VehicleRenderPose): VehicleRenderPose {
  const pose: VehicleRenderPose = out ?? { pitch: 0, roll: 0, steering: 0, wheelAngle: 0 };
  pose.pitch = r.vehiclePitch[i]!; pose.roll = r.vehicleRoll[i]!; pose.steering = r.steering[i]!; pose.wheelAngle = r.wheelAngle[i]!;
  pose.groundPitch = r.vehicleGroundPitch[i]!; pose.groundRoll = r.vehicleGroundRoll[i]!; pose.rideOffset = r.vehicleRideOffset[i]!; pose.grounded = r.vehicleGrounded[i] !== 0;
  pose.doors = r.vehicleDoors[i]!;
  if (r.vehicleQx[i] || r.vehicleQy[i] || r.vehicleQz[i] || r.vehicleQw[i]) {
    pose.qx = r.vehicleQx[i]!; pose.qy = r.vehicleQy[i]!; pose.qz = r.vehicleQz[i]!; pose.qw = r.vehicleQw[i]!;
    pose.engineRpm = r.vehicleRpm[i]!; pose.engineOn = r.vehicleEngineOn[i] !== 0;
    pose.hullCondition = r.vehicleHullCondition[i]!; pose.flooding = r.vehicleFlooding[i]!;
    pose.rotorRpm = r.vehicleRotorRpm[i]!; pose.rotorPhase = r.vehicleRotorPhase[i]!;
    pose.engineCondition = r.vehicleEngineCondition[i]!; pose.rotorCondition = r.vehicleRotorCondition[i]!;
  } else if (out) {
    pose.qx = pose.qy = pose.qz = pose.qw = undefined;
    pose.engineRpm = pose.engineOn = pose.hullCondition = pose.flooding = undefined;
    pose.rotorRpm = pose.rotorPhase = pose.engineCondition = pose.rotorCondition = undefined;
  }
  return pose;
}
