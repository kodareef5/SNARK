// One tick of a launched drone, the same on the server that flies it and the page that predicts it.
import { TICK_DT, TICK_RATE } from "../coords.ts";
import { clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";

/** Ticks the cradle's lift takes before the operator steers. */
export const DRONE_RELEASE_TICKS = Math.ceil(TICK_RATE / 2);
/** How far the drone's nose may be pitched by the operator's look, either way. */
export const DRONE_PITCH = 1.45;
const BOOST = 1.5;

export interface DroneMotion { x: number; y: number; z: number; yaw: number; pitch: number }
export interface DroneTune { speed: number; turn: number }
/** The tick's travel: a unit direction and how far along it, before anything is met. */
export interface DroneTravel { dx: number; dy: number; dz: number; length: number }

const turnToward = (from: number, to: number, most: number): number => {
  const d = detAtan2(detSin(to - from), detCos(to - from));
  return from + clamp(d, -most, most);
};

/** The look, in the wire's units: a yaw of 65536 to the turn and a pitch of 16384 to the right angle. */
export const droneLookYaw = (yaw: number): number => yaw * Math.PI / 32768;
export const droneLookPitch = (pitch: number): number => clamp(pitch * Math.PI / 32768, -DRONE_PITCH, DRONE_PITCH);

/**
 * Turns the drone toward its operator's look and says where it goes this tick. `age` counts ticks from launch: for the
 * first half second it lifts out of its cradle on a fixed curve and the look is not yet followed.
 */
export function droneStep(s: DroneMotion, age: number, lookYaw: number, lookPitch: number, boost: boolean, tune: DroneTune, out: DroneTravel): DroneTravel {
  let forward: number, rise: number;
  if (age <= DRONE_RELEASE_TICKS) {
    const t = age / DRONE_RELEASE_TICKS, was = (age - 1) / DRONE_RELEASE_TICKS;
    forward = 1.45 * (t * t - was * was);
    rise = 1.27 * (t * t * (3 - 2 * t) - was * was * (3 - 2 * was));
    s.pitch = .27 * t;
  } else {
    s.yaw = turnToward(s.yaw, lookYaw, tune.turn * TICK_DT);
    s.pitch = turnToward(s.pitch, lookPitch, tune.turn * TICK_DT);
    const travel = tune.speed * (boost ? BOOST : 1) * TICK_DT;
    forward = travel * detCos(s.pitch);
    rise = travel * detSin(s.pitch);
  }
  const length = Math.sqrt(forward * forward + rise * rise);
  out.length = length;
  out.dx = length > 0 ? detSin(s.yaw) * forward / length : 0;
  out.dy = length > 0 ? rise / length : 0;
  out.dz = length > 0 ? detCos(s.yaw) * forward / length : 0;
  return out;
}

/** Moves the drone `distance` along this tick's travel, rounded as the wire carries it. */
export function droneMove(s: DroneMotion, t: DroneTravel, distance: number): void {
  s.x = Math.fround(s.x + t.dx * distance); s.y = Math.fround(s.y + t.dy * distance); s.z = Math.fround(s.z + t.dz * distance);
  s.yaw = Math.fround(s.yaw); s.pitch = Math.fround(s.pitch);
}
