// How a build stores the parts a client fetches a range at a time, and how the client gets them back.
//
// The manifest gives each part its size as its counts give it, `bytes`, and a hash of those bytes. A part stored in
// fewer bytes says how many with `stored`, and is then a raw deflate stream (RFC 1951) of a filter, the filter's
// numbers, and the part's bytes filtered. Every filter keeps the size, and is undone by a pass or two over the bytes:
//
//   0  none
//   1  level     u32 indices, u8 bytes an index. Each index is the next new vertex less it, zigzagged, the bytes of
//                the indices in planes: every first byte, then every second. The padding after them is as it was.
//                Then each vertex's x, y and z are the change from the vertex before, zigzagged, its 8 bytes in planes
//   2  surface   u and v the change from the entry before, zigzagged, and the 12 bytes of an entry in planes
//   3  planes    u8 n: records of n bytes, in planes
//   4  pixels    u8 channels, u8 pictures, u8 log2 of the first picture's side, u8 1 for planes. Square pictures, each
//                twice the side of the one before. Each byte is less PNG's Paeth prediction from the bytes left of it,
//                above it and above left in its channel; with planes, each picture is first cut into a plane a channel
//
// A ranged file as a build serves it starts with a header of its own and holds its parts one after another, where the
// manifest says. A client hashes a part once it has its bytes back, so one hash checks the network, the cache, the
// inflater and the undoing of the filter, and it does not change with how a build chose to store the part.

export const FILTER_NONE = 0;
export const FILTER_LEVEL = 1;
export const FILTER_SURFACE = 2;
export const FILTER_PLANES = 3;
export const FILTER_PIXELS = 4;

/** A mesh file of stored parts starts "SNPT", a u16 version and a u16 left 0. */
export const PARTS_MAGIC = 0x54504e53;
export const PARTS_VERSION = 1;
export const PARTS_HEADER_BYTES = 8;
/** A texture file of stored parts keeps its header, with this version. */
export const STORED_TEXTURE_VERSION = 2;

const pad4 = (n: number): number => (n + 3) & ~3;
const zig = (d: number): number => ((d << 1) ^ (d >> 31)) >>> 0;
const unzig = (z: number): number => (z >>> 1) ^ -(z & 1);

/** Moves records of `n` bytes into planes: every record's first byte, then every second, and so on. */
export function toPlanes(data: Uint8Array, n: number, out: Uint8Array = new Uint8Array(data.length)): Uint8Array {
  const count = data.length / n;
  for (let b = 0; b < n; b++) for (let i = 0, at = b * count; i < count; i++) out[at + i] = data[i * n + b]!;
  return out;
}

export function fromPlanes(data: Uint8Array, n: number, out: Uint8Array = new Uint8Array(data.length)): Uint8Array {
  const count = data.length / n;
  for (let b = 0; b < n; b++) for (let i = 0, at = b * count; i < count; i++) out[i * n + b] = data[at + i]!;
  return out;
}

/** Indices as the next new vertex less each, zigzagged, wrapping at the width of an index. */
function codeIndices(data: Uint8Array, count: number, bytes: number): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, count * bytes);
  const out = new Uint8Array(count * bytes);
  const coded = new DataView(out.buffer);
  let next = 0;
  for (let k = 0; k < count; k++) {
    const index = bytes === 4 ? view.getUint32(k * 4, true) : view.getUint16(k * 2, true);
    if (bytes === 4) coded.setUint32(k * 4, zig((next - index) | 0), true);
    else coded.setUint16(k * 2, zig(((next - index) << 16) >> 16), true);
    if (index >= next) next = index + 1;
  }
  return out;
}

function decodeIndices(data: Uint8Array, count: number, bytes: number, out: Uint8Array): void {
  const view = new DataView(data.buffer, data.byteOffset, count * bytes);
  const plain = new DataView(out.buffer, out.byteOffset, count * bytes);
  let next = 0;
  for (let k = 0; k < count; k++) {
    let index: number;
    if (bytes === 4) {
      index = (next - unzig(view.getUint32(k * 4, true))) >>> 0;
      plain.setUint32(k * 4, index, true);
    } else {
      index = (next - unzig(view.getUint16(k * 2, true))) & 0xffff;
      plain.setUint16(k * 2, index, true);
    }
    if (index >= next) next = index + 1;
  }
}

/** The 16-bit values at `at` in records of `n` bytes as the change from the record before, zigzagged; and back. */
function delta16(data: Uint8Array, n: number, at: readonly number[], undo: boolean): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = data.length / n;
  for (const a of at) {
    let prev = 0;
    for (let i = 0; i < count; i++) {
      const v = view.getUint16(i * n + a, true);
      const x = undo ? (prev + unzig(v)) & 0xffff : v;
      view.setUint16(i * n + a, undo ? x : zig(((x - prev) << 16) >> 16), true);
      prev = x;
    }
  }
}

/**
 * A square picture `side` across of `channels` bytes a pixel, each byte less PNG's Paeth prediction from its left,
 * upper and upper left neighbours, those off the picture taken as 0; and back. Undoing reads the bytes it has just
 * made, so filtering reads a copy of the picture as it was.
 */
function paeth(pic: Uint8Array, side: number, channels: number, undo: boolean): void {
  const row = side * channels;
  const was = undo ? pic : pic.slice();
  const put = (i: number, guess: number): void => void (pic[i] = undo ? (pic[i]! + guess) & 255 : (pic[i]! - guess) & 255);
  for (let i = channels; i < row; i++) put(i, was[i - channels]!);
  for (let r = row; r < pic.length; r += row) {
    for (let i = r; i < r + channels; i++) put(i, was[i - row]!);
    for (let i = r + channels; i < r + row; i++) {
      const a = was[i - channels]!;
      const b = was[i - row]!;
      const c = was[i - row - channels]!;
      const pa = b > c ? b - c : c - b;
      const pb = a > c ? a - c : c - a;
      const pc = a + b > 2 * c ? a + b - 2 * c : 2 * c - a - b;
      const guess = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      pic[i] = undo ? (pic[i]! + guess) & 255 : (pic[i]! - guess) & 255;
    }
  }
}

/** Every picture of a step predicted, as it is or a plane a channel at a time; and back. */
function pixels(data: Uint8Array, channels: number, pictures: number, first: number, planar: boolean, undo: boolean): void {
  for (let p = 0, side = first, at = 0; p < pictures; p++, side *= 2) {
    const pic = data.subarray(at, (at += side * side * channels));
    if (!planar) {
      paeth(pic, side, channels, undo);
      continue;
    }
    const planes = undo ? pic.slice() : toPlanes(pic, channels);
    for (let c = 0; c < channels; c++) paeth(planes.subarray(c * side * side, (c + 1) * side * side), side, 1, undo);
    if (undo) fromPlanes(planes, channels, pic);
    else pic.set(planes);
  }
}

/** Bytes of a step of pictures, each twice the side of the one before. */
function pictureBytes(channels: number, pictures: number, first: number): number {
  let bytes = 0;
  for (let p = 0, side = first; p < pictures; p++, side *= 2) bytes += side * side * channels;
  return bytes;
}

/** The filter, its numbers and the part's bytes filtered: what a build deflates. */
export function filterPart(data: Uint8Array, filter: number, numbers: readonly number[] = []): Uint8Array {
  const head = filter === FILTER_LEVEL ? 6 : filter === FILTER_PLANES ? 2 : filter === FILTER_PIXELS ? 5 : 1;
  const out = new Uint8Array(head + data.length);
  out[0] = filter;
  const body = out.subarray(head);
  if (filter === FILTER_LEVEL) {
    const [count, bytes] = numbers as [number, number];
    new DataView(out.buffer).setUint32(1, count, true);
    out[5] = bytes;
    const ix = pad4(count * bytes);
    toPlanes(codeIndices(data, count, bytes), bytes, body);
    body.set(data.subarray(count * bytes, ix), count * bytes);
    const verts = data.slice(ix);
    delta16(verts, 8, [0, 2, 4], false);
    toPlanes(verts, 8, body.subarray(ix));
  } else if (filter === FILTER_SURFACE) {
    const entries = data.slice();
    delta16(entries, 12, [0, 2], false);
    toPlanes(entries, 12, body);
  } else if (filter === FILTER_PLANES) {
    out[1] = numbers[0]!;
    toPlanes(data, numbers[0]!, body);
  } else if (filter === FILTER_PIXELS) {
    const [channels, pictures, log2, planar] = numbers as [number, number, number, number];
    out.set([channels, pictures, log2, planar], 1);
    body.set(data);
    pixels(body, channels, pictures, 1 << log2, planar === 1, false);
  } else body.set(data);
  return out;
}

/**
 * A part's bytes from what its stream inflated to, the filter undone, written into `out`, which must be `bytes` long.
 * Null if the stream names no filter this build knows or does not come to `bytes`.
 */
export function unfilterPart(inflated: Uint8Array, bytes: number, out: Uint8Array = new Uint8Array(bytes)): Uint8Array | null {
  const filter = inflated[0];
  const head = filter === FILTER_LEVEL ? 6 : filter === FILTER_PLANES ? 2 : filter === FILTER_PIXELS ? 5 : 1;
  const body = inflated.subarray(head);
  if (filter === undefined || filter > FILTER_PIXELS || body.length !== bytes) return null;
  if (filter === FILTER_LEVEL) {
    const count = new DataView(inflated.buffer, inflated.byteOffset).getUint32(1, true);
    const size = inflated[5]!;
    const ix = pad4(count * size);
    if ((size !== 2 && size !== 4) || ix > bytes || (bytes - ix) % 8 !== 0) return null;
    // Each index is read before it is written, so the planes are decoded where they land.
    decodeIndices(fromPlanes(body.subarray(0, count * size), size, out.subarray(0, count * size)), count, size, out);
    out.set(body.subarray(count * size, ix), count * size);
    delta16(fromPlanes(body.subarray(ix), 8, out.subarray(ix)), 8, [0, 2, 4], true);
    return out;
  }
  if (filter === FILTER_SURFACE) {
    if (bytes % 12 !== 0) return null;
    delta16(fromPlanes(body, 12, out), 12, [0, 2], true);
    return out;
  }
  if (filter === FILTER_PLANES) {
    const n = inflated[1]!;
    return n > 0 && bytes % n === 0 ? fromPlanes(body, n, out) : null;
  }
  if (filter === FILTER_PIXELS) {
    const [channels, pictures, log2, planar] = [inflated[1]!, inflated[2]!, inflated[3]!, inflated[4]!];
    if (channels === 0 || log2 > 12 || pictureBytes(channels, pictures, 1 << log2) !== bytes) return null;
    out.set(body);
    pixels(out, channels, pictures, 1 << log2, planar === 1, true);
    return out;
  }
  out.set(body);
  return out;
}
