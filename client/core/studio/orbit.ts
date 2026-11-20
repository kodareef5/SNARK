// The studio's camera: round a subject at a distance that shows it whole, turned by a drag, the arrows or by itself, drawn
// in by the wheel or a pinch, and never under the ground. Yaw 0 looks along +Z, as the game's camera does, and a negative
// pitch looks down.

import type { Camera } from "../render/camera.ts";

/** A subject's middle and the radius of a ball about it that holds it. */
export interface Bounds {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Radians a pixel of drag turns, and the turntable's rate (radians a second). */
const DRAG = 0.008;
const TURNTABLE = 0.35;
/** How far in and out from the framed distance the view may go. */
const NEAREST = 0.35;
const FARTHEST = 3;
/** The steepest look down, and how far over the ground the camera keeps. */
const STEEPEST = -1.35;
const CLEARANCE = 0.12;

export class Orbit {
  yaw = 0;
  pitch = -0.2;
  distance = 5;
  /** The framed distance, from which zoom is measured. */
  framed = 5;
  turning = true;
  readonly target = { x: 0, y: 0, z: 0 };
  /** The ground's height under the subject. */
  ground = 0;

  /** Looks at `b` from three-quarters front, far enough off that all of it is in a view of `fovY` and `aspect`. */
  frame(b: Bounds, fovY: number, aspect: number, ground: number): void {
    const half = Math.min(fovY, 2 * Math.atan(Math.tan(fovY / 2) * aspect)) / 2;
    this.framed = (Math.max(0.05, b.radius) / Math.sin(half)) * 1.08;
    this.distance = this.framed;
    Object.assign(this.target, { x: b.x, y: b.y, z: b.z });
    this.ground = ground;
    // Its face is toward -Z at yaw 0 (it faces +Z), so the view from in front and to its left.
    this.yaw = Math.PI + 0.6;
    this.pitch = -0.22;
    this.turning = true;
    this.clamp();
  }

  /** A drag of (dx, dy) pixels; it stops the turntable. */
  drag(dx: number, dy: number): void {
    this.turning = false;
    this.yaw -= dx * DRAG;
    this.pitch -= dy * DRAG;
    this.clamp();
  }

  /** Nearer by `factor` (above 1) or farther (below). */
  zoom(factor: number): void {
    this.distance = Math.max(this.framed * NEAREST, Math.min(this.framed * FARTHEST, this.distance / factor));
    this.clamp();
  }

  /** On by `seconds`: the turntable, while it turns. */
  step(seconds: number): void {
    if (this.turning) this.yaw += TURNTABLE * seconds;
  }

  /** Keeps the look within its steepest and the camera over the ground. */
  clamp(): void {
    const over = this.target.y - this.ground - CLEARANCE;
    const flattest = over >= this.distance ? Math.PI / 2 : Math.asin(Math.max(-1, over / this.distance));
    this.pitch = Math.max(STEEPEST, Math.min(Math.min(0.6, flattest), this.pitch));
  }

  /** Puts `cam` where the orbit has it. */
  place(cam: Camera): void {
    const c = Math.cos(this.pitch);
    cam.x = this.target.x - Math.sin(this.yaw) * c * this.distance;
    cam.y = this.target.y - Math.sin(this.pitch) * this.distance;
    cam.z = this.target.z - Math.cos(this.yaw) * c * this.distance;
    cam.yaw = this.yaw;
    cam.pitch = this.pitch;
    cam.near = Math.max(0.02, Math.min(0.25, this.distance * 0.05));
  }
}

/** The zoom of a pinch: the fingers' spread now over what it was. */
export function pinchZoom(was: number, now: number): number {
  return was > 0 && now > 0 ? now / was : 1;
}
