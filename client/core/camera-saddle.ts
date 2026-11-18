// Keep the selected look direction when an opaque, partly buried roof hides the mounted rider.
import { capsuleFree, type CollisionWorld } from "../../shared/world/collide.ts";
import { castWorld, HIT_NONE } from "../../shared/world/ray.ts";
import type { CameraBody } from "./camera-body.ts";
import type { Camera } from "./render/camera.ts";

const shoulders = [0, 1.5, -1.5, 3, -3, 5, -5];
const reaches = [4, 3, 2, 5];
const elevations = [.5, 1, 0, -.75, -1.5, -2, -2.5, 1.75];

export class CompactSaddleView {
  private readonly focus = new Float64Array(6);
  private previous = -1;
  clear(): void { this.previous = -1; }

  /** A direct ray to the saddle is normally enough. Only a world-occluded orbit needs a shorter shoulder view. */
  place(cam: Camera, world: CollisionWorld, body: CameraBody, radius: number, reset: boolean): boolean {
    if (!body.saddleFocus(this.focus)) return false;
    const f = this.focus, eyeX = f[3]!, eyeY = f[4]!, eyeZ = f[5]!;
    const visible = (x: number, y: number, z: number, index: number, checkBody: boolean): boolean => {
      const dx = f[index]! - x, dy = f[index + 1]! - y, dz = f[index + 2]! - z, length = Math.hypot(dx, dy, dz);
      return length > .01 && castWorld(world, x, y, z, dx / length, dy / length, dz / length, length) === HIT_NONE &&
        (!checkBody || body.cast(x, y, z, dx / length, dy / length, dz / length, length, 0) >= length - (index === 0 ? .3 * body.size : .002));
    };
    if (visible(cam.x, cam.y, cam.z, 0, false) && visible(cam.x, cam.y, cam.z, 3, false)) return false;
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const tangent = Math.tan(cam.fovY / 2), vertical = .7 * tangent, horizontal = .9 * tangent * cam.aspect;
    const dx = f[0]! - eyeX, dz = f[2]! - eyeZ, seatY = f[1]! - eyeY;
    const seatForward = dx * sy + dz * cy, seatRight = dx * cy - dz * sy;
    const candidate = (index: number): boolean => {
      const distance = reaches[Math.floor(index / (shoulders.length * elevations.length))]! * body.size;
      const shoulder = shoulders[Math.floor(index / elevations.length) % shoulders.length]! * body.size;
      const up = elevations[index % elevations.length]! * body.size;
      const depth = distance * cp - up * sp;
      if (depth <= 0 || Math.abs(shoulder) > depth * horizontal || Math.abs(-up * cp - distance * sp) > depth * vertical) return false;
      const seatDepth = (distance + seatForward) * cp + (seatY - up) * sp;
      if (seatDepth <= 0 || Math.abs(seatRight - shoulder) > seatDepth * horizontal ||
        Math.abs((seatY - up) * cp - (distance + seatForward) * sp) > seatDepth * tangent * .95) return false;
      const x = eyeX - sy * distance + cy * shoulder, y = eyeY + up, z = eyeZ - cy * distance - sy * shoulder;
      if (!capsuleFree(world, x, y - radius, z, radius, 2 * radius) ||
        !visible(x, y, z, 3, true) || !visible(x, y, z, 0, true) || body.cast(x, y, z, 0, 1, 0, .001, radius + .25 * body.size) === 0) return false;
      cam.x = x; cam.y = y; cam.z = z;
      this.previous = index;
      return true;
    };
    if (!reset && this.previous >= 0 && candidate(this.previous)) return true;
    for (let i = 0; i < reaches.length * shoulders.length * elevations.length; i++) if (candidate(i)) return true;
    return false;
  }
}
