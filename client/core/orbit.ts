// ARK's orbit camera (K): looking swings the camera round the body or its mount without turning it, and the wheel moves it
// nearer or further. It is the client's alone: the look the input carries stays where the body faced, so the server
// never learns of it.

import { CHASE_DOWN, CHASE_UP, EASE_MS } from "./viewpoint.ts";

/** The nearest and furthest the orbit sits, as shares of its view's own distance, and the share one wheel notch moves it. */
export const ORBIT_NEAR = .4;
export const ORBIT_FAR = 3;
export const ORBIT_NOTCH = 2 ** .25;
/** Seconds the shown distance takes to close about two thirds of a wheel step. */
const ZOOM_SECONDS = .08;
/** Wheel notches one event may move, so a flung wheel is not a jump across the whole range. */
const MOST_NOTCHES = 3;

/** A camera's place about its pivot: its bearing (radians, as Camera's), and metres back along it, right of it and up. */
export interface OrbitRig { yaw: number; pitch: number; back: number; side: number; rise: number }

export const rig = (): OrbitRig => ({ yaw: 0, pitch: 0, back: 0, side: 0, rise: 0 });

export class Orbit {
  /** The orbit is wanted. Once let go its view still eases back for EASE_MS. */
  on = false;
  /** The camera's bearing while on: yaw 0 faces +Z and positive pitch looks up, within the chase camera's limits. */
  yaw = 0;
  pitch = 0;
  /** The distance wanted, as a share of the view's own; `shownZoom` follows it. */
  zoom = 1;
  private shownZoom = 1;
  /** Milliseconds of ease left. `fresh`: a start or end not yet measured, from the orbit's shown rig (`fromShown`) or from the view's own. */
  private left = 0;
  private fresh = false;
  private fromShown = false;
  /** The view at a start or end less the one it went to, eased away over EASE_MS, so looking stays one to one throughout. */
  private readonly gap = rig();
  /** The rig the camera was last given. */
  readonly shown = rig();
  private subject = NaN;

  /** The orbit places the camera: on, or easing back. */
  get inUse(): boolean { return this.on || this.left > 0; }

  /** Starts or ends the orbit. Its start takes the camera's bearing and distance, so neither changes at once. */
  set(on: boolean): void {
    if (on === this.on) return;
    if (!this.fresh) this.fromShown = this.inUse;
    this.on = on;
    this.left = EASE_MS;
    this.fresh = true;
  }

  /** A view the game forces (a seat, a cockpit) takes over at once, and eases from where the camera was by its own means. */
  cut(): void { this.on = this.fresh = false; this.left = 0; }

  /** What the camera goes round, each frame: a change of it cuts the orbit. Returns whether it did. */
  follow(subject: number): boolean {
    const cut = subject !== this.subject && this.inUse;
    if (cut) this.cut();
    this.subject = subject;
    return cut;
  }

  /** Radians, as Controls.look turns the body. */
  look(yaw: number, pitch: number): void {
    if (!this.on) return;
    this.yaw += yaw;
    this.pitch = Math.max(CHASE_DOWN, Math.min(CHASE_UP, this.pitch + pitch));
  }

  /** Wheel notches, positive away from the body. Returns whether the orbit took them. */
  wheel(notches: number): boolean {
    if (!this.on || !Number.isFinite(notches)) return false;
    const n = Math.max(-MOST_NOTCHES, Math.min(MOST_NOTCHES, notches));
    this.zoom = Math.max(ORBIT_NEAR, Math.min(ORBIT_FAR, this.zoom * ORBIT_NOTCH ** n));
    return true;
  }

  /**
   * The rig to place the camera by this frame, or null when the view is the player's own. `view` is that view's rig,
   * `natural` the distance the orbit sits at before the wheel moves it, `dt` milliseconds.
   */
  place(view: OrbitRig, natural: number, dt: number): OrbitRig | null {
    if (!this.inUse) return null;
    const ms = Math.max(0, Math.min(100, dt));
    if (this.fresh) {
      const from = this.fromShown ? this.shown : view;
      if (this.on) {
        this.yaw = from.yaw;
        this.pitch = Math.max(CHASE_DOWN, Math.min(CHASE_UP, from.pitch));
        this.zoom = this.shownZoom = 1;
      }
      const to = this.target(view, natural);
      this.gap.yaw = angle(from.yaw - to.yaw);
      this.gap.pitch = from.pitch - to.pitch;
      this.gap.back = from.back - to.back;
      this.gap.side = from.side - to.side;
      this.gap.rise = from.rise - to.rise;
      this.fresh = false;
    } else this.left = Math.max(0, this.left - ms);
    this.shownZoom += (this.zoom - this.shownZoom) * (1 - Math.exp(-ms / 1000 / ZOOM_SECONDS));
    const to = this.target(view, natural), t = 1 - this.left / EASE_MS, k = 1 - t * t * (3 - 2 * t);
    const s = this.shown;
    s.yaw = to.yaw + this.gap.yaw * k;
    s.pitch = to.pitch + this.gap.pitch * k;
    s.back = to.back + this.gap.back * k;
    s.side = to.side + this.gap.side * k;
    s.rise = to.rise + this.gap.rise * k;
    return s;
  }

  private readonly aim = rig();
  private target(view: OrbitRig, natural: number): OrbitRig {
    if (!this.on) return view;
    const a = this.aim;
    a.yaw = this.yaw; a.pitch = this.pitch; a.back = natural * this.shownZoom; a.side = a.rise = 0;
    return a;
  }
}

function angle(n: number): number { return Math.atan2(Math.sin(n), Math.cos(n)); }
