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
  private vehicleLook = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private lookIdle = 0;

  /** A centred chase view. Mouse look wins; only a moving driver's idle view gently follows the car. Returns look yaw. */
  placeVehicle(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number, heading: number, speed: number, dt: number, follow = true): number {
    const elapsed = Math.max(0, Math.min(100, dt));
    if (!this.vehicleLook || Math.abs(angle(yaw - this.lastYaw)) > 0.00001 || Math.abs(pitch - this.lastPitch) > 0.00001) this.lookIdle = 0;
    else this.lookIdle += elapsed;
    if (follow && speed > 1 && this.lookIdle > 1200) yaw += angle(heading - yaw) * (1 - Math.exp(-elapsed / 1800));
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.vehicleLook = true;
    const back = 6 + Math.min(2.5, Math.abs(speed) * 0.07);
    const viewPitch = Math.max(-1.35, Math.min(1.15, pitch - 0.12));
    cam.yaw = yaw;
    cam.pitch = viewPitch;
    const dx = -Math.sin(yaw) * Math.cos(viewPitch) * back;
    const dy = -Math.sin(viewPitch) * back + 0.65;
    const dz = -Math.cos(yaw) * Math.cos(viewPitch) * back;
    const length = Math.hypot(dx, dy, dz);
    let reach = length;
    if (world && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) reach = Math.max(0, rayHit.t - CLEAR);
    const k = reach / length;
    cam.x = ex + dx * k;
    cam.y = ey + dy * k;
    cam.z = ez + dz * k;
    return yaw;
  }

  /** The eye is at (ex, ey, ez). `yaw` and `pitch` are radians. */
  place(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number): void {
    this.vehicleLook = false;
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

function angle(n: number): number { return Math.atan2(Math.sin(n), Math.cos(n)); }
