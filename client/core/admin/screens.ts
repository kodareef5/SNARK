// The Screens page's parts that need no browser (client/admin/screens.ts): what /admin/screens/state answers, a picked
// file checked against the caps with the ffmpeg line that brings it under them, and a clip's colour track made from
// small frames, each band averaged in linear light and each second cut into COLOUR_RATE samples.

import { COLOUR_PARTS, SCREENS, STILL_MAX, STILL_MIN, channelType, isImage, isScreenType, type Channel, type Clip, type Screen, type ScreenType } from "../../../shared/video/clip.ts";
import { probeImage, type ImageInfo } from "../../../shared/video/image.ts";
import { heldFor, type Playing, type Timed } from "../../../shared/video/programme.ts";

/** The caps as the state sends them. */
export interface Caps {
  readonly wide: number;
  readonly high: number;
  readonly kbps: number;
  readonly seconds: number;
  readonly bytes: number;
  readonly colourRate: number;
  readonly colourParts: number;
  /** A still's longest side and size, the types it may be, and the seconds a channel holds one: by default, at least and at most. */
  readonly imageLong?: number;
  readonly imageBytes?: number;
  readonly imageTypes?: readonly string[];
  readonly still?: number;
  readonly stillMin?: number;
  readonly stillMax?: number;
}

/** An item as the state lists it: its kind, and every type it is offered on. An image's rates are 0. */
export type StateClip = Omit<Clip, "kind" | "types"> & {
  readonly kind: "clip" | "image";
  readonly types: readonly ScreenType[];
  readonly hidden: boolean;
  readonly kbps: number;
  readonly kBps: number;
};
export type StateScreen = Screen & { readonly playing: Playing | null };

/** An upload that has its file in place and waits for its poster and colour track. */
export interface PendingClip {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly bytes: number;
  readonly at: number;
  readonly kind?: "image";
}

/** GET /admin/screens/state (server/video/routes.ts). */
export interface ScreensState {
  readonly revision: number;
  readonly now: number;
  readonly night: boolean;
  /** The world that answered, as its players see the ball (server/video/routes.ts ScreenWorld). */
  readonly world: { readonly night: boolean; readonly seconds: number; readonly hour: number; readonly only: number; readonly gain: number };
  readonly manifest: { readonly id: string; readonly path: string };
  readonly caps: Caps;
  readonly clips: readonly StateClip[];
  readonly channels: readonly Channel[];
  readonly screens: readonly StateScreen[];
  readonly pending: readonly PendingClip[];
}

/** GET /admin/screens/live: what the page polls between full reads. `manifest` is the manifest's id, `pending` the waiting uploads' ids. */
export interface ScreensLive {
  readonly revision: number;
  readonly now: number;
  readonly night: boolean;
  readonly world: ScreensState["world"];
  readonly manifest: string;
  readonly pending: readonly string[];
  readonly screens: readonly StateScreen[];
}

/**
 * What the page does with a live answer: read the whole state again where the library or its waiting uploads moved on,
 * drop an answer older than what it shows, or run its clocks and screens on from it.
 */
export function liveStep(state: ScreensState, live: ScreensLive): "state" | "drop" | "merge" {
  if (live.revision < state.revision) return "drop";
  const pending = state.pending.map((p) => p.id);
  const same = live.revision === state.revision && live.manifest === state.manifest.id && live.pending.length === pending.length && live.pending.every((id, i) => id === pending[i]);
  return same ? "merge" : "state";
}

/** The state with a live answer's clocks and screens. */
export const withLive = (state: ScreensState, live: ScreensLive): ScreensState => ({ ...state, now: live.now, night: live.night, world: live.world, screens: live.screens });

/** What a screen may play: the items that are not hidden, by id, an image marked so its channel times it. */
export const timedOf = (clips: readonly StateClip[]): Map<string, Timed> =>
  new Map(clips.filter((c) => !c.hidden).map((c) => [c.id, isImage(c) ? { id: c.id, seconds: 0, image: true } : { id: c.id, seconds: c.seconds }]));

/** Seconds as m:ss, or h:mm:ss from an hour. */
export function lengthText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

const megabytes = (bytes: number): string => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

/** What the page knows of a picked file before it is sent: the picture's size and length from a video element, the size from the file. */
export interface Probe {
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly bytes: number;
}

/** The whole file's bit rate in kbit/s, as the server reckons it. */
export const kbpsOf = (p: Probe): number => (p.seconds > 0 ? Math.round((p.bytes * 8) / p.seconds / 1000) : 0);

/** Each way the file is over the caps, one sentence each; none where it fits. */
export function overCaps(p: Probe, caps: Caps): string[] {
  const out: string[] = [];
  const long = Math.max(p.width, p.height), short = Math.min(p.width, p.height);
  if (long <= 0) out.push("The browser found no picture in it.");
  else if (long > caps.wide || short > caps.high) out.push(`It is ${p.width}×${p.height}; the longer side may be ${caps.wide} px and the shorter ${caps.high} px.`);
  if (p.seconds > caps.seconds) out.push(`It runs ${lengthText(p.seconds)}; a clip is ${Math.round(caps.seconds / 60)} min at most.`);
  if (p.bytes > caps.bytes) out.push(`It is ${megabytes(p.bytes)}; a clip is ${megabytes(caps.bytes)} at most.`);
  const kbps = kbpsOf(p);
  if (kbps > caps.kbps) out.push(`It runs at about ${kbps} kbit/s; a clip is ${caps.kbps} kbit/s at most.`);
  return out;
}

/** A shell word in single quotes. */
const quoted = (word: string): string => (/^[\w./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/**
 * The ffmpeg line that makes `name` fit the caps: H.264 main in an MP4 with faststart, scaled into the box on its own
 * orientation, at a rate that also keeps a long clip under the size cap, and cut at the length cap.
 */
export function ffmpegLine(name: string, p: Probe, caps: Caps): string {
  const tall = p.height > p.width;
  const [bw, bh] = tall ? [caps.high, caps.wide] : [caps.wide, caps.high];
  const seconds = Math.min(p.seconds > 0 ? p.seconds : caps.seconds, caps.seconds);
  // A tenth is kept back for the boxes and the encoder's overshoot.
  const total = Math.max(200, Math.min(caps.kbps, Math.floor(((caps.bytes * 8) / 1000 / seconds) * 0.9)));
  const video = Math.floor((total * 0.8) / 50) * 50;
  const stem = name.replace(/\.[^./]*$/, "") || "clip";
  return [
    "ffmpeg", "-i", quoted(name),
    "-vf", `"scale='min(${bw},iw)':'min(${bh},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"`,
    "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-b:v", `${video}k`, "-maxrate", `${total}k`, "-bufsize", `${total * 2}k`,
    "-c:a", "aac", "-b:a", "96k",
    ...(p.seconds > caps.seconds ? ["-t", String(caps.seconds)] : []),
    "-movflags", "+faststart", quoted(`${stem}-small.mp4`),
  ].join(" ");
}

/** A file name without its extension, as a clip's first title. */
export const titleOf = (name: string): string => name.replace(/\.[^./]*$/, "").replace(/[_\s]+/g, " ").trim().slice(0, 80) || "Clip";

/** A picture's size scaled to `long` px on its longer side, never larger than it is. */
export function fitLong(width: number, height: number, long: number): { width: number; height: number } {
  const k = Math.min(1, long / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The largest poster the server takes (server/video/upload.ts). */
export const POSTER_BYTES = 64 * 1024;
/** The poster's long side, and the JPEG qualities tried at each size before it shrinks. */
export const POSTER_LONG = 320;
export const POSTER_QUALITIES: readonly number[] = [0.7, 0.6, 0.5, 0.4];
/** The long side of the frames the colour track is read from. */
export const SAMPLE_LONG = 32;

const TO_LINEAR = Float64Array.from({ length: 256 }, (_, b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export const toLinear = (byte: number): number => TO_LINEAR[byte & 255]!;

/** A linear value from 0 to 1 as an sRGB byte. */
export function toSrgb(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

/**
 * The mean colour of an RGBA frame and of its top, right, bottom and left bands, each about an eighth of it, in
 * linear light, as COLOUR_PARTS × 3 numbers into `out`.
 */
export function bandMeans(rgba: ArrayLike<number>, width: number, height: number, out: Float64Array = new Float64Array(COLOUR_PARTS * 3)): Float64Array {
  const bh = Math.max(1, Math.round(height / 8)), bw = Math.max(1, Math.round(width / 8));
  const sums = new Float64Array(COLOUR_PARTS * 4);
  const add = (part: number, r: number, g: number, b: number): void => {
    sums[part * 4] += r;
    sums[part * 4 + 1] += g;
    sums[part * 4 + 2] += b;
    sums[part * 4 + 3]++;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, r = toLinear(rgba[at]!), g = toLinear(rgba[at + 1]!), b = toLinear(rgba[at + 2]!);
      add(0, r, g, b);
      if (y < bh) add(1, r, g, b);
      if (x >= width - bw) add(2, r, g, b);
      if (y >= height - bh) add(3, r, g, b);
      if (x < bw) add(4, r, g, b);
    }
  }
  for (let p = 0; p < COLOUR_PARTS; p++) for (let c = 0; c < 3; c++) out[p * 3 + c] = sums[p * 4 + 3]! > 0 ? sums[p * 4 + c]! / sums[p * 4 + 3]! : 0;
  return out;
}

/** Frames' band means gathered into samples of 1/`rate` s by their media time, then filled into a whole track. */
export class ColourTrack {
  private readonly sums = new Map<number, Float64Array>();
  private readonly rate: number;
  constructor(rate: number) {
    this.rate = rate;
  }

  /** A frame shown at `mediaTime` seconds, as bandMeans gives it. */
  add(mediaTime: number, linear: ArrayLike<number>): void {
    const at = Math.max(0, Math.floor(mediaTime * this.rate));
    let s = this.sums.get(at);
    if (!s) this.sums.set(at, (s = new Float64Array(COLOUR_PARTS * 3 + 1)));
    for (let i = 0; i < COLOUR_PARTS * 3; i++) s[i] += linear[i]!;
    s[COLOUR_PARTS * 3]++;
  }

  /** The samples that saw a frame. */
  get filled(): number {
    return this.sums.size;
  }

  /** `samples` samples as sRGB bytes: one with no frame is eased between its neighbours in linear light, or copies the nearest at an end. */
  finish(samples: number): Uint8Array {
    const n = COLOUR_PARTS * 3, out = new Uint8Array(samples * n);
    const known: number[] = [], means: Float64Array[] = [];
    for (const at of [...this.sums.keys()].sort((a, b) => a - b)) {
      if (at >= samples) break;
      const s = this.sums.get(at)!;
      known.push(at);
      means.push(Float64Array.from({ length: n }, (_, i) => s[i]! / s[n]!));
    }
    if (known.length === 0) return out;
    let k = 0;
    for (let i = 0; i < samples; i++) {
      while (k + 1 < known.length && known[k + 1]! <= i) k++;
      const a = known[k]!, b = known[Math.min(k + 1, known.length - 1)]!;
      const t = i <= a || b === a ? 0 : Math.min(1, (i - a) / (b - a));
      const ma = means[k]!, mb = means[Math.min(k + 1, means.length - 1)]!;
      for (let c = 0; c < n; c++) out[i * n + c] = toSrgb(ma[c]! + (mb[c]! - ma[c]!) * t);
    }
    return out;
  }
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes as base64 with padding. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0, more = bytes.length - i;
    out += LETTERS[a >> 2]! + LETTERS[((a & 3) << 4) | (b >> 4)]! + (more > 1 ? LETTERS[((b & 15) << 2) | (c >> 6)]! : "=") + (more > 2 ? LETTERS[c & 63]! : "=");
  }
  return out;
}

/** How far into what plays `wall` is: seconds in, its length, and the share from 0 to 1. An image holds for its channel's still, or a once's where there is none. */
export function progressOf(playing: Playing, timed: ReadonlyMap<string, Timed>, wall: number, channel: Channel | null = null): { at: number; of: number; share: number } {
  const item = timed.get(playing.clip), of = item ? heldFor(item, channel) : 0, at = Math.max(0, Math.min(of, (wall - playing.start) / 1000));
  return { at, of, share: of > 0 ? at / of : 0 };
}

/** The channel list as the page edits it: names, items in order, loop or shuffle, a restart asked for, the type it is for and an image's seconds. */
export interface ChannelDraft {
  name: string;
  items: string[];
  shuffle: boolean;
  reset: boolean;
  type: ScreenType;
  /** Seconds each image holds; undefined is the library's default. */
  still?: number;
}

export const draftChannels = (channels: readonly Channel[]): ChannelDraft[] =>
  channels.map((c) => ({ name: c.name, items: [...c.items], shuffle: c.shuffle, reset: false, type: channelType(c), ...(c.still !== undefined ? { still: c.still } : {}) }));

/** The channels op's list from a draft: every type's channels, as the routes take them. */
export const sentChannels = (draft: readonly ChannelDraft[]): Record<string, unknown>[] =>
  draft.map((d) => ({ name: d.name, items: d.items, shuffle: d.shuffle, reset: d.reset, type: d.type, ...(d.still !== undefined ? { still: d.still } : {}) }));

/** Whether a draft says anything the saved channels do not. */
export function draftDiffers(draft: readonly ChannelDraft[], channels: readonly Channel[]): boolean {
  if (draft.length !== channels.length) return true;
  return draft.some((d, i) => {
    const c = channels[i]!;
    return d.reset || d.name !== c.name || d.shuffle !== c.shuffle || d.type !== channelType(c) || d.still !== c.still || d.items.length !== c.items.length || d.items.some((id, j) => id !== c.items[j]);
  });
}

/** Moves `list[at]` by `by` places, kept inside the list. */
export function moveIn<T>(list: T[], at: number, by: number): void {
  const to = Math.max(0, Math.min(list.length - 1, at + by));
  if (to === at || at < 0 || at >= list.length) return;
  const [item] = list.splice(at, 1);
  list.splice(to, 0, item!);
}

/** A name for a new channel that no channel has. */
export function freeChannelName(draft: readonly ChannelDraft[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? "New channel" : `New channel ${n}`;
    if (!draft.some((d) => d.name === name)) return name;
  }
}

/** What is wrong with a draft before it is sent, or "" where nothing is. */
export function draftFault(draft: readonly ChannelDraft[]): string {
  const seen = new Set<string>();
  for (const d of draft) {
    if (!d.name || d.name.length > 40 || d.name.trim() !== d.name) return "A channel's name is 1 to 40 letters, with no space at either end.";
    if (d.name === "scenes") return 'A channel may not be named "scenes".';
    if (seen.has(d.name)) return `Two channels are named ${d.name}.`;
    seen.add(d.name);
    if (d.still !== undefined && !(Number.isFinite(d.still) && d.still >= STILL_MIN && d.still <= STILL_MAX)) return `Channel ${d.name} holds each image ${STILL_MIN} to ${STILL_MAX} seconds.`;
  }
  return "";
}

// ---- The clip table: found by words of its title or rights line, and sorted by a column either way.

export const CLIP_SORTS = ["added", "title", "kind", "length", "size", "rate"] as const;
export type ClipSort = (typeof CLIP_SORTS)[number];

/** The clips whose title or rights line holds every word of `query`, those whose title holds them first; all for a blank one. */
export function findClips<T extends StateClip>(clips: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (!words.length) return [...clips];
  const inTitle = (c: T): boolean => words.every((w) => c.title.toLowerCase().includes(w));
  const found = clips.filter((c) => words.every((w) => c.title.toLowerCase().includes(w) || c.rights.toLowerCase().includes(w)));
  return [...found.filter(inTitle), ...found.filter((c) => !inTitle(c))];
}

/** The clips in an order: as the library added them, by title, length, size or bit rate; `down` turns it round. */
export function sortClips<T extends StateClip>(clips: readonly T[], key: ClipSort, down = false, added: readonly T[] = clips): T[] {
  const at = new Map(added.map((c, i) => [c.id, i] as const));
  const byTitle = (a: T, b: T): number => a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true });
  const order: Record<ClipSort, (a: T, b: T) => number> = {
    added: (a, b) => at.get(a.id)! - at.get(b.id)!,
    title: byTitle,
    kind: (a, b) => a.kind.localeCompare(b.kind) || byTitle(a, b),
    length: (a, b) => a.seconds - b.seconds || byTitle(a, b),
    size: (a, b) => a.bytes - b.bytes || byTitle(a, b),
    rate: (a, b) => a.kbps - b.kbps || byTitle(a, b),
  };
  const sorted = [...clips].sort(order[key]);
  return down ? sorted.reverse() : sorted;
}

// ---- The type tabs: one control room for each type of screen.

/** The tab a page's address opens on (`?type=billboard`): the ball where it names none or no type. */
export function typeOfSearch(search: string): ScreenType {
  const pair = queryPairs(search).find(([k]) => k === "type");
  return pair && isScreenType(pair[1]) ? pair[1] : "orb";
}

/** The address's query with `type` as its tab, keeping what else it says; the ball's is the bare page. */
export function searchOfType(search: string, type: ScreenType): string {
  const kept = queryPairs(search).filter(([k]) => k !== "type").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (type !== "orb") kept.push(`type=${type}`);
  return kept.length ? `?${kept.join("&")}` : "";
}

/** A query's names and values, decoded; a broken escape is kept as it is. */
function queryPairs(search: string): [string, string][] {
  const word = (w: string): string => {
    try {
      return decodeURIComponent(w.replace(/\+/g, " "));
    } catch {
      return w;
    }
  };
  return search.replace(/^\?/, "").split("&").filter((p) => p !== "").map((p) => {
    const at = p.indexOf("=");
    return at < 0 ? [word(p), ""] : [word(p.slice(0, at)), word(p.slice(at + 1))];
  });
}

/** One line on each tab saying what the type is. */
export const TYPE_LINES: Readonly<Record<ScreenType, string>> = {
  orb: "The Sphere on the Las Vegas strip. Every player in the city sees the same picture on it at the same moment.",
  billboard: "Every roadside billboard in the cities shows this channel; each shows its own place in it, so neighbours differ.",
  tv: "Every TV in the world shows this channel, each at its own place in it. A broken TV stays dark.",
  laptop: "Every laptop, and the tek workstation's screen, shows this channel, each at its own place in it.",
};

/** A type's name in a sentence: "the Vegas ball", "billboards". */
export const typeWords = (type: ScreenType): string => TYPE_WORDS[type];
const TYPE_WORDS: Readonly<Record<ScreenType, string>> = { orb: "the Vegas ball", billboard: "billboards", tv: "TVs", laptop: "laptops" };

/** The types an item is offered on with `type` ticked or not, in SCREENS order, or why not: an item is offered somewhere. */
export function withType(types: readonly ScreenType[], type: ScreenType, on: boolean): ScreenType[] | string {
  const next = SCREENS.filter((s) => (s === type ? on : types.includes(s)));
  return next.length ? next : "An item is offered on one type of screen at least. Delete or hide it instead.";
}

/** The channels of `type` that list `id`, by name: those an item leaves when it is no longer offered there. */
export const channelsLeft = (channels: readonly Channel[], id: string, type: ScreenType): string[] =>
  channels.filter((c) => channelType(c) === type && c.items.includes(id)).map((c) => c.name);

// ---- Still images: checked in the browser before they are sent, and their poster and one colour sample.

const IMAGE_MIME: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

/**
 * What `bytes` (a file called `name` the browser says is `mime`) are as a still for the caps the state sends, or each
 * sentence saying why it may not be one. The header says the type and size; the file's own word for its type is only a
 * first guess.
 */
export function checkImage(name: string, mime: string, bytes: Uint8Array, caps: Caps): ImageInfo | string[] {
  const long = caps.imageLong ?? 1280, most = caps.imageBytes ?? 1048576, types = caps.imageTypes ?? ["png", "jpeg", "webp"];
  const out: string[] = [];
  if (mime && !IMAGE_MIME[mime]) out.push(`${name} is ${mime}; a still is a PNG, JPEG or WebP.`);
  if (bytes.length > most) out.push(`${name} is ${megabytes(bytes.length)}; a still is ${megabytes(most)} at most.`);
  if (out.length) return out;
  const info = probeImage(bytes);
  if (typeof info === "string") return [`${name}: ${info}`];
  if (!types.includes(info.type)) return [`${name} is a ${info.type}; a still is a ${types.join(", ")}.`];
  if (Math.max(info.width, info.height) > long) return [`${name} is ${info.width}×${info.height}; a still's longer side may be ${long} px.`];
  return info;
}

/** A still's one-sample colour track: the mean of a small RGBA copy and its four edge bands, as sRGB bytes. */
export function stillColours(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const track = new ColourTrack(1);
  track.add(0, bandMeans(rgba, width, height));
  return track.finish(1);
}

/** The words a batch of stills shows as it goes. */
export function batchWords(done: number, failed: number, total: number): string {
  if (done + failed < total) return `Sending ${done + failed + 1} of ${total}…`;
  return failed ? `${done} of ${total} are in the library; ${failed} could not be added.` : `All ${total} are in the library.`;
}

/**
 * Puts `ids` at the end of the draft's channel `name` for `type`, making it where there is none, each id once; or says
 * why not. A new channel holds each image `still` seconds.
 */
export function addToChannel(draft: ChannelDraft[], name: string, ids: readonly string[], type: ScreenType, still?: number): string {
  let d = draft.find((c) => c.name === name);
  if (d && d.type !== type) return `The channel ${name} is for ${typeWords(d.type)}.`;
  if (!d) draft.push((d = { name, items: [], shuffle: false, reset: false, type, ...(still !== undefined ? { still } : {}) }));
  for (const id of ids) if (!d.items.includes(id)) d.items.push(id);
  return draftFault(draft);
}
