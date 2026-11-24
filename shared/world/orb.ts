// An orb: a great lit sphere standing on the ground, its skin a screen. The map head places it once, as it places a
// Tide Eye, so it is drawn whatever chunks a client holds; its collision pieces travel as ordinary statics.
import { CAST_PHASE, EYE_PERIOD } from "./tide-eye.ts";

/** Metres: `x`, `z` its axis, `y` the ground there. The sphere's centre is `centre` over the ground and its radius `radius`. */
export interface OrbSite {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its heading, 65,536 to a turn, as a static's: where longitude 0 of its picture faces. */
  readonly yaw: number;
  readonly radius: number;
  readonly centre: number;
}

// ---- The programme, which every client reads from the server clock and no message carries.
// A scene holds for two cycles of the blue Tide Eye and changes on its cast, with a wipe across the skin.

/** The scenes, in the order the programme shows them. A scene's number is its place here. */
export const ORB_SCENES = ["watcher", "moon", "core", "storm", "tide"] as const;
export type OrbScene = typeof ORB_SCENES[number];
/** Seconds a scene holds, and seconds a change takes to cross the skin. */
export const ORB_HOLD = 2 * EYE_PERIOD;
export const ORB_WIPE = 4;

/** What an orb shows at a moment: the scene, the one before it, and how far the change has crossed, 0 to 1 (1 once done). */
export interface OrbShow {
  scene: number;
  before: number;
  wipe: number;
}

/**
 * What every orb shows at `seconds` on the server clock, into `out`. `only` holds one scene for good (an admin's
 * choice) where it is a scene's number, and -1 leaves the programme to run.
 */
export function orbShow(seconds: number, out: OrbShow, only = -1): OrbShow {
  if (only >= 0) {
    out.scene = out.before = only % ORB_SCENES.length;
    out.wipe = 1;
    return out;
  }
  const since = seconds - CAST_PHASE, slot = Math.floor(since / ORB_HOLD), into = since - slot * ORB_HOLD;
  const n = ORB_SCENES.length;
  out.scene = ((slot % n) + n) % n;
  out.before = (((slot - 1) % n) + n) % n;
  out.wipe = into >= ORB_WIPE ? 1 : into / ORB_WIPE;
  return out;
}
