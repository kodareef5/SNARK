// A body astride a saddle's seat frame, hit as the server hits it (shared/anim/occupant.ts), on the canonical rest.
import { HUMAN } from "../../shared/anim/human.ts";
import { OccupantBody } from "../../shared/anim/occupant.ts";
import type { AnimState, HumanAnim } from "../../shared/anim/pose.ts";

const body = new OccupantBody();

/** `yaw` is a passenger's world look, radians; left out, it looks the way its seat faces. */
export function raySeated(anim: HumanAnim, st: AnimState, tick: number, frame: Float64Array, driver: boolean, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, maxT: number, padding = 0, targets: Float64Array | null = null, yaw?: number,
  soles: Float64Array | null = null, grips: Float64Array | null = null): number {
  body.saddle(anim, st, tick, frame, driver, yaw ?? Math.atan2(frame[5]!, frame[11]!), HUMAN.rest, targets, soles, grips);
  return body.ray(ox, oy, oz, dx, dy, dz, maxT, padding);
}
