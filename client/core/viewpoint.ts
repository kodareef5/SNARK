// Places the camera at the eye, or over the right shoulder in third person, pulled in when something solid is in the way.
// The body always aims from its own eye, so the view cannot move a shot and the server never learns which view is used.

import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Camera } from "./render/camera.ts";

/** Metres behind, beside and above the eye. */
const BACK = 3.4;
const SIDE = 0.55;
const RISE = 0.25;
/** Gap kept between the camera and the obstacle, so the near plane does not cut into a wall. */
const CLEAR = 0.3;

export class Viewpoint {
  thirdPerson = false;

  /** The eye is at (ex, ey, ez). `yaw` and `pitch` are radians. */
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
    // The offset from the eye: back along the view, to the right, and up.
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
