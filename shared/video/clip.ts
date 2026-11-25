// What a screen can play: clips in a cluster's library, channels that order them, and what each screen shows. The
// server keeps them (server/video/library.ts); a client fetches the manifest of clips once and is told what plays by
// OWN_SCREEN (screen.ts). Nothing here is decoded: a clip's poster and colour track were made when it was added.
import { ORB_SCENES } from "../world/orb.ts";

/** The longest side, the shorter side, the bit rate, the length and the size a clip may have. 480p is finer than the orb's pucks. */
export const CLIP_MAX_WIDE = 854;
export const CLIP_MAX_HIGH = 480;
export const CLIP_MAX_KBPS = 1500;
export const CLIP_MAX_SECONDS = 30 * 60;
export const CLIP_MAX_BYTES = 200 * 1024 * 1024;

/** Samples of a clip's colour track a second. */
export const COLOUR_RATE = 4;
/** Colours a sample holds: the mean, then the top, right, bottom and left edges. */
export const COLOUR_PARTS = 5;

/** A clip, as the manifest lists it. Paths are served by our own server, named by the file's hash. */
export interface Clip {
  /** The first 16 hex digits of the file's SHA-256. */
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly poster: string;
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly bytes: number;
  readonly audio: boolean;
  /** One line: where it is from and why we may show it. */
  readonly rights: string;
  /** Shipped with the game, not uploaded. */
  readonly starter: boolean;
  /** Base64 of sRGB bytes, COLOUR_PARTS colours of 3 bytes per sample, COLOUR_RATE samples a second. */
  readonly colours: string;
}

/** The clips a client may be told to play, in the order OWN_SCREEN numbers them. */
export interface Manifest {
  readonly clips: readonly Clip[];
}

/** A named playlist. Its programme starts at `epoch` (wall clock, ms) and repeats; shuffled, each round has its own order. */
export interface Channel {
  readonly name: string;
  readonly items: readonly string[];
  readonly shuffle: boolean;
  readonly epoch: number;
}

/** How a screen draws a picture: facing each viewer, or wrapped round the ball in copies. */
export type ScreenMode = "facing" | "fixed";

/**
 * What one screen shows. `show` is "scenes" (the scenes' own programme), "scene:<name>" (one scene held), or a
 * channel's name; `once` plays one clip from `from` (wall ms), then returns to `show`.
 */
export interface Screen {
  readonly screen: string;
  readonly show: string;
  readonly once: { readonly clip: string; readonly from: number } | null;
  readonly mode: ScreenMode;
  /** Crop the picture to cover the ball's face instead of fitting it whole. */
  readonly fill: boolean;
  readonly sound: boolean;
  /** Play only by night; the scenes run by day. */
  readonly night: boolean;
}

/** The screens there are. The orb is the first; billboards and TVs come later. */
export const SCREENS = ["orb"] as const;

/** What `show` holds a scene by: "scene:" and the scene's name (shared/world/orb.ts ORB_SCENES). */
export const SCENE_SHOW = "scene:";
/** The scene a screen's `show` holds, its number in ORB_SCENES, or -1 where it holds none. */
export const heldSceneOf = (show: string): number => (show.startsWith(SCENE_SHOW) ? ORB_SCENES.indexOf(show.slice(SCENE_SHOW.length) as (typeof ORB_SCENES)[number]) : -1);

export const defaultScreen = (screen: string): Screen => ({ screen, show: "scenes", once: null, mode: "facing", fill: true, sound: false, night: false });

/** One sample of a clip's track, `part` of COLOUR_PARTS, as sRGB from 0 to 1 into `out`; black where it has none. */
export function trackColour(track: Uint8Array, seconds: number, part: number, out: number[] | Float64Array): void {
  const samples = Math.floor(track.length / (3 * COLOUR_PARTS));
  if (samples <= 0) {
    out[0] = out[1] = out[2] = 0;
    return;
  }
  // Between two samples the colour is eased, so the light on the streets never steps.
  const at = Math.max(0, Math.min(samples - 1, seconds * COLOUR_RATE)), a = Math.floor(at), b = Math.min(samples - 1, a + 1), t = at - a;
  for (let c = 0; c < 3; c++) {
    const x = track[(a * COLOUR_PARTS + part) * 3 + c]!, y = track[(b * COLOUR_PARTS + part) * 3 + c]!;
    out[c] = (x + (y - x) * t) / 255;
  }
}

/** A clip's id from a full hex digest. */
export const clipId = (hex: string): string => hex.slice(0, 16).toLowerCase();
export const isClipId = (id: string): boolean => /^[0-9a-f]{16}$/.test(id);
