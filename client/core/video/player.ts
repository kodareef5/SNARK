// What an orb's screen plays (shared/video/screen.ts), for its screen scene (render/orb.ts). The server says which clip
// plays from which tick; this fetches the manifest, plays the clip in step with the world's clock, and hands the picture
// to the shell, which puts it on UNIT.screen. It holds two video elements at the most: the one playing, and the next
// clip buffered for the last seconds before it starts. It plays only while the ball can be seen large enough, and
// nothing is fetched otherwise. The rules are pure functions here; the page's elements are behind VideoHost
// (client/shell/screen-video.ts). This file comes with the orb's (orb-late.ts), so a map with no orb fetches none of it.

import { TICK_RATE } from "../../../shared/coords.ts";
import type { Clip } from "../../../shared/video/clip.ts";
import { NO_CLIP, SCREEN_FILL, SCREEN_SOUND, SCREEN_THEATRE, SHOW_VIDEO, manifestPath, screenSeconds, type ScreenState } from "../../../shared/video/screen.ts";
import type { OrbSite } from "../../../shared/world/orb.ts";
import { SCREEN_LOD, nearestOrb, screenTexels, topLevel, type OrbScreen } from "../render/orb.ts";
import type { FramePacket } from "../render/packet.ts";
import { distanceGain } from "../sound/place.ts";

/** A video element as the player uses it: HTMLVideoElement has all of this. */
export interface VideoLike {
  src: string;
  preload: string;
  currentTime: number;
  playbackRate: number;
  muted: boolean;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly error: unknown;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  fastSeek?: (seconds: number) => void;
  requestVideoFrameCallback?: (call: () => void) => number;
}

/** A decoded image the shell can upload, and its size. */
export interface Picture {
  readonly source: unknown;
  readonly width: number;
  readonly height: number;
}

/** The page, as the player needs it. */
export interface VideoHost {
  /** A new element: muted, inline, fetching nothing, hidden in the page. */
  video(): VideoLike;
  json(path: string): Promise<unknown>;
  image(path: string): Promise<Picture>;
  /** Whether the page is shown. */
  visible(): boolean;
  /** Whether the viewer has let the page play sound. */
  audible(): boolean;
  /** Plays `v`'s sound from (x, y, z) metres off the ear at `gain`, or silences it. */
  sound(v: VideoLike, on: boolean, x: number, y: number, z: number, gain: number): void;
}

/** Pixels across the ball must span on screen for its clip to play. */
export const MIN_PIXELS = 48;
/** Seconds before a clip's end at which the next one is buffered. */
export const BUFFER_AHEAD = 5;
/** Seconds of drift left alone, and past which the element seeks; between, the rate is nudged by NUDGE. */
export const DRIFT_LEAVE = 0.1;
export const DRIFT_SEEK = 1.5;
export const NUDGE = 0.05;
/** Seconds an element stays paused before it lets its stream go. */
export const UNLOAD_AFTER = 10;
/** Metres from the ball's skin the clip's sound carries. */
export const SOUND_RANGE = 400;
/** HAVE_CURRENT_DATA: the element has a frame to show. */
const HAVE_FRAME = 2;

/** What decides whether a clip plays. */
export interface Watch {
  /** The client's option "Video on screens". */
  readonly option: boolean;
  /** The tier plays video (tiers.ts orb.video). */
  readonly tier: boolean;
  /** There is an orb nearest the eye to show it on. */
  readonly orb: boolean;
  readonly inView: boolean;
  /** Pixels across the ball spans on screen. */
  readonly pixels: number;
  /** The page is shown. */
  readonly visible: boolean;
}

/** Whether a clip plays: everything must allow it. Otherwise it is paused and fetches nothing. */
export const mayPlay = (w: Watch): boolean => w.option && w.tier && w.orb && w.inView && w.pixels >= MIN_PIXELS && w.visible;

/** The playback rate for a clip `drift` seconds behind where it should be (ahead when negative). */
export function syncRate(drift: number): number {
  const a = Math.abs(drift);
  return a < DRIFT_LEAVE || a > DRIFT_SEEK ? 1 : 1 + Math.sign(drift) * NUDGE;
}
/** Whether a clip that far off seeks instead. */
export const mustSeek = (drift: number): boolean => Math.abs(drift) > DRIFT_SEEK;

/** Pixels across a ball of `radius` spans `d` metres off, on a view `fovY` radians high and `height` pixels. */
export function orbPixels(radius: number, d: number, fovY: number, height: number): number {
  return d <= radius ? Infinity : ((2 * Math.asin(radius / d)) / fovY) * height;
}

/** Bytes from base64, as a manifest's colour track is written. */
export function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, count = 0, at = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i), v = c >= 97 ? c - 71 : c >= 65 ? c - 65 : c >= 48 ? c + 4 : c === 43 ? 62 : 63;
    bits = (bits << 6) | v;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[at++] = (bits >> count) & 255;
    }
  }
  return out.subarray(0, at);
}

/** A clip of the manifest with its colour track as bytes. */
export interface Playable {
  readonly clip: Clip;
  readonly track: Uint8Array;
}

/** The manifest's clips that can be played, by their number, or null where it is not a manifest. */
export function readManifest(json: unknown): (Playable | null)[] | null {
  const clips = (json as { clips?: unknown } | null)?.clips;
  if (!Array.isArray(clips)) return null;
  return clips.map((c: Partial<Clip> | null) => {
    if (!c || typeof c.file !== "string" || typeof c.poster !== "string" || !(Number(c.width) > 0) || !(Number(c.height) > 0) || !(Number(c.seconds) > 0)) return null;
    return { clip: c as Clip, track: base64Bytes(typeof c.colours === "string" ? c.colours : "") };
  });
}

/** What the player is told each frame. */
export interface ScreenView {
  readonly state: ScreenState | undefined;
  /** The render clock, in world ticks. */
  readonly tick: number;
  readonly option: boolean;
  readonly tierVideo: boolean;
  readonly sites: readonly OrbSite[] | undefined;
  readonly cam: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number; readonly fovY: number; boxVisible(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean };
  /** The view's height in pixels. */
  readonly height: number;
  /** Milliseconds, for how long an element has been paused. */
  readonly now: number;
}

interface Slot {
  readonly el: VideoLike;
  /** The clip it holds, by its number in the manifest, or -1. */
  clip: number;
  /** A frame has come since the last upload (requestVideoFrameCallback), and the time of the last frame uploaded. */
  fresh: boolean;
  uploaded: number;
  starting: boolean;
  pausedAt: number;
  /** Clips loaded into it so far, so a frame callback of one before stops. */
  loads: number;
}

/** What the texture holds: which clip, from which source, at what size. */
interface Held {
  clip: number;
  source: unknown;
  width: number;
  height: number;
}

export class ScreenPlayer {
  private readonly slots: Slot[] = [];
  private manifestId = "";
  private clips: (Playable | null)[] = [];
  private readonly posters = new Map<string, Picture | null>();
  private readonly failed = new Set<string>();
  /** What the texture should take this frame: a slot playing, a poster, or nothing. */
  private want: { clip: number; slot: Slot | null; picture: Picture | null } | null = null;
  private held: Held = { clip: -1, source: null, width: 0, height: 0 };
  /** Whether the levels under the texture's picture were made from it. */
  private mips = false;
  private sounding = false;
  private readonly out: OrbScreen = { shows: -1, width: 0, height: 0, texWidth: 0, texHeight: 0, levels: 0, theatre: true, fill: false, track: null, seconds: 0, upX: 0, upY: 1, upZ: 0 };

  private readonly host: VideoHost;

  constructor(host: VideoHost) {
    this.host = host;
  }

  /** One frame: what the screen state asks and whether this client may play it. What the orb's lanes take, or null for the scenes alone. */
  step(v: ScreenView): OrbScreen | null {
    const s = v.state, cam = v.cam;
    this.want = null;
    if (!v.option || !s || !s.manifest || !v.sites) {
      this.rest(v.now, -1);
      return this.shown(-1, null, 0, s, cam);
    }
    if (s.manifest !== this.manifestId) this.fetchManifest(s.manifest);
    const at = s.show === SHOW_VIDEO && s.clip !== NO_CLIP ? this.clips[s.clip] : null;
    const playable = at && !this.failed.has(at.clip.id) ? at : null;
    const nearest = nearestOrb(v.sites, cam.x, cam.y, cam.z), site = nearest >= 0 ? v.sites[nearest]! : null;
    let inView = false, pixels = 0;
    if (site) {
      const x = site.x - cam.x, y = site.y + site.centre - cam.y, z = site.z - cam.z, r = site.radius;
      inView = cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r);
      pixels = orbPixels(r, Math.hypot(x, y, z), cam.fovY, v.height);
    }
    const target = s ? screenSeconds(s, v.tick, TICK_RATE) : 0;
    if (!playable) {
      this.rest(v.now, -1);
      return this.shown(-1, null, target, s, cam);
    }
    const may = mayPlay({ option: v.option, tier: v.tierVideo, orb: site !== null, inView, pixels, visible: this.host.visible() });
    this.poster(playable.clip);
    let playing: Slot | null = null, buffering = -1;
    if (may) {
      playing = this.play(s.clip, playable, target, s.next);
      const next = s.next !== NO_CLIP ? this.clips[s.next] : null;
      if (next && !this.failed.has(next.clip.id) && playable.clip.seconds - target < BUFFER_AHEAD && s.next !== s.clip) {
        buffering = s.next;
        this.poster(next.clip);
        this.buffer(s.next, next, playing);
      }
    }
    this.rest(v.now, playing ? s.clip : -1, buffering);
    const poster = this.posters.get(playable.clip.id) ?? null;
    if (playing && playing.el.readyState >= HAVE_FRAME && playing.el.videoWidth > 0) this.want = { clip: s.clip, slot: playing, picture: null };
    else if (poster) this.want = { clip: s.clip, slot: null, picture: poster };
    // The clip's sound, where the screen has it and the viewer has let the page play sound.
    if (playing && site && (s.flags & SCREEN_SOUND) !== 0 && this.host.audible()) {
      const cy = site.y + site.centre, dx = cam.x - site.x, dy = cam.y - cy, dz = cam.z - site.z, d = Math.hypot(dx, dy, dz) || 1;
      const out = site.radius / d, off = Math.abs(d - site.radius);
      this.host.sound(playing.el, true, -dx + dx * out, -dy + dy * out, -dz + dz * out, distanceGain(off, SOUND_RANGE));
      this.sounding = true;
    } else if (this.sounding) {
      for (const slot of this.slots) this.host.sound(slot.el, false, 0, 0, 0, 0);
      this.sounding = false;
    }
    return this.shown(this.held.clip === s.clip ? s.clip : -1, playable, target, s, cam);
  }

  /**
   * After the frame is built: puts the picture in the packet for the shell to upload where it has a new frame and the
   * orb was drawn, and makes its mip levels where a pixel spans more than a texel. `pixel` is the radians a pixel spans.
   */
  upload(p: FramePacket, drawn: boolean, pixel: number): void {
    const want = this.want;
    const need = screenTexels(p.frame, pixel, p.tier.orb.pucks) > 1;
    if (want && drawn) {
      const slot = want.slot, source = slot ? slot.el : want.picture!.source;
      const width = slot ? slot.el.videoWidth : want.picture!.width, height = slot ? slot.el.videoHeight : want.picture!.height;
      const moved = slot ? slot.fresh || (!slot.el.requestVideoFrameCallback && slot.el.currentTime !== slot.uploaded) : false;
      if (source !== this.held.source || width !== this.held.width || height !== this.held.height || moved || (need && !this.mips)) {
        p.screenSource = source;
        p.screenWidth = width;
        p.screenHeight = height;
        p.screenFresh = true;
        p.screenMips = need;
        this.mips = need;
        this.held = { clip: want.clip, source, width, height };
        if (slot) {
          slot.fresh = false;
          slot.uploaded = slot.el.currentTime;
        }
      }
    }
    p.frame[SCREEN_LOD] = this.mips && this.held.width > 0 ? topLevel(this.held.width, this.held.height) : 0;
  }

  /** What the orb's lanes take: the texture's picture and the clip's track at its time, or null where it holds none. */
  private shown(shows: number, playable: Playable | null, seconds: number, s: ScreenState | undefined, cam: ScreenView["cam"]): OrbScreen | null {
    const held = this.held;
    if (held.width <= 0) return null;
    const o = this.out, track = playable && shows >= 0 ? playable : this.clips[held.clip] ?? null;
    o.shows = shows;
    o.width = o.texWidth = held.width;
    o.height = o.texHeight = held.height;
    o.levels = this.mips ? topLevel(held.width, held.height) : 0;
    o.theatre = !s || (s.flags & SCREEN_THEATRE) !== 0;
    o.fill = !!s && (s.flags & SCREEN_FILL) !== 0;
    o.track = track?.track ?? null;
    o.seconds = Math.max(0, Math.min(track?.clip.seconds ?? 0, seconds));
    // The camera's up (camera.ts).
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    o.upX = -sy * sp;
    o.upY = cp;
    o.upZ = -cy * sp;
    return o;
  }

  private fetchManifest(id: string): void {
    this.manifestId = id;
    this.clips = [];
    this.host.json(manifestPath(id)).then((json) => {
      if (this.manifestId === id) this.clips = readManifest(json) ?? [];
    }, () => {});
  }

  /** Decodes a clip's poster once. */
  private poster(clip: Clip): void {
    if (this.posters.has(clip.id)) return;
    // Only the posters of the clip and the next are kept.
    if (this.posters.size >= 3) for (const key of this.posters.keys()) if (this.posters.size >= 3) this.posters.delete(key);
    this.posters.set(clip.id, null);
    this.host.image(clip.poster).then((picture) => {
      if (this.posters.has(clip.id)) this.posters.set(clip.id, picture);
    }, () => {});
  }

  /** The slot holding clip `index`, or one taken for it that does not hold `keep`. */
  private slotFor(index: number, playable: Playable, keep: number): Slot {
    let slot = this.slots.find((s) => s.clip === index);
    if (slot) return slot;
    slot = this.slots.find((s) => s.clip !== keep && s.clip < 0) ?? this.slots.find((s) => s.clip !== keep);
    if (!slot && this.slots.length < 2) {
      const el = this.host.video();
      slot = { el, clip: -1, fresh: false, uploaded: -1, starting: false, pausedAt: -1, loads: 0 };
      this.slots.push(slot);
    }
    slot ??= this.slots[0]!;
    this.load(slot, index, playable);
    return slot;
  }

  private load(slot: Slot, index: number, playable: Playable): void {
    const el = slot.el;
    slot.clip = index;
    slot.fresh = false;
    slot.uploaded = -1;
    slot.starting = false;
    el.preload = "auto";
    el.src = playable.clip.file;
    const loads = ++slot.loads;
    const frame = (): void => {
      if (slot.loads !== loads || slot.clip !== index) return;
      slot.fresh = true;
      el.requestVideoFrameCallback?.(frame);
    };
    el.requestVideoFrameCallback?.(frame);
  }

  /** Plays clip `index` in step with the world's clock, `target` seconds into it. */
  private play(index: number, playable: Playable, target: number, keep: number): Slot | null {
    const slot = this.slotFor(index, playable, keep), el = slot.el, id = playable.clip.id;
    slot.pausedAt = -1;
    if (el.error) {
      this.failed.add(id);
      return null;
    }
    // Before its start it waits on its first frame; past its end it holds its last.
    if (target < 0 || target >= playable.clip.seconds) {
      if (!el.paused) el.pause();
      const hold = target < 0 ? 0 : playable.clip.seconds;
      if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - hold) > DRIFT_SEEK) el.currentTime = hold;
      return slot;
    }
    if (el.readyState >= 1 && !el.seeking) {
      const drift = target - el.currentTime;
      if (mustSeek(drift)) {
        if (el.fastSeek) el.fastSeek(target);
        else el.currentTime = target;
      } else el.playbackRate = syncRate(drift);
    }
    if (el.paused && !slot.starting) {
      slot.starting = true;
      el.play().then(() => void (slot.starting = false), (e: { name?: string } | null) => {
        slot.starting = false;
        if (e?.name !== "AbortError") this.failed.add(id);
      });
    }
    return slot;
  }

  /** Loads clip `index` into the slot that is not playing, at its first frame, paused. */
  private buffer(index: number, playable: Playable, playing: Slot | null): void {
    const slot = this.slotFor(index, playable, playing?.clip ?? -1);
    if (slot === playing) return;
    slot.pausedAt = -1;
    if (!slot.el.paused) slot.el.pause();
  }

  /** Pauses every slot but those holding `playing` and `buffering`, and lets go of the stream of one paused long. */
  private rest(now: number, playing: number, buffering = -1): void {
    for (const slot of this.slots) {
      if (slot.clip >= 0 && (slot.clip === playing || slot.clip === buffering)) continue;
      if (!slot.el.paused) slot.el.pause();
      if (slot.pausedAt < 0) slot.pausedAt = now;
      if (slot.clip >= 0 && now - slot.pausedAt > UNLOAD_AFTER * 1000) {
        slot.clip = -1;
        slot.loads++;
        slot.el.preload = "none";
        slot.el.removeAttribute("src");
        slot.el.load();
      }
    }
  }
}
