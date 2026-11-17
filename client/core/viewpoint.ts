// Places the camera at the eye, or over the right shoulder in third person, pulled in when something solid is in the way.
// The body always aims from its own eye, so the view cannot move a shot and the server never learns which view is used.

import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Camera } from "./render/camera.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { vehicleRotation, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { mountCameraHeight } from "./mount-camera.ts";

const rotation = new Float64Array(4), forward = new Float64Array(3), up = new Float64Array(3);

/** Full aircraft attitude composed with mouse look in the cabin's own frame. */
function cockpitOrientation(frame: VehicleFrame, yaw: number, pitch: number, out: { yaw: number; pitch: number; roll?: number }): void {
  vehicleRotation(frame, rotation);
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  quatRotate(rotation, 0, sy * cp, sp, cy * cp, forward, 0);
  quatRotate(rotation, 0, -sy * sp, cp, -cy * sp, up, 0);
  out.yaw = Math.atan2(forward[0]!, forward[2]!);
  out.pitch = Math.atan2(forward[1]!, Math.hypot(forward[0]!, forward[2]!));
  const wy = out.yaw, wp = out.pitch;
  const right = -Math.cos(wy) * up[0]! + Math.sin(wy) * up[2]!;
  const upright = -Math.sin(wy) * Math.sin(wp) * up[0]! + Math.cos(wp) * up[1]! - Math.cos(wy) * Math.sin(wp) * up[2]!;
  if ("roll" in out) out.roll = Math.atan2(right, upright);
}

/** Cockpit mouse offsets and the independent chase bearing survive view switches. Flight controls never read them. */
export class CockpitLook {
  active = false;
  yaw = 0;
  pitch = 0;
  private host = -1;
  private chaseYaw = 0;
  private chasePitch = 0;

  sync(host: number, inside: boolean, look: { yaw: number; pitch: number }, frame?: VehicleFrame): void {
    const changed = host !== this.host;
    const active = host >= 0 && inside && frame !== undefined;
    if (this.active && !active && !changed) { look.yaw = this.chaseYaw; look.pitch = this.chasePitch; }
    if (changed) { this.yaw = this.pitch = 0; this.host = host; }
    if (active && (!this.active || changed)) { this.chaseYaw = look.yaw; this.chasePitch = look.pitch; }
    this.active = active;
    if (active) cockpitOrientation(frame!, this.yaw, this.pitch, look);
  }

  look(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + pitch));
  }
}

/** Metres behind, beside and above the eye. */
const BACK = 3.4;
const SIDE = 0.55;
const RISE = 0.25;
/** Gap kept between the camera and the obstacle, so the near plane does not cut into a wall. */
const CLEAR = 0.3;
/** Milliseconds the camera takes to go from one view to the next, and the furthest (metres) it eases rather than cuts. */
const EASE_MS = 350;
const EASE_REACH = 15;
/** The vehicle's own motion, and how far back (metres) the boom holds the camera at rest: its size's, not one number for all. */
export interface VehicleCameraMotion { vx: number; vy: number; vz: number; id?: number; boom?: number; anticipate?: boolean; safeY?: number; wantedY?: number }

export class Viewpoint {
  thirdPerson = false;
  private vehicleLook = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private lookIdle = 0;
  private vehicleId = -1;
  private readonly target = new Float64Array(3);
  private readonly targetVelocity = new Float64Array(3);
  private boom = 6;
  private clearReach = 0;
  /** Where the camera was last placed, and while easing, where the ease began and the milliseconds it has left. */
  private placed = false;
  private readonly last = new Float64Array(3);
  private readonly easeFrom = new Float64Array(3);
  private easing = 0;

  /** A centred chase view. Mouse look wins; only a moving driver's idle view gently follows the car. Returns look yaw. */
  placeVehicle(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number, heading: number, speed: number, dt: number, follow = true, motion?: VehicleCameraMotion): number {
    const elapsed = Math.max(0, Math.min(100, dt));
    const switched = !this.vehicleLook || (motion?.id ?? -1) !== this.vehicleId;
    const reset = switched || Math.hypot(ex - this.target[0]!, ey - this.target[1]!, ez - this.target[2]!) > 10;
    if (reset || Math.abs(angle(yaw - this.lastYaw)) > 0.00001 || Math.abs(pitch - this.lastPitch) > 0.00001) this.lookIdle = 0;
    else this.lookIdle += elapsed;
    if (follow && speed > 1 && this.lookIdle > 1200) yaw += angle(heading - yaw) * (1 - Math.exp(-elapsed / 1800));
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.vehicleLook = true;
    this.vehicleId = motion?.id ?? -1;
    const wanted = [ex + Math.max(-1.8, Math.min(1.8, (motion?.vx ?? 0) * .1)), ey + Math.max(-.25, Math.min(.25, (motion?.vy ?? 0) * .035)), ez + Math.max(-1.8, Math.min(1.8, (motion?.vz ?? 0) * .1))];
    const seconds = elapsed / 1000;
    for (let i = 0; i < 3; i++) {
      if (reset) { this.target[i] = wanted[i]!; this.targetVelocity[i] = 0; continue; }
      // Exact critically damped spring: stable through variable frame times, with softer vertical suspension response.
      const omega = i === 1 ? 12 : 22, decay = Math.exp(-omega * seconds);
      const offset = this.target[i]! - wanted[i]!, change = (this.targetVelocity[i]! + omega * offset) * seconds;
      this.target[i] = wanted[i]! + (offset + change) * decay;
      this.targetVelocity[i] = (this.targetVelocity[i]! - omega * change) * decay;
    }
    const rest = motion?.boom ?? 6, back = rest + Math.min(rest / 3, Math.abs(speed) * .06);
    this.boom = reset ? back : this.boom + (back - this.boom) * (1 - Math.exp(-seconds * 4));
    const viewPitch = Math.max(-1.35, Math.min(1.15, pitch - 0.12));
    cam.yaw = yaw;
    cam.pitch = viewPitch;
    cam.roll = 0;
    const dx = this.target[0]! - ex - Math.sin(yaw) * Math.cos(viewPitch) * this.boom;
    const dy = this.target[1]! - ey - Math.sin(viewPitch) * this.boom + 0.65;
    const dz = this.target[2]! - ez - Math.cos(yaw) * Math.cos(viewPitch) * this.boom;
    const length = Math.hypot(dx, dy, dz);
    let reach = length;
    if (world && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) reach = Math.max(0, rayHit.t - CLEAR);
    if (motion?.anticipate) {
      let wantedReach = reach;
      // Retract before the pivot starts descending: sharing its shorter horizon makes both moves start
      // together and a reversing rider's camera can reach the roof before the boom has shortened.
      const speed = Math.hypot(motion.vx, motion.vz), ahead = Math.min(1.5, 12 / Math.max(1, speed));
      // A roof edge becomes visible to the future boom before the rider crosses it. Retract while the route is clear.
      const samples = Math.max(1, Math.ceil(speed * ahead / .15));
      if (world && speed > .01) for (let k = 1; k <= samples; k++) {
        const step = ahead * k / samples, x = ex + motion.vx * step, z = ez + motion.vz * step;
        const futureY = mountCameraHeight(world, x, z, motion.safeY ?? ey, motion.wantedY ?? ey);
        // The pivot can descend before the mount enters a roof. Test both the current and lowered boom
        // so a camera ahead of a reversing mount retracts before its pivot descends.
        if (castWorld(world, x, ey, z, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) wantedReach = Math.min(wantedReach, Math.max(0, rayHit.t - CLEAR));
        if (futureY < ey && castWorld(world, x, futureY, z, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) wantedReach = Math.min(wantedReach, Math.max(0, rayHit.t - CLEAR));
      }
      if (reset) this.clearReach = wantedReach;
      else {
        const change = (wantedReach - this.clearReach) * (1 - Math.exp(-seconds / .18));
        this.clearReach += Math.max(-20 * seconds, Math.min(20 * seconds, change));
      }
      // Sudden new geometry still wins over easing; never smooth through a solid obstacle.
      this.clearReach = Math.min(reach, this.clearReach);
      reach = this.clearReach;
    }
    const k = reach / length;
    cam.x = ex + dx * k;
    cam.y = ey + dy * k;
    cam.z = ez + dz * k;
    this.ease(cam, world, ex, ey, ez, switched, elapsed);
    return yaw;
  }

  /**
   * The eye is at (ex, ey, ez). `yaw` and `pitch` are radians. Coming from a chase view (getting off or out), the camera
   * eases over `dt` ms from where it was.
   */
  place(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number, dt = 0): void {
    const switched = this.vehicleLook;
    this.vehicleLook = false;
    this.put(cam, world, ex, ey, ez, yaw, pitch);
    this.ease(cam, world, ex, ey, ez, switched, Math.max(0, Math.min(100, dt)));
  }

  /** An enclosed eye stays in its seat even during a loop; it never eases through the cabin wall from chase view. */
  placeCockpit(cam: Camera, ex: number, ey: number, ez: number, frame: VehicleFrame, yaw: number, pitch: number): void {
    this.vehicleLook = false;
    this.easing = 0;
    cam.x = ex; cam.y = ey; cam.z = ez;
    cockpitOrientation(frame, yaw, pitch, cam);
    this.ease(cam, null, ex, ey, ez, false, 0);
  }

  /**
   * After a change between the eye's view and a chase view, or between hosts, the camera goes from where it was to where
   * it is placed over EASE_MS rather than at once, and is kept on the near side of anything solid on the way.
   */
  private ease(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, switched: boolean, dt: number): void {
    const from = this.easeFrom;
    if (switched && this.placed && Math.hypot(cam.x - this.last[0]!, cam.y - this.last[1]!, cam.z - this.last[2]!) < EASE_REACH) {
      this.easing = EASE_MS;
      from.set(this.last);
    }
    if (this.easing > 0) {
      this.easing = Math.max(0, this.easing - dt);
      const t = 1 - this.easing / EASE_MS, s = t * t * (3 - 2 * t);
      let dx = from[0]! + (cam.x - from[0]!) * s - ex, dy = from[1]! + (cam.y - from[1]!) * s - ey, dz = from[2]! + (cam.z - from[2]!) * s - ez;
      const length = Math.hypot(dx, dy, dz);
      if (world && length > 1e-6 && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) {
        const k = Math.max(0, rayHit.t - CLEAR) / length;
        dx *= k; dy *= k; dz *= k;
      }
      cam.x = ex + dx;
      cam.y = ey + dy;
      cam.z = ez + dz;
    }
    this.last[0] = cam.x;
    this.last[1] = cam.y;
    this.last[2] = cam.z;
    this.placed = true;
  }

  private put(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number): void {
    cam.yaw = yaw;
    cam.pitch = pitch;
    cam.roll = 0;
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
