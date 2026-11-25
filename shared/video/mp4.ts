// An ISO-BMFF reader for what a screen's clip must be: H.264 video, AAC audio or none, within the caps, and laid out to
// play while it downloads (moov before mdat). It reads boxes only; nothing is decoded.
import { CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE } from "./clip.ts";

/** What a clip's boxes say of it. `kbps` counts the whole file. */
export interface Mp4Info {
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly kbps: number;
  readonly audio: boolean;
  /** The moov box comes before the media, so a browser can start before the end arrives. */
  readonly faststart: boolean;
}

/** One box: its type, where it starts, where its contents start, and where it ends. */
interface Box {
  readonly type: string;
  readonly start: number;
  readonly body: number;
  readonly end: number;
}

const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** The boxes between `from` and `to`, or null where one runs past the end. */
function boxes(b: Uint8Array, from: number, to: number): Box[] | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Box[] = [];
  for (let at = from; at < to; ) {
    if (to - at < 8) return null;
    let size = v.getUint32(at), body = at + 8;
    if (size === 1) {
      if (to - at < 16) return null;
      size = v.getUint32(at + 8) * 2 ** 32 + v.getUint32(at + 12);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return null;
    out.push({ type: fourcc(b, at + 4), start: at, body, end: at + size });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, box: Box, type: string): Box | null => boxes(b, box.body, box.end)?.find((x) => x.type === type) ?? null;
const children = (b: Uint8Array, box: Box, type: string): Box[] => (boxes(b, box.body, box.end) ?? []).filter((x) => x.type === type);

/** The box at the end of `path` under `box`, the first of each name. */
function find(b: Uint8Array, box: Box, ...path: string[]): Box | null {
  let at: Box | null = box;
  for (const name of path) if (!(at = at && child(b, at, name))) return null;
  return at;
}

/** A timescale and duration from an mvhd or mdhd box, version 0 or 1. */
function timed(b: Uint8Array, box: Box | null): number {
  if (!box || box.end - box.body < 24) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), version = b[box.body]!;
  if (version === 1) {
    if (box.end - box.body < 32) return 0;
    const scale = v.getUint32(box.body + 20), duration = v.getUint32(box.body + 24) * 2 ** 32 + v.getUint32(box.body + 28);
    return scale > 0 ? duration / scale : 0;
  }
  const scale = v.getUint32(box.body + 12), duration = v.getUint32(box.body + 16);
  return scale > 0 && duration !== 0xffffffff ? duration / scale : 0;
}

/** A track's handler ("vide", "soun"), its first sample entry's type, and the picture's size from that entry or tkhd. */
function track(b: Uint8Array, trak: Box): { handler: string; codec: string; width: number; height: number; seconds: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const mdia = child(b, trak, "mdia"), hdlr = mdia && child(b, mdia, "hdlr");
  const handler = hdlr && hdlr.end - hdlr.body >= 12 ? fourcc(b, hdlr.body + 8) : "";
  const stsd = find(b, trak, "mdia", "minf", "stbl", "stsd");
  // stsd is a full box with an entry count, then the entries.
  const entry = stsd && stsd.end - stsd.body >= 8 ? boxes(b, stsd.body + 8, stsd.end)?.[0] ?? null : null;
  const codec = entry ? entry.type : "";
  let width = 0, height = 0;
  // A visual sample entry: 6 reserved, a data reference, 16 bytes predefined, then width and height.
  if (entry && handler === "vide" && entry.end - entry.body >= 28) [width, height] = [v.getUint16(entry.body + 24), v.getUint16(entry.body + 26)];
  const tkhd = child(b, trak, "tkhd");
  if ((width === 0 || height === 0) && tkhd && tkhd.end - tkhd.body >= 84) {
    const end = b[tkhd.body] === 1 ? tkhd.body + 92 : tkhd.body + 84;
    if (end <= tkhd.end) [width, height] = [v.getUint32(end - 8) >>> 16, v.getUint32(end - 4) >>> 16];
  }
  return { handler, codec, width, height, seconds: mdia ? timed(b, child(b, mdia, "mdhd")) : 0 };
}

/** What a clip is, or why it may not be shown. */
export function probeMp4(bytes: Uint8Array): Mp4Info | string {
  const top = boxes(bytes, 0, bytes.length);
  if (!top || !top.some((x) => x.type === "ftyp")) return "This is not an MP4 file.";
  if (top.some((x) => x.type === "moof")) return "This MP4 is fragmented. Write it again whole: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4";
  const moov = top.find((x) => x.type === "moov"), mdat = top.findIndex((x) => x.type === "mdat");
  if (!moov) return "This MP4 has no moov box: it was cut short.";
  const tracks = children(bytes, moov, "trak").map((t) => track(bytes, t));
  const video = tracks.find((t) => t.handler === "vide");
  if (!video) return "This MP4 has no video track.";
  if (video.codec !== "avc1" && video.codec !== "avc3") return `The video is ${video.codec || "of no known kind"}, not H.264.`;
  const sound = tracks.find((t) => t.handler === "soun");
  if (sound && sound.codec !== "mp4a") return `The audio is ${sound.codec || "of no known kind"}, not AAC.`;
  const seconds = timed(bytes, child(bytes, moov, "mvhd")) || video.seconds;
  if (!(seconds > 0)) return "This MP4 does not say how long it is.";
  const kbps = Math.round((bytes.length * 8) / seconds / 1000);
  const wide = Math.max(video.width, video.height), high = Math.min(video.width, video.height);
  if (high === 0) return "The video track does not say its size.";
  if (wide > CLIP_MAX_WIDE || high > CLIP_MAX_HIGH) return `The picture is ${video.width}×${video.height}, over ${CLIP_MAX_WIDE}×${CLIP_MAX_HIGH}.`;
  if (seconds > CLIP_MAX_SECONDS) return `The clip is ${Math.round(seconds)} s long, over ${CLIP_MAX_SECONDS / 60} min.`;
  if (bytes.length > CLIP_MAX_BYTES) return `The clip is ${Math.round(bytes.length / 1048576)} MB, over ${CLIP_MAX_BYTES / 1048576} MB.`;
  if (kbps > CLIP_MAX_KBPS) return `The clip runs at ${kbps} kbit/s, over ${CLIP_MAX_KBPS}.`;
  const faststart = mdat < 0 || top.indexOf(moov) < mdat;
  return { width: video.width, height: video.height, seconds, kbps, audio: !!sound, faststart };
}

const OUTSIDE = "A chunk offset points outside the file.";

/** Every chunk offset table in a moov box. */
function offsetTables(b: Uint8Array, moov: Box): Box[] {
  const out: Box[] = [];
  for (const trak of children(b, moov, "trak")) {
    const stbl = find(b, trak, "mdia", "minf", "stbl");
    if (stbl) out.push(...children(b, stbl, "stco"), ...children(b, stbl, "co64"));
  }
  return out;
}

/**
 * The file in pieces with its moov box before its media, the chunk offsets moved to match; the pieces as they were where
 * it is already so. Writing the pieces in order writes the file. A string says why it cannot be done.
 */
export function faststartParts(bytes: Uint8Array): Uint8Array[] | string {
  const top = boxes(bytes, 0, bytes.length);
  if (!top) return "This is not an MP4 file.";
  const at = top.findIndex((x) => x.type === "moov"), first = top.findIndex((x) => x.type === "mdat");
  if (at < 0) return "This MP4 has no moov box: it was cut short.";
  if (first < 0 || at < first) return [bytes];
  const moovBox = top[at]!, order = [...top.slice(0, first), moovBox, ...top.slice(first).filter((x) => x !== moovBox)];
  // Where each top-level box starts after the move, so an offset into it moves with it.
  const moved = new Map<Box, number>();
  let pos = 0;
  for (const x of order) {
    moved.set(x, pos);
    pos += x.end - x.start;
  }
  const shift = (offset: number): number => {
    const box = top.find((x) => offset >= x.start && offset < x.end);
    return box ? offset - box.start + moved.get(box)! : -1;
  };
  const moov = bytes.slice(moovBox.start, moovBox.end), local: Box = { type: "moov", start: 0, body: moovBox.body - moovBox.start, end: moov.length };
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength), tables = offsetTables(moov, local);
  if (tables.length === 0) return "This MP4 has no chunk offsets to move.";
  for (const t of tables) {
    const count = t.end - t.body >= 8 ? v.getUint32(t.body + 4) : 0, wide = t.type === "co64";
    if (t.body + 8 + count * (wide ? 8 : 4) > t.end) return "A chunk offset table runs past its box.";
    for (let i = 0; i < count; i++) {
      const p = t.body + 8 + i * (wide ? 8 : 4);
      if (wide) {
        const now = shift(v.getUint32(p) * 2 ** 32 + v.getUint32(p + 4));
        if (now < 0) return OUTSIDE;
        v.setUint32(p, Math.floor(now / 2 ** 32));
        v.setUint32(p + 4, now >>> 0);
      } else {
        const now = shift(v.getUint32(p));
        if (now < 0) return OUTSIDE;
        if (now > 0xffffffff) return "The chunk offsets would pass 4 GB once moved. Write it again: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4";
        v.setUint32(p, now);
      }
    }
  }
  return order.map((x) => (x === moovBox ? moov : bytes.subarray(x.start, x.end)));
}

/** The file with its moov box before its media; the same bytes where it is already so. A string says why it cannot be done. */
export function faststart(bytes: Uint8Array): Uint8Array | string {
  const parts = faststartParts(bytes);
  if (typeof parts === "string") return parts;
  if (parts.length === 1 && parts[0] === bytes) return bytes;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every chunk's offset in the file, track by track, as the moov box lists them. */
export function chunkOffsets(bytes: Uint8Array): number[] {
  const moov = boxes(bytes, 0, bytes.length)?.find((x) => x.type === "moov");
  if (!moov) return [];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out: number[] = [];
  for (const t of offsetTables(bytes, moov)) {
    const count = v.getUint32(t.body + 4), wide = t.type === "co64";
    for (let i = 0; i < count; i++) {
      const p = t.body + 8 + i * (wide ? 8 : 4);
      out.push(wide ? v.getUint32(p) * 2 ** 32 + v.getUint32(p + 4) : v.getUint32(p));
    }
  }
  return out;
}
