// What a screen can play: clips and still images in a cluster's library, channels that order them, and what each type
// of screen shows. The server keeps them (server/video/library.ts); a client fetches the manifest once and is told what
// plays by OWN_SCREEN (screen.ts). Nothing here is decoded: a poster and a colour track were made when an item was added.
import { ORB_SCENES } from "../world/orb.ts";

/** The longest side, the shorter side, the bit rate, the length and the size a clip may have. 480p is finer than the orb's pucks. */
export const CLIP_MAX_WIDE = 854;
export const CLIP_MAX_HIGH = 480;
export const CLIP_MAX_KBPS = 1500;
export const CLIP_MAX_SECONDS = 30 * 60;
export const CLIP_MAX_BYTES = 200 * 1024 * 1024;

/** The longest side and the size a still image may have, and the types a file may be. */
export const IMAGE_MAX_LONG = 1280;
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const IMAGE_TYPES = ["png", "jpeg", "webp"] as const;
/** Seconds an image holds in a channel unless the channel says, and one played once. */
export const STILL_SECONDS = 8;
export const ONCE_STILL_SECONDS = 15;

/** Samples of a clip's colour track a second. */
export const COLOUR_RATE = 4;
/** Colours a sample holds: the mean, then the top, right, bottom and left edges. */
export const COLOUR_PARTS = 5;

/**
 * An item of the library, as the manifest lists it: a clip, or a still image (`kind` "image"), whose `seconds` is 0 and
 * whose time on a screen its channel gives. Paths are served by our own server, named by the file's hash.
 */
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
  /** Base64 of sRGB bytes, COLOUR_PARTS colours of 3 bytes per sample, COLOUR_RATE samples a second; an image's is one sample. */
  readonly colours: string;
  /** "image" for a still; a clip has none. */
  readonly kind?: "image";
  /** The types of screen it is offered on; every type where it says none. */
  readonly types?: readonly ScreenType[];
}

/** Whether an item is a still image. */
export const isImage = (c: { readonly kind?: string }): boolean => c.kind === "image";
/** Whether an item is offered on screens of `type`. */
export const offeredOn = (c: { readonly types?: readonly ScreenType[] }, type: ScreenType): boolean => !c.types || c.types.includes(type);

/** The items a client may be told to play, in the order OWN_SCREEN numbers them, and the channels, in its order too. */
export interface Manifest {
  readonly clips: readonly Clip[];
  readonly channels?: readonly Channel[];
}

/**
 * A named playlist for one type of screen. Its programme starts at `epoch` (wall clock, ms) and repeats; shuffled, each
 * round has its own order. An image in it holds for `still` seconds. Names are unique across every type.
 */
export interface Channel {
  readonly name: string;
  readonly items: readonly string[];
  readonly shuffle: boolean;
  readonly epoch: number;
  /** The type of screen it plays on; the ball where it says none. */
  readonly type?: ScreenType;
  readonly still?: number;
}

/** A channel's type of screen. */
export const channelType = (c: { readonly type?: ScreenType }): ScreenType => c.type ?? "orb";

/** How a screen draws a picture: facing each viewer, or wrapped round the ball in copies. */
export type ScreenMode = "facing" | "fixed";

/**
 * What one type of screen shows. `show` is "scenes", "scene:<name>" (one scene held, the ball's alone), or a channel's
 * name; `once` plays one item from `from` (wall ms), then returns to `show`. "scenes" on any type but the ball is its
 * face dark. Every screen of a type shows the same channel, each at its own place in it.
 */
export interface Screen {
  readonly screen: ScreenType;
  readonly show: string;
  readonly once: { readonly clip: string; readonly from: number } | null;
  readonly mode: ScreenMode;
  /** Crop the picture to cover the ball's face instead of fitting it whole. */
  readonly fill: boolean;
  readonly sound: boolean;
  /** Play only by night; the scenes run by day. */
  readonly night: boolean;
}

/** The types of screen there are, in the order OWN_SCREEN lists them. The ball is the first. */
export const SCREENS = ["orb", "billboard", "tv", "laptop"] as const;
export type ScreenType = (typeof SCREENS)[number];
export const isScreenType = (s: unknown): s is ScreenType => (SCREENS as readonly unknown[]).includes(s);

/** Each type's name on the Screens page and its faces' width to height. */
export const SCREEN_TYPES: Readonly<Record<ScreenType, { readonly label: string; readonly aspect: number }>> = {
  orb: { label: "The Vegas ball", aspect: 16 / 9 },
  billboard: { label: "Billboards", aspect: 14.8 / 4.85 },
  tv: { label: "TVs", aspect: 16 / 9 },
  laptop: { label: "Laptops", aspect: 16 / 10 },
};


/** What `show` holds a scene by: "scene:" and the scene's name (shared/world/orb.ts ORB_SCENES). */
export const SCENE_SHOW = "scene:";
/** The scene a screen's `show` holds, its number in ORB_SCENES, or -1 where it holds none. */
export const heldSceneOf = (show: string): number => (show.startsWith(SCENE_SHOW) ? ORB_SCENES.indexOf(show.slice(SCENE_SHOW.length) as (typeof ORB_SCENES)[number]) : -1);

/** A type's screen as a new library has it: the ball on its scenes, any other on `channel` where there is one, else dark. */
export const defaultScreen = (screen: ScreenType, channel?: string): Screen => ({ screen, show: screen !== "orb" && channel ? channel : "scenes", once: null, mode: "facing", fill: true, sound: false, night: false });

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
