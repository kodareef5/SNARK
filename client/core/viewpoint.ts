// Where the camera is, given where the body is and where it looks.
//
// First person puts the camera at the body's eye. Third person hangs it over
// the right shoulder and pulls it in when something solid is in the way. Either
// way the body aims from its own eye: the server never learns which view a
// client uses, and the view cannot move a shot.

import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Camera } from "./render/camera.ts";

/** How far behind, beside and above the eye the third-person camera sits. */
const BACK = 3.4;
const SIDE = 0.55;
const RISE = 0.25;
/** Kept between the camera and whatever stopped it, so the near plane does not cut into a wall. */
const CLEAR = 0.3;

export class Viewpoint {
  thirdPerson = false;

  /** Place `cam` for a body whose eye is at (ex, ey, ez), looking along `yaw` and `pitch` (radians). */
  place(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number): void {
    cam.yaw = yaw;
    cam.pitch = pitch;
    cam.x = ex;
    cam.y = ey;
    cam.z = ez;
    if (!this.thirdPerson) return;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    // From the eye to where the camera wants to be: back along the view, to the right, and up.
    const dx = -sy * cp * BACK - cy * SIDE;
    const dy = -sp * BACK + RISE;
    const dz = -cy * cp * BACK + sy * SIDE;
    const length = Math.hypot(dx, dy, dz);
    let reach = length;
    if (world && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) reach = Math.max(0, rayHit.t - CLEAR);
    const k = reach / length;
    cam.x = ex + dx * k;
    cam.y = ey + dy * k;
    cam.z = ez + dz * k;
  }
}
