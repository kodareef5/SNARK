// A jet's moving bones and its pose as it is drawn, read in the first frame so a jet's rig is whole before the code that
// moves its parts comes (jet-parts.ts, with the jet's late file).

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
