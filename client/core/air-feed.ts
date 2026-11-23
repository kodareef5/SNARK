// A launched drone's camera, as its operator sees it: a feed over a radio link from the rack (planning/workstreams/
// air-support.md). A part of the app's frame after the camera is placed at the drone: it chooses the feed's view (V: the
// feed's own, night or heat), its zoom (the wheel), its bursts of interference and the frames it freezes on as the
// signal weakens, and writes what the picture is to take (render/feed.ts) into the scene's optic. N marks what the
// reticle holds for the tribe (hud/tracks.ts finds it).

import { CMD_MARK, DRONE_LOOK } from "../../shared/net/protocol.ts";
import type { AppFrame, FramePart } from "./frame.ts";
import type { KeyRow } from "./key-row.ts";
import { easeFov, FOV_EASE_MS, lookScale, magnification, zoomed } from "./optics.ts";
import { burstOdds, freezeOdds } from "./render/feed.ts";
import { daylight } from "./render/laser.ts";
import { OPTIC_FEED, OPTIC_HEAT, OPTIC_NIGHT } from "./render/packet.ts";
import type { Optic } from "./render/post.ts";
import { HEAT_GRAIN, NIGHT_GAIN, NIGHT_GRAIN } from "./visor.ts";

/** Metres from the rack at which the link is lost; a full signal within FEED_CLEAR of it. */
export const AIR_FEED_RANGE = 1200;
export const FEED_CLEAR = 0.25;
/** The feed's zoom: its least, its most, and a step of the wheel. */
export const FEED_ZOOM_MIN = 1;
export const FEED_ZOOM_MAX = 8;
export const FEED_ZOOM_STEP = 1.25;
/** Milliseconds "MARKED" shows after N marks. */
export const FEED_MARKED_MS = 1500;

/** The signal, 0 to 1, of a drone `distance` metres from its rack: whole near it, easing to none at AIR_FEED_RANGE. */
export function feedSignal(distance: number): number {
  const t = (distance / AIR_FEED_RANGE - FEED_CLEAR) / (1 - FEED_CLEAR);
  return t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
}

/** A drone flown from this page (ClientSession.airFeed): its bay, fuel and signal, where its camera is, and its speed in m/s. */
export interface AirFeedView {
  active: boolean;
  bay: number;
  fuel: number;
  signal: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
}

export const airFeedView = (): AirFeedView => ({ active: false, bay: 0, fuel: 0, signal: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0 });

/** What the feed shows this frame, for the HUD (hud/air-feed.ts). */
export interface FeedShown {
  active: boolean;
  /** OPTIC_FEED, OPTIC_NIGHT or OPTIC_HEAT. */
  mode: number;
  zoom: number;
  /** The picture is held on a frame; a burst of interference, 0 to 1. */
  frozen: boolean;
  burst: number;
  /** When N last marked, ms, and the vertical field of view, radians. */
  markedAt: number;
  fov: number;
}

/** A small generator of numbers 0 to 1 that makes nothing. */
function next(state: Uint32Array): number {
  let x = state[0]!;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state[0] = x >>> 0;
  return state[0]! / 4294967296;
}

export class AirFeed implements FramePart {
  mode = OPTIC_FEED;
  zoom = FEED_ZOOM_MIN;
  readonly shown: FeedShown = { active: false, mode: OPTIC_FEED, zoom: 1, frozen: false, burst: 0, markedAt: -Infinity, fov: 1 };
  private fov = 0;
  private burst = 0;
  private frozenUntil = -Infinity;
  private heldSeed = 0;
  private readonly held = new Float64Array(5);
  private readonly rng = new Uint32Array([0x9e3779b9]);

  /** V: the feed's own view, night, heat, and the feed's own again. */
  cycle(): void {
    this.mode = this.mode === OPTIC_FEED ? OPTIC_NIGHT : this.mode === OPTIC_NIGHT ? OPTIC_HEAT : OPTIC_FEED;
  }

  /** `notches` of the wheel, down (positive) to widen and up to narrow. */
  wheel(notches: number): void {
    this.zoom = Math.min(FEED_ZOOM_MAX, Math.max(FEED_ZOOM_MIN, this.zoom * FEED_ZOOM_STEP ** -notches));
  }

  /** Writes what the feed does to the picture into `out` (post.ts Optic): at `signal`, `day` 1 by day and 0 at night (laser.ts daylight). */
  frame(out: Optic, signal: number, day: number, burst: number): void {
    const night = this.mode === OPTIC_NIGHT;
    out.mode = this.mode;
    out.gain = night ? 1 + (NIGHT_GAIN - 1) * (1 - day) : 1;
    out.grain = night ? NIGHT_GRAIN : this.mode === OPTIC_HEAT ? HEAT_GRAIN : 0;
    out.feed = true;
    out.signal = signal;
    out.burst = burst;
  }

  step(f: AppFrame): void {
    const feed = f.session.airFeed, out = f.scene.optic, shown = this.shown;
    shown.active = feed.active;
    if (!feed.active) {
      out.feed = false;
      out.seed = undefined;
      this.fov = 0;
      this.frozenUntil = -Infinity;
      return;
    }
    const dt = Math.min(100, Math.max(0, f.dt)), cam = f.cam, now = f.nowMs;
    // Interference comes in bursts, and a weak link holds a frame now and then: oftener the weaker it is.
    this.burst = Math.max(0, this.burst - dt / 160);
    if (next(this.rng) < burstOdds(feed.signal) * dt / 1000) this.burst = 0.5 + 0.5 * next(this.rng);
    if (now >= this.frozenUntil && next(this.rng) < freezeOdds(feed.signal) * dt / 1000) {
      this.frozenUntil = now + 120 + 300 * next(this.rng);
      this.heldSeed = Math.floor(f.sceneMs / 16);
    }
    const frozen = now < this.frozenUntil, h = this.held;
    if (frozen) {
      cam.x = h[0]!; cam.y = h[1]!; cam.z = h[2]!; cam.yaw = h[3]!; cam.pitch = h[4]!;
    } else {
      h[0] = cam.x; h[1] = cam.y; h[2] = cam.z; h[3] = cam.yaw; h[4] = cam.pitch;
    }
    // The wheel narrows the view as a sight does, and the look slows to match (optics.ts).
    const settings = f.settings, base = (settings.fov * Math.PI) / 180, want = zoomed(base, this.zoom);
    this.fov = this.fov > 0 ? easeFov(this.fov, want, Math.min(1, dt / FOV_EASE_MS)) : want;
    cam.fovY = this.fov;
    cam.zoom = magnification(base, this.fov);
    f.controls.zoom = lookScale(base, this.fov, settings.sensitivity, settings.zoomSensitivity);
    this.frame(out, feed.signal, daylight(f.sky.hour), this.burst);
    out.seed = frozen ? this.heldSeed : undefined;
    shown.mode = this.mode;
    shown.zoom = this.zoom;
    shown.frozen = frozen;
    shown.burst = this.burst;
    shown.fov = this.fov;
  }
}

/** While a drone is flown: V turns the feed's view, N (a pad's X) marks what the reticle holds for the tribe. */
export const FEED_KEYS: readonly KeyRow[] = [{
  name: "feed view",
  keys: ["KeyV"],
  when: (c) => c.session.airFeed.active,
  press(c, _code, down, repeat) {
    if (down && !repeat) c.feed.cycle();
    return true;
  },
}, {
  name: "feed mark",
  keys: ["KeyN", "KeyR"],
  when: (c, code, _down, _repeat) => c.session.airFeed.active && (code === "KeyN" || c.ui.inputDevice === 1),
  press(c, _code, down, repeat) {
    const m = c.hud;
    const t = m.trackLock >= 0 ? m.tracks[m.trackLock]! : null;
    if (down && !repeat && t && !t.player && t.far <= DRONE_LOOK) {
      c.session.command(CMD_MARK, (w) => (w.u32(t.id), w.u16(t.gen)));
      c.feed.shown.markedAt = c.nowMs;
    }
    return true;
  },
}];
