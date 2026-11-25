// What each screen on a prop shows (render/screens.ts finds them): its type's state from OWN_SCREEN, worked out for each
// screen at its own place in its channel, and the pictures it needs. Pictures are layers of one array on the card, the
// least lately used given up first. Images and clips' posters are fetched and decoded in the page (FaceHost); at most
// two clips play at once, for the nearest screens that show one, and the rest show their posters. Nothing is fetched
// until a screen is in reach. Every rule is here; the page's elements are behind FaceHost (client/shell/screen-faces.ts).

import { TICK_RATE } from "../../../shared/coords.ts";
import { COLOUR_PARTS, SCREENS, trackColour, type Channel, type Clip } from "../../../shared/video/clip.ts";
import { faceAspect, type ScreenFace } from "../../../shared/video/face.ts";
import { channelAtOffset, heldFor, roundMs, type Timed } from "../../../shared/video/programme.ts";
import { NO_CHANNEL, NO_CLIP, SCREEN_ONCE, manifestPath, type ScreenState } from "../../../shared/video/screen.ts";
import { SCREENS_DECODING, SCREENS_DRAWN, SCREENS_MANY, SCREENS_NEAREST, SCREENS_UPLOADING } from "../governor.ts";
import { FACE_HIGH, FACE_LEVELS, FACE_WIDE, MAX_FACES, MAX_FACE_UPLOADS, type FramePacket } from "../render/packet.ts";
import { faceLevel, fillCrop, type FaceList, type FaceShow } from "../render/screens.ts";
import type { VideoLike } from "./player.ts";
import { DRIFT_SEEK, base64Bytes, mustSeek, syncRate } from "./sync.ts";

/** The page, as the screens on props need it. */
export interface FaceHost {
  json(path: string): Promise<unknown>;
  /** An image from our own server, decoded away from the page's thread at `width` by `height`, whatever its own size. */
  image(path: string, width: number, height: number): Promise<unknown>;
  /** A new element: muted, inline, fetching nothing, hidden in the page. */
  video(): VideoLike;
  /** Whether the page is shown. */
  visible(): boolean;
}

/** Milliseconds a change of picture takes. */
export const WIPE_MS = 1200;
/** Pictures put on the card a frame: one, since a picture and its levels took 0.2 to 0.35 ms of an RTX 4070. */
export const PICTURES_A_FRAME = 1;
/** Pictures fetched at once, and seconds after which one that has not come is given up. */
export const MAX_LOADS = 3;
export const LOAD_GIVES_UP = 15;
/** The most clips played at once for these screens. */
export const MAX_VIDEOS = 2;
/**
 * The level of its picture past which a screen gets no clip: one seen smaller shows its poster. A clip's frame is put in
 * its layer with as few levels as the screen reads, VIDEO_LEVELS at most: each level made is a draw on the card.
 */
export const VIDEO_LOD = 2;
export const VIDEO_LEVELS = 3;
/** Seconds a clip's element stays paused before it lets its stream go. */
export const UNLOAD_AFTER = 10;
/** Seconds with no screen drawn after which the pictures' array is let go. */
export const IDLE_AFTER = 30;
/** HAVE_CURRENT_DATA: the element has a frame to show. */
const HAVE_FRAME = 2;

/** An item of the library as the faces need it. */
export interface FaceItem {
  readonly id: string;
  readonly file: string;
  readonly poster: string;
  readonly aspect: number;
  readonly seconds: number;
  readonly image: boolean;
  readonly track: Uint8Array;
}

/** The manifest as the faces read it: its items by their number, the channels, and each channel's round in ms. */
export interface FaceLibrary {
  readonly items: readonly (FaceItem | null)[];
  readonly channels: readonly Channel[];
  readonly timed: ReadonlyMap<string, Timed>;
  readonly index: ReadonlyMap<string, number>;
  readonly rounds: readonly number[];
}

/** The library of a manifest, or null where it is not one. An item that cannot be shown keeps its number as null. */
export function readLibrary(json: unknown): FaceLibrary | null {
  const m = json as { clips?: unknown; channels?: unknown } | null;
  if (!m || !Array.isArray(m.clips)) return null;
  const timed = new Map<string, Timed>(), index = new Map<string, number>();
  const items = m.clips.map((c: Partial<Clip> | null, i: number): FaceItem | null => {
    const image = c?.kind === "image";
    if (!c || typeof c.id !== "string" || typeof c.poster !== "string" || typeof c.file !== "string" || !(Number(c.width) > 0) || !(Number(c.height) > 0) || (!image && !(Number(c.seconds) > 0))) return null;
    timed.set(c.id, { id: c.id, seconds: image ? 0 : Number(c.seconds), image });
    index.set(c.id, i);
    return { id: c.id, file: c.file, poster: c.poster, aspect: Number(c.width) / Number(c.height), seconds: image ? 0 : Number(c.seconds), image, track: base64Bytes(typeof c.colours === "string" ? c.colours : "") };
  });
  const channels = Array.isArray(m.channels) ? (m.channels as Channel[]).filter((c) => c && typeof c.name === "string" && Array.isArray(c.items) && Number.isFinite(c.epoch)) : [];
  return { items, channels, timed, index, rounds: channels.map((c) => roundMs(c, timed)) };
}

/** A share from 0 to 1 a screen's ref hashes to, the same on every client: how far ahead in its channel it is. */
export function refShare(ref: number): number {
  let h = Math.imul((ref >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The wall time (ms) a type's channel is at on the world's `tick`, from its epoch as a wall time and as a tick. */
export const channelWall = (channelEpoch: number, epochTick: number, tick: number): number => channelEpoch + ((tick - epochTick) / TICK_RATE) * 1000;

/** What one screen shows, kept while its type's state and its item hold. */
interface Showing {
  key: number;
  item: number;
  /** When its item began on it and when it ends: wall ms in a channel, ticks while every screen plays one item. */
  from: number;
  until: number;
  before: number;
  changed: number;
  seen: number;
}

/** What a screen shows: its item's number in the library or -1 for none, the seconds into it, and the one before. */
export interface Shown {
  item: number;
  seconds: number;
  before: number;
  wipe: number;
}

/**
 * What every screen of each type shows, by its ref: each type's state worked out once a change, each screen's item
 * once an item. A screen first seen shows its item at once; one whose item changes wipes from the one before.
 */
export class Programme {
  private readonly shows = new Map<number, Showing>();
  private readonly keys = new Float64Array(SCREENS.length);
  private readonly was: ScreenState[] = [];
  private library: FaceLibrary | null = null;
  private frame = 0;

  /** At the start of a frame: each type's state, a new key for each that has changed. */
  begin(states: readonly ScreenState[], library: FaceLibrary | null): void {
    this.frame++;
    const fresh = library !== this.library;
    this.library = library;
    for (let i = 0; i < SCREENS.length; i++) {
      const s = states[i], w = (this.was[i] ??= { manifest: "", show: 0, flags: 0, clip: NO_CLIP, start: 0, next: NO_CLIP, scene: -1, channel: NO_CHANNEL, epoch: 0 });
      const once = s ? s.flags & SCREEN_ONCE : 0;
      if (fresh || !s || s.manifest !== w.manifest || once !== (w.flags & SCREEN_ONCE) || s.channel !== w.channel || s.epoch !== w.epoch || (once !== 0 && (s.clip !== w.clip || s.start !== w.start))) {
        this.keys[i]!++;
        if (s) Object.assign(w, s);
        else w.manifest = "";
      }
    }
    // Screens not seen for a while are forgotten.
    if (this.frame % 600 === 0) for (const ref of this.shows.keys()) if (this.frame - this.shows.get(ref)!.seen > 600) this.shows.delete(ref);
  }

  /** What screen `ref` of type `type` (its place in SCREENS) shows on `tick`, `now` ms of the page's clock, into `out`. */
  at(ref: number, type: number, states: readonly ScreenState[], tick: number, now: number, out: Shown): Shown {
    const s = states[type], lib = this.library, key = this.keys[type]!;
    let sh = this.shows.get(ref);
    const first = !sh;
    sh ??= { key: -1, item: -1, from: 0, until: -Infinity, before: -1, changed: -Infinity, seen: 0 };
    sh.seen = this.frame;
    let item = sh.item, from = sh.from, until = sh.until, time = 0;
    const once = !!s && (s.flags & SCREEN_ONCE) !== 0;
    const channel = s && lib && s.channel !== NO_CHANNEL ? (lib.channels[s.channel] ?? null) : null;
    if (!s || !lib || (!once && !channel)) {
      item = -1;
      until = Infinity;
    } else if (once) {
      time = tick;
      if (sh.key !== key) {
        item = s.clip !== NO_CLIP && lib.items[s.clip] ? s.clip : -1;
        from = s.start;
        until = Infinity;
      }
    } else {
      time = channelWall(channel!.epoch, s.epoch, tick);
      if (sh.key !== key || time < from || time >= until) {
        const p = channelAtOffset(channel!, lib.timed, time, refShare(ref) * lib.rounds[s.channel]!);
        const at = p ? (lib.index.get(p.clip) ?? -1) : -1, it = at >= 0 ? lib.items[at] : null;
        item = it ? at : -1;
        from = p ? p.start : time;
        until = p && it ? p.start + heldFor(lib.timed.get(it.id)!, channel) * 1000 : Infinity;
      }
    }
    sh.key = key;
    if (item !== sh.item) {
      sh.before = first ? -1 : sh.item;
      sh.changed = first ? -Infinity : now;
      sh.item = item;
    }
    sh.from = from;
    sh.until = until;
    if (first) this.shows.set(ref, sh);
    out.item = item;
    out.before = sh.before;
    out.wipe = Math.min(1, Math.max(0, (now - sh.changed) / WIPE_MS));
    out.seconds = item < 0 ? 0 : once ? (time - from) / TICK_RATE : (time - from) / 1000;
    return out;
  }
}

/** The layers of the pictures' array: which picture each holds, by its key, and when it was last used. */
export class FaceLayers {
  size = 0;
  readonly keys: string[] = [];
  used = new Float64Array(0);
  /** 0 empty, 1 waiting for its picture, 2 holding it. */
  state = new Uint8Array(0);
  /** Since when a layer has waited, in ms, and the last of its levels that holds its picture. */
  since = new Float64Array(0);
  top = new Uint8Array(0);
  private readonly at = new Map<string, number>();

  /** `n` layers, every one empty. */
  resize(n: number): void {
    this.size = n;
    this.keys.length = 0;
    for (let k = 0; k < n; k++) this.keys.push("");
    this.used = new Float64Array(n).fill(-Infinity);
    this.state = new Uint8Array(n);
    this.since = new Float64Array(n);
    this.top = new Uint8Array(n);
    this.at.clear();
  }

  /** The layer that holds or waits for `key`, marked used on `frame`, or -1. */
  find(key: string, frame: number): number {
    const k = this.at.get(key);
    if (k === undefined) return -1;
    this.used[k] = frame;
    return k;
  }

  /** Whether layer `k` holds its picture. */
  holds(k: number): boolean {
    return k >= 0 && this.state[k] === 2;
  }

  /**
   * A layer for `key`, waiting for its picture: an empty one, else the one least lately used, not on `frame`, and not
   * waiting for a picture since less than LOAD_GIVES_UP before `now`. -1 where every layer is wanted.
   */
  take(key: string, frame: number, now: number): number {
    let best = -1;
    for (let k = 0; k < this.size; k++) {
      if (this.state[k] === 0) {
        best = k;
        break;
      }
      if (this.used[k]! >= frame || (this.state[k] === 1 && now - this.since[k]! < LOAD_GIVES_UP * 1000)) continue;
      if (best < 0 || this.used[k]! < this.used[best]!) best = k;
    }
    if (best < 0) return -1;
    if (this.keys[best]) this.at.delete(this.keys[best]!);
    this.keys[best] = key;
    this.at.set(key, best);
    this.used[best] = frame;
    this.state[best] = 1;
    this.since[best] = now;
    return best;
  }

  /** Layer `k` has its picture, put there this frame, in its levels to `top`. */
  filled(k: number, top: number): void {
    this.state[k] = 2;
    this.top[k] = top;
  }

  /** Layer `k` is let go, its picture having failed. */
  empty(k: number): void {
    if (this.keys[k]) this.at.delete(this.keys[k]!);
    this.keys[k] = "";
    this.state[k] = 0;
    this.used[k] = -Infinity;
  }
}

/** A clip's element: which screen and clip it plays, and what of it the card holds. */
interface Slot {
  readonly el: VideoLike;
  ref: number;
  item: number;
  /** The clip whose frame its layer holds, -1 for none. */
  shown: number;
  fresh: boolean;
  uploadedAt: number;
  uploadedTime: number;
  starting: boolean;
  pausedAt: number;
  loads: number;
  /** Whether it was given a screen this frame. */
  wanted: boolean;
}

/** What the screens on props are told each frame. */
export interface FaceView {
  readonly states: readonly ScreenState[];
  /** The render clock, in world ticks, and the page's clock, in ms. */
  readonly tick: number;
  readonly now: number;
  /** The client's option "Video on screens". */
  readonly option: boolean;
  /** Radians a pixel of the view spans. */
  readonly pixel: number;
  /** The tier's (tiers.ts `screens`): how many are drawn, the layers, the clips played at once and their frames a second. */
  readonly count: number;
  readonly layers: number;
  readonly video: number;
  readonly fps: number;
}

/** The video key of slot `k`: its layer holds that element's frames. */
const videoKey = (k: number): string => `v${k}`;

export class FaceScreens {
  /** What the screens took this frame, as the governor's SCREENS_ bits: what each of its screen steps could take. */
  mask = 0;
  /** Whether a screen is in reach, so that the page's side is wanted. */
  wanted = false;
  readonly layers = new FaceLayers();
  readonly programme = new Programme();
  /** Per face of the list this frame, what it shows. */
  readonly shows: FaceShow[] = [];
  private host: FaceHost | null = null;
  private manifestId = "";
  private library: FaceLibrary | null = null;
  private readonly slots: Slot[] = [];
  private loads = 0;
  private readonly failed = new Set<string>();
  /** Pictures come and waiting for the card: their layer, key and source. */
  private readonly came: { layer: number; key: string; source: unknown }[] = [];
  private frame = 0;
  private lastDrawn = -Infinity;
  private readonly shown: Shown = { item: -1, seconds: 0, before: -1, wipe: 1 };
  /** What each face of the list shows this frame (Shown), by its place. */
  private readonly item = new Int32Array(MAX_FACES);
  private readonly seconds = new Float64Array(MAX_FACES);
  private readonly before = new Int32Array(MAX_FACES);
  private readonly wipe = new Float64Array(MAX_FACES);
  /** The level each face's picture is read at, for those showing a clip. */
  private readonly lod = new Float64Array(MAX_FACES);
  private readonly crop = new Float64Array(4);
  private readonly colour = [0, 0, 0];

  constructor() {
    for (let i = 0; i < MAX_FACES; i++) this.shows.push({ layer: -1, before: -1, wipe: 1, crop: new Float64Array(4), cropBefore: new Float64Array(4), mean: 0, meanBefore: 0, top: 0, topBefore: 0 });
  }

  /** The page's side, once it has come. */
  attach(host: FaceHost | null): void {
    this.host = host;
  }

  /** The library, for a test. */
  get held(): FaceLibrary | null {
    return this.library;
  }

  /**
   * One frame: what each of the first `v.count` faces of `list` shows, into `shows`, the clips played for the nearest,
   * and the pictures for the card put in `p`. `faces` gives each kind's face.
   */
  step(list: FaceList, faces: readonly (ScreenFace | null)[], v: FaceView, p: FramePacket): void {
    this.frame++;
    this.wanted = list.count > 0;
    const host = this.host, drawn = Math.min(list.count, v.count);
    const visible = host ? host.visible() : false;
    this.mask = (list.count > 0 ? SCREENS_DRAWN : 0) | (list.seen > SCREENS_NEAREST ? SCREENS_MANY : 0);
    if (drawn > 0) this.lastDrawn = v.now;
    // The array is let go a while after the last screen was drawn, and made again at the tier's size.
    const layers = v.now - this.lastDrawn < IDLE_AFTER * 1000 ? v.layers : 0;
    if (layers !== this.layers.size) {
      this.layers.resize(layers);
      this.came.length = 0;
      for (const slot of this.slots) slot.shown = -1;
    }
    p.faceLayers = layers;
    let id = this.manifestId;
    if (list.count > 0) {
      id = "";
      for (let i = 1; i < v.states.length && !id; i++) id = v.states[i]?.manifest ?? "";
    }
    if (host && id && id !== this.manifestId) this.fetchManifest(host, id);
    if (!id) this.library = null;
    const lib = this.library;
    this.programme.begin(v.states, lib);
    // The nearest screens showing a clip get the elements, as many as the tier plays.
    const videos = v.option && visible && host ? Math.min(MAX_VIDEOS, v.video) : 0;
    for (const slot of this.slots) slot.wanted = false;
    let given = 0;
    for (let i = 0; i < list.count; i++) {
      const shown = this.programme.at(list.ref[i]!, list.type[i]!, v.states, v.tick, v.now, this.shown);
      this.item[i] = shown.item;
      this.seconds[i] = shown.seconds;
      this.before[i] = shown.before;
      this.wipe[i] = shown.wipe;
      const it = shown.item >= 0 && lib ? lib.items[shown.item] : null;
      if (!it || it.image || this.failed.has(it.file)) continue;
      if (v.option && visible) this.mask |= SCREENS_DECODING | SCREENS_UPLOADING;
      fillCrop(it.aspect, faceAspect(faces[list.kind[i]!]!), this.crop);
      this.lod[i] = faceLevel(faces[list.kind[i]!]!, this.crop, list.distance[i]! * v.pixel);
      if (i < drawn && given < videos && this.lod[i]! <= VIDEO_LOD) {
        given++;
        this.play(list.ref[i]!, shown.item, it, shown.seconds);
      }
    }
    this.rest(v.now, videos === 0);
    // Pictures come since the last frame go to the card, as many as a frame takes.
    p.faceUploads = 0;
    while (this.came.length > 0 && p.faceUploads < PICTURES_A_FRAME) {
      const c = this.came.shift()!;
      if (this.layers.keys[c.layer] !== c.key) continue;
      this.upload(p, c.layer, c.source, false, FACE_WIDE, FACE_HIGH, FACE_LEVELS);
    }
    for (let i = 0; i < drawn; i++) this.show(list, i, faces[list.kind[i]!]!, v, p);
  }

  /** What face `i` shows: its picture's layer, asked for where the card has none, and the one before while it wipes. */
  private show(list: FaceList, i: number, face: ScreenFace, v: FaceView, p: FramePacket): void {
    const out = this.shows[i]!, lib = this.library, aspect = faceAspect(face), item = this.item[i]!, before = this.before[i]!;
    const it = item >= 0 && lib ? lib.items[item] : null;
    out.layer = it ? this.layerOf(list.ref[i]!, item, it, this.lod[i]!, v, p) : -1;
    out.top = out.layer >= 0 ? this.layers.top[out.layer]! : 0;
    out.mean = it ? this.meanOf(it, this.seconds[i]!) : 0;
    fillCrop(it ? it.aspect : 1, aspect, out.crop);
    out.wipe = this.wipe[i]!;
    // The picture before is shown where the card still holds it, and its mean colour where it does not; dark where there was none.
    const was = out.wipe < 1 && before >= 0 && lib ? lib.items[before] : null;
    out.before = was ? this.resident(was.image ? was.file : was.poster) : -1;
    out.topBefore = out.before >= 0 ? this.layers.top[out.before]! : 0;
    out.meanBefore = was ? this.meanOf(was, was.seconds) : 0;
    fillCrop(was ? was.aspect : 1, aspect, out.cropBefore);
  }

  /** The layer item `item` of screen `ref` shows: its clip's frames where an element plays it for it, else its picture. */
  private layerOf(ref: number, item: number, it: FaceItem, lod: number, v: FaceView, p: FramePacket): number {
    if (!it.image) {
      for (let k = 0; k < this.slots.length; k++) {
        const slot = this.slots[k]!;
        if (!slot.wanted || slot.ref !== ref || slot.item !== item) continue;
        const key = videoKey(k);
        let layer = this.layers.find(key, this.frame);
        if (layer < 0) layer = this.layers.take(key, this.frame, v.now);
        if (layer >= 0) this.videoFrame(slot, layer, lod, v, p);
        if (layer >= 0 && slot.shown === item && this.layers.holds(layer)) return layer;
      }
    }
    return this.picture(it.image ? it.file : it.poster, v.now);
  }

  /** Puts slot `slot`'s frame in `layer` where it is new and the frames a second allow. */
  private videoFrame(slot: Slot, layer: number, lod: number, v: FaceView, p: FramePacket): void {
    const el = slot.el;
    if (el.readyState < HAVE_FRAME || el.videoWidth <= 0 || v.fps <= 0 || p.faceUploads >= MAX_FACE_UPLOADS) return;
    const moved = slot.fresh || (!el.requestVideoFrameCallback && el.currentTime !== slot.uploadedTime);
    if (!moved || v.now - slot.uploadedAt < 1000 / v.fps - 2) return;
    this.upload(p, layer, el, true, el.videoWidth, el.videoHeight, Math.min(VIDEO_LEVELS, Math.max(1, 1 + Math.ceil(lod))));
    slot.shown = slot.item;
    slot.fresh = false;
    slot.uploadedAt = v.now;
    slot.uploadedTime = el.currentTime;
  }

  /** The layer holding the picture at `path`, or -1. */
  private resident(path: string): number {
    const k = this.layers.find(`i${path}`, this.frame);
    return this.layers.holds(k) ? k : -1;
  }

  /** The layer holding the picture at `path`, asked for where none does; -1 until it has come. */
  private picture(path: string, now: number): number {
    const key = `i${path}`;
    const k = this.layers.find(key, this.frame);
    if (k >= 0) return this.layers.holds(k) ? k : -1;
    const host = this.host;
    if (!host || this.loads >= MAX_LOADS || this.failed.has(path)) return -1;
    const layer = this.layers.take(key, this.frame, now);
    if (layer < 0) return -1;
    this.loads++;
    host.image(path, FACE_WIDE, FACE_HIGH).then((source) => {
      this.loads--;
      this.came.push({ layer, key, source });
    }, () => {
      this.loads--;
      this.failed.add(path);
      if (this.layers.keys[layer] === key) this.layers.empty(layer);
    });
    return -1;
  }

  private upload(p: FramePacket, layer: number, source: unknown, video: boolean, width: number, height: number, made: number): void {
    const n = p.faceUploads++;
    p.faceMade[n] = made;
    p.faceLayer[n] = layer;
    p.faceSource[n] = source;
    p.faceVideo[n] = video ? 1 : 0;
    p.faceWidth[n] = width;
    p.faceHeight[n] = height;
    this.layers.filled(layer, made - 1);
  }

  /** An item's mean colour at `seconds`, as sRGB bytes in a word. */
  private meanOf(it: FaceItem, seconds: number): number {
    const c = this.colour;
    if (it.track.length < 3 * COLOUR_PARTS) return 0;
    trackColour(it.track, seconds, 0, c);
    return (Math.round(c[0]! * 255) | (Math.round(c[1]! * 255) << 8) | (Math.round(c[2]! * 255) << 16) | (255 << 24)) >>> 0;
  }

  private fetchManifest(host: FaceHost, id: string): void {
    this.manifestId = id;
    this.library = null;
    host.json(manifestPath(id)).then((json) => {
      if (this.manifestId === id) this.library = readLibrary(json);
    }, () => {});
  }

  /** Plays clip `item` for screen `ref`, `seconds` into it, in the slot that has it or one free. */
  private play(ref: number, item: number, it: FaceItem, seconds: number): void {
    let slot = this.slots.find((s) => s.ref === ref && s.item === item);
    if (!slot) {
      slot = this.slots.find((s) => !s.wanted && s.item < 0) ?? this.slots.find((s) => !s.wanted);
      if (!slot && this.slots.length < MAX_VIDEOS && this.host) {
        slot = { el: this.host.video(), ref: -1, item: -1, shown: -1, fresh: false, uploadedAt: -Infinity, uploadedTime: -1, starting: false, pausedAt: -1, loads: 0, wanted: false };
        this.slots.push(slot);
      }
      if (!slot) return;
      this.load(slot, ref, item, it);
    }
    slot.wanted = true;
    slot.pausedAt = -1;
    const el = slot.el;
    if (el.error) {
      this.failed.add(it.file);
      return;
    }
    // Before its start it waits on its first frame; past its end it holds its last.
    if (seconds < 0 || seconds >= it.seconds) {
      if (!el.paused) el.pause();
      const hold = seconds < 0 ? 0 : it.seconds;
      if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - hold) > DRIFT_SEEK) el.currentTime = hold;
      return;
    }
    if (el.readyState >= 1 && !el.seeking) {
      const drift = seconds - el.currentTime;
      if (mustSeek(drift)) {
        if (el.fastSeek) el.fastSeek(seconds);
        else el.currentTime = seconds;
      } else el.playbackRate = syncRate(drift);
    }
    if (el.paused && !slot.starting) {
      slot.starting = true;
      const s = slot;
      el.play().then(() => void (s.starting = false), (e: { name?: string } | null) => {
        s.starting = false;
        if (e?.name !== "AbortError") this.failed.add(it.file);
      });
    }
  }

  private load(slot: Slot, ref: number, item: number, it: FaceItem): void {
    const el = slot.el;
    slot.ref = ref;
    slot.item = item;
    slot.shown = -1;
    slot.fresh = false;
    slot.uploadedAt = -Infinity;
    slot.uploadedTime = -1;
    slot.starting = false;
    el.preload = "auto";
    el.src = it.file;
    const loads = ++slot.loads;
    const frame = (): void => {
      if (slot.loads !== loads) return;
      slot.fresh = true;
      el.requestVideoFrameCallback?.(frame);
    };
    el.requestVideoFrameCallback?.(frame);
  }

  /** Pauses every slot not given a screen, and lets go of a stream paused long, or at once where no clip may play. */
  private rest(now: number, none: boolean): void {
    for (const slot of this.slots) {
      if (slot.wanted) continue;
      if (!slot.el.paused) slot.el.pause();
      if (slot.pausedAt < 0) slot.pausedAt = now;
      if (slot.item >= 0 && (none || now - slot.pausedAt > UNLOAD_AFTER * 1000)) {
        slot.item = slot.ref = -1;
        slot.shown = -1;
        slot.loads++;
        slot.el.preload = "none";
        slot.el.removeAttribute("src");
        slot.el.load();
      }
    }
  }

  /** How many elements hold a stream, for a test and the gates. */
  get decoding(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.item >= 0) n++;
    return n;
  }
}
