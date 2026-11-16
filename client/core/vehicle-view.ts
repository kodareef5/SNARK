// One render representation for the predicted aircraft, its passengers, and remote observers.
import { TICK_DT } from "../../shared/coords.ts";
import { quatNlerp } from "../../shared/math/quat.ts";
import type { Body } from "../../shared/sim/character.ts";
import { interpolateRotorPhase } from "../../shared/sim/vehicle-presentation.ts";
import type { VehicleRenderPose } from "./render/characters.ts";
import type { RemoteSample } from "./session.ts";

const qa = new Float64Array(4), qb = new Float64Array(4), q = new Float64Array(4);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function predictedVehiclePose(a: Body, b: Body, t: number, rotor: boolean, boat = false): VehicleRenderPose {
  const pose: VehicleRenderPose = {
    pitch: mix(a.vehiclePitch, b.vehiclePitch, t), roll: mix(a.vehicleRoll, b.vehicleRoll, t), steering: mix(a.steering, b.steering, t),
    wheelAngle: a.wheelAngle + Math.atan2(Math.sin(b.wheelAngle - a.wheelAngle), Math.cos(b.wheelAngle - a.wheelAngle)) * t,
    groundPitch: mix(a.vehicleGroundPitch, b.vehicleGroundPitch, t), groundRoll: mix(a.vehicleGroundRoll, b.vehicleGroundRoll, t),
    rideOffset: mix(a.vehicleRideOffset, b.vehicleRideOffset, t), grounded: b.grounded,
  };
  if (boat) pose.wheelAngle = interpolateRotorPhase(a.wheelAngle, b.wheelAngle, a.vehicleRpm * a.vehicleGear, b.vehicleRpm * b.vehicleGear, TICK_DT, t);
  if (rotor || boat) {
    qa.set([a.vehicleQx, a.vehicleQy, a.vehicleQz, a.vehicleQw]); qb.set([b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw]);
    quatNlerp(q, 0, qa, 0, qb, 0, t);
    pose.qx = q[0]!; pose.qy = q[1]!; pose.qz = q[2]!; pose.qw = q[3]!;
    pose.engineRpm = mix(a.vehicleRpm, b.vehicleRpm, t); pose.engineOn = b.vehicleEngineOn;
    pose.hullCondition = b.vehicleHullCondition; pose.flooding = b.vehicleFlooding;
    pose.rotorRpm = mix(a.vehicleRotorRpm, b.vehicleRotorRpm, t);
    pose.rotorPhase = interpolateRotorPhase(a.vehicleRotorPhase, b.vehicleRotorPhase, a.vehicleRotorRpm, b.vehicleRotorRpm, TICK_DT, t);
    pose.engineCondition = b.vehicleEngineCondition; pose.rotorCondition = b.vehicleRotorCondition;
  }
  return pose;
}

export function remoteVehiclePose(r: RemoteSample, i: number): VehicleRenderPose {
  const pose: VehicleRenderPose = {
    pitch: r.vehiclePitch[i]!, roll: r.vehicleRoll[i]!, steering: r.steering[i]!, wheelAngle: r.wheelAngle[i]!,
    groundPitch: r.vehicleGroundPitch[i]!, groundRoll: r.vehicleGroundRoll[i]!, rideOffset: r.vehicleRideOffset[i]!, grounded: r.vehicleGrounded[i] !== 0,
    doors: r.vehicleDoors[i]!,
  };
  if (r.vehicleRotorcraft[i] || r.vehicleBoat[i]) {
    pose.qx = r.vehicleQx[i]!; pose.qy = r.vehicleQy[i]!; pose.qz = r.vehicleQz[i]!; pose.qw = r.vehicleQw[i]!;
    pose.engineRpm = r.vehicleRpm[i]!; pose.engineOn = r.vehicleEngineOn[i] !== 0;
    pose.hullCondition = r.vehicleHullCondition[i]!; pose.flooding = r.vehicleFlooding[i]!;
    pose.rotorRpm = r.vehicleRotorRpm[i]!; pose.rotorPhase = r.vehicleRotorPhase[i]!;
    pose.engineCondition = r.vehicleEngineCondition[i]!; pose.rotorCondition = r.vehicleRotorCondition[i]!;
  }
  return pose;
}
