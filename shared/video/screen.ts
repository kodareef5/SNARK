// OWN_SCREEN: what a world tells each client each type of screen plays. Written when it changes, never per tick. Times
// are the world's own ticks, which the client's render clock follows, so a client needs no wall clock. A type's many
// screens each find their own item in its channel (programme.ts channelAtOffset), from the channel's epoch as a tick.
import type { BitReader, BitWriter } from "../net/codec.ts";

export const SHOW_SCENES = 0;
export const SHOW_VIDEO = 1;

export const SCREEN_FACING = 1;
export const SCREEN_FILL = 2;
export const SCREEN_SOUND = 4;
/** What plays is the one showing, on every screen of the type alike. */
export const SCREEN_ONCE = 8;

/** No clip, in a clip's place, and no channel in a channel's. */
export const NO_CLIP = 0xffff;
export const NO_CHANNEL = 0xffff;

/** What a screen shows, as the client keeps it. `clip` and `next` number the manifest's clips. */
export interface ScreenState {
  /** The manifest's id (16 hex digits), or "" for none. */
  manifest: string;
  show: number;
  flags: number;
  clip: number;
  /** The world tick at which the clip's first second plays; it may be before the world began. */
  start: number;
  next: number;
  /** The scene an admin holds the screen to while no clip plays, its number in ORB_SCENES, or -1 for the scenes' programme. */
  scene: number;
  /** The channel the type shows, its number in the manifest's channels, or NO_CHANNEL. */
  channel: number;
  /** The world tick at which the channel's epoch fell; it may be before the world began. */
  epoch: number;
}

export const newScreenState = (): ScreenState => ({ manifest: "", show: SHOW_SCENES, flags: SCREEN_FACING, clip: NO_CLIP, start: 0, next: NO_CLIP, scene: -1, channel: NO_CHANNEL, epoch: 0 });

/** The scene a screen holds the orb to, or `fallback` (the world's own setting) where it holds none. */
export const heldScene = (s: ScreenState | undefined, fallback: number): number => (s && s.show === SHOW_SCENES && s.scene >= 0 ? s.scene : fallback);

/** Every type's state, in SCREENS order (clip.ts). The manifest is 8 bytes; each type is 25. */
export function writeScreens(w: BitWriter, screens: readonly ScreenState[]): void {
  const manifest = screens[0]?.manifest ?? "";
  w.u32(manifest ? parseInt(manifest.slice(0, 8), 16) >>> 0 : 0);
  w.u32(manifest ? parseInt(manifest.slice(8, 16), 16) >>> 0 : 0);
  w.u8(screens.length);
  for (const s of screens) {
    w.u8(s.show);
    w.u8(s.flags);
    w.u16(s.clip);
    w.f64(s.start);
    w.u16(s.next);
    w.u8(s.scene + 1);
    w.u16(s.channel);
    w.f64(s.epoch);
  }
}

export function readScreens(r: BitReader, out: ScreenState[]): void {
  const hi = r.u32(), lo = r.u32();
  const manifest = hi === 0 && lo === 0 ? "" : hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
  const count = r.u8();
  for (let i = 0; i < count; i++) {
    const s = out[i] ?? (out[i] = newScreenState());
    s.manifest = manifest;
    s.show = r.u8();
    s.flags = r.u8();
    s.clip = r.u16();
    s.start = r.f64();
    s.next = r.u16();
    s.scene = r.u8() - 1;
    s.channel = r.u16();
    s.epoch = r.f64();
  }
  out.length = count;
}

/** Seconds into its clip a screen is at `tick`, and the served path of the manifest named `id`. */
export const screenSeconds = (s: ScreenState, tick: number, tickRate: number): number => (tick - s.start) / tickRate;
export const manifestPath = (id: string): string => `/media/video.${id}.json`;
