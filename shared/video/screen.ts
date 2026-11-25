// OWN_SCREEN: what a world tells each client its screens play. Written when it changes, never per tick. Times are the
// world's own ticks, which the client's render clock follows, so a client needs no wall clock.
import type { BitReader, BitWriter } from "../net/codec.ts";

export const SHOW_SCENES = 0;
export const SHOW_VIDEO = 1;

export const SCREEN_THEATRE = 1;
export const SCREEN_FILL = 2;
export const SCREEN_SOUND = 4;

/** No clip, in a clip's place. */
export const NO_CLIP = 0xffff;

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
}

export const newScreenState = (): ScreenState => ({ manifest: "", show: SHOW_SCENES, flags: SCREEN_THEATRE, clip: NO_CLIP, start: 0, next: NO_CLIP });

/** Every screen's state, in SCREENS order (clip.ts). The manifest is 8 bytes; each screen is 14. */
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
  }
  out.length = count;
}

/** Seconds into its clip a screen is at `tick`, and the served path of the manifest named `id`. */
export const screenSeconds = (s: ScreenState, tick: number, tickRate: number): number => (tick - s.start) / tickRate;
export const manifestPath = (id: string): string => `/media/video.${id}.json`;
