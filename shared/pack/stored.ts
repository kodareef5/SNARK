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
//   3  planes    u8 n: records of n bytes, in planes
//   4  pixels    u8 channels, u8 pictures, u8 log2 of the first picture's side, u8 1 for planes. Square pictures, each
//                twice the side of the one before. Each byte is less PNG's Paeth prediction from the bytes left of it,
//                above it and above left in its channel; with planes, each picture is first cut into a plane a channel
//   5  surface   per entry, each as the change from the entry before, zigzagged: u16 u, u16 v; the normal as an
//                octahedral pair, i16 x, y in 1/OCT; the tangent as its angle about the normal from the axis
//                `basis` gives, in 1024ths of a turn; then, not as a change, u16 of its tilt toward the normal in
//                1024ths of a turn, zigzagged, and in the top 4 bits the normal's and the tangent's top 2 bits. The 12
//                bytes of an entry in planes
//
// Filter 5 alone does not give back what it was given: the normal and the tangent come back as near as its pair and
// angles reach, in the same 10-bit fields, and the part is hashed as it comes back. Its decoding uses the four
// operations, square roots and integers alone, so every engine makes the same bytes of it.
//
// A ranged file as a build serves it starts with a header of its own and holds its parts one after another, where the
// manifest says. A client hashes a part once it has its bytes back, so one hash checks the network, the cache, the
// inflater and the undoing of the filter.

import { PI, detAtan2, detCos } from "../math/scalar.ts";

export const FILTER_NONE = 0;
export const FILTER_LEVEL = 1;
export const FILTER_PLANES = 3;
export const FILTER_PIXELS = 4;
export const FILTER_SURFACE = 5;

/** A mesh file of stored parts starts "SNPT", a u16 version and a u16 left 0. */
export const PARTS_MAGIC = 0x54504e53;
export const PARTS_VERSION = 2;
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

/** Steps of an octahedral pair from its centre to an edge: 11 bits, within a step of the 10-bit fields. */
const OCT = 1023;
/** The cosine of 0 to 256 1024ths of a turn, times 32768: detCos is the same on every engine, so the table is. */
const COS = Int32Array.from({ length: 257 }, (_, i) => Math.round(detCos((i * PI) / 512) * 32768));

/** The cosine of `a` 1024ths of a turn, times 32768. */
function cos1024(a: number): number {
  const r = a & 255;
  const q = (a >> 8) & 3;
  return q === 0 ? COS[r]! : q === 1 ? -COS[256 - r]! : q === 2 ? -COS[r]! : COS[256 - r]!;
}

const field10 = (word: number, shift: number): number => Math.max((((word >>> shift) & 1023) ^ 512) - 512, -511);
const word10 = (v: Int32Array, top: number): number => ((v[0]! & 1023) | ((v[1]! & 1023) << 10) | ((v[2]! & 1023) << 20) | (top << 30)) >>> 0;

/** A 10-bit normal from its octahedral pair. */
function octNormal(u: number, v: number, out: Int32Array): void {
  let x = u;
  let y = v;
  const z = OCT - Math.abs(u) - Math.abs(v);
  if (z < 0) {
    x = (OCT - Math.abs(v)) * (u < 0 ? -1 : 1);
    y = (OCT - Math.abs(u)) * (v < 0 ? -1 : 1);
  }
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = Math.round((511 * x) / l);
  out[1] = Math.round((511 * y) / l);
  out[2] = Math.round((511 * z) / l);
}

/**
 * Two directions square to the 10-bit normal `n` and to each other, b1 from the vertical crossed with it (from x
 * within a tenth of upright), b2 the normal crossed with b1, so |b2| = |n| |b1|. Their angle 0 is b1, 256 is b2.
 */
function basis(n: Int32Array, b: Float64Array): void {
  const x = n[0]!;
  const y = n[1]!;
  const z = n[2]!;
  const flat = 100 * (x * x + z * z) >= y * y;
  b[0] = flat ? z : 0;
  b[1] = flat ? 0 : -z;
  b[2] = flat ? -x : y;
  b[3] = flat ? -x * y : y * y + z * z;
  b[4] = flat ? x * x + z * z : -x * y;
  b[5] = flat ? -y * z : -x * z;
}

const bas = new Float64Array(6);

/** A 10-bit tangent `a` 1024ths of a turn about the 10-bit normal `n` from b1 and tilted `e` toward it. */
function angleTangent(n: Int32Array, a: number, e: number, out: Int32Array): void {
  basis(n, bas);
  const nl = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!);
  const c = cos1024(a) * nl;
  const s = cos1024(a - 256);
  let x = c * bas[0]! + s * bas[3]!;
  let y = c * bas[1]! + s * bas[4]!;
  let z = c * bas[2]! + s * bas[5]!;
  if (e !== 0) {
    const toward = (cos1024(e - 256) * Math.sqrt(x * x + y * y + z * z)) / nl;
    const along = cos1024(e);
    x = x * along + n[0]! * toward;
    y = y * along + n[1]! * toward;
    z = z * along + n[2]! * toward;
  }
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = Math.round((511 * x) / l);
  out[1] = Math.round((511 * y) / l);
  out[2] = Math.round((511 * z) / l);
}

const normal = new Int32Array(3);
const tangent = new Int32Array(3);
const near = new Int32Array(3);

/** Filter 5's entries from surface entries, before planes: the normal at its nearest pair, the tangent at its nearest angles. */
function codeSurface(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(data.length);
  const coded = new DataView(out.buffer);
  const want = new Int32Array(3);
  const same = (v: Int32Array): boolean => v[0] === want[0] && v[1] === want[1] && v[2] === want[2];
  const turn = 1024 / (2 * PI);
  const was = [0, 0, 0, 0, 0];
  for (let at = 0; at < data.length; at += 12) {
    const w = view.getUint32(at + 4, true);
    const t = view.getUint32(at + 8, true);
    for (let k = 0; k < 3; k++) want[k] = field10(w, k * 10);
    const sum = Math.abs(want[0]!) + Math.abs(want[1]!) + Math.abs(want[2]!) || 1;
    let p = want[0]! / sum;
    let q = want[1]! / sum;
    if (want[2]! < 0) [p, q] = [(1 - Math.abs(q)) * (p < 0 ? -1 : 1), (1 - Math.abs(p)) * (q < 0 ? -1 : 1)];
    let u = Math.round(p * OCT);
    let v = Math.round(q * OCT);
    octNormal(u, v, normal);
    // A pair beside the nearest may give the normal back exactly.
    for (let k = 0; k < 9 && !same(normal); k++) {
      const [nu, nv] = [u + (k % 3) - 1, v + ((k / 3) | 0) - 1];
      if (Math.abs(nu) > OCT || Math.abs(nv) > OCT) continue;
      octNormal(nu, nv, near);
      if (same(near)) [u, v] = [nu, nv];
    }
    octNormal(u, v, normal);
    for (let k = 0; k < 3; k++) want[k] = field10(t, k * 10);
    basis(normal, bas);
    const nl = Math.sqrt(normal[0]! * normal[0]! + normal[1]! * normal[1]! + normal[2]! * normal[2]!);
    const l1 = Math.sqrt(bas[0]! * bas[0]! + bas[1]! * bas[1]! + bas[2]! * bas[2]!);
    const along = (want[0]! * bas[0]! + want[1]! * bas[1]! + want[2]! * bas[2]!) / l1;
    const across = (want[0]! * bas[3]! + want[1]! * bas[4]! + want[2]! * bas[5]!) / (l1 * nl);
    const up = (want[0]! * normal[0]! + want[1]! * normal[1]! + want[2]! * normal[2]!) / nl;
    const e = Math.round(detAtan2(up, Math.sqrt(along * along + across * across)) * turn);
    const first = Math.round(detAtan2(across, along) * turn);
    // Of the nearest angle and those either side, the one whose tangent comes back nearest.
    let [a, best] = [first & 1023, -2];
    for (const da of [0, -1, 1]) {
      angleTangent(normal, (first + da) & 1023, e, near);
      const cos = (near[0]! * want[0]! + near[1]! * want[1]! + near[2]! * want[2]!) / Math.sqrt(near[0]! * near[0]! + near[1]! * near[1]! + near[2]! * near[2]!);
      if (cos > best) [a, best] = [(first + da) & 1023, cos];
    }
    const now = [view.getUint16(at, true), view.getUint16(at + 2, true), u, v, a];
    for (let k = 0; k < 4; k++) coded.setUint16(at + k * 2, zig(((now[k]! - was[k]!) << 16) >> 16), true);
    coded.setUint16(at + 8, zig(((a - was[4]!) << 22) >> 22), true);
    coded.setUint16(at + 10, zig(e) | (((w >>> 30) | ((t >>> 30) << 2)) << 12), true);
    for (let k = 0; k < 5; k++) was[k] = now[k]!;
  }
  return out;
}

/** Surface entries from filter 5's, in place. */
function decodeSurface(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let [u, v, x, y, a] = [0, 0, 0, 0, 0];
  for (let at = 0; at < data.length; at += 12) {
    u = (u + unzig(view.getUint16(at, true))) & 0xffff;
    v = (v + unzig(view.getUint16(at + 2, true))) & 0xffff;
    x = ((x + unzig(view.getUint16(at + 4, true))) << 16) >> 16;
    y = ((y + unzig(view.getUint16(at + 6, true))) << 16) >> 16;
    a = (a + unzig(view.getUint16(at + 8, true))) & 1023;
    const last = view.getUint16(at + 10, true);
    octNormal(x, y, normal);
    angleTangent(normal, a, unzig(last & 4095), tangent);
    view.setUint16(at, u, true);
    view.setUint16(at + 2, v, true);
    view.setUint32(at + 4, word10(normal, (last >>> 12) & 3), true);
    view.setUint32(at + 8, word10(tangent, last >>> 14), true);
  }
  return data;
}

/** Bytes of a step of pictures, each twice the side of the one before. */
function pictureBytes(channels: number, pictures: number, first: number): number {
  let bytes = 0;
  for (let p = 0, side = first; p < pictures; p++, side *= 2) bytes += side * side * channels;
  return bytes;
}

/** Bytes of each filter's id and numbers, 0 for an id that names none. */
const HEAD = [1, 6, 0, 2, 5, 1];

/** The filter, its numbers and the part's bytes filtered: what a build deflates. */
export function filterPart(data: Uint8Array, filter: number, numbers: readonly number[] = []): Uint8Array {
  const head = HEAD[filter]!;
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
    toPlanes(codeSurface(data), 12, body);
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

/** A part's bytes from what its stream inflated to, the filter undone. Null if the stream names no filter this build knows or does not come to `bytes`. */
export function unfilterPart(inflated: Uint8Array, bytes: number): Uint8Array | null {
  const filter = inflated[0];
  const head = filter === undefined ? 0 : (HEAD[filter] ?? 0);
  const body = inflated.subarray(head);
  if (head === 0 || body.length !== bytes) return null;
  if (filter === FILTER_LEVEL) {
    const count = new DataView(inflated.buffer, inflated.byteOffset).getUint32(1, true);
    const size = inflated[5]!;
    const ix = pad4(count * size);
    if ((size !== 2 && size !== 4) || ix > bytes || (bytes - ix) % 8 !== 0) return null;
    const out = new Uint8Array(bytes);
    decodeIndices(fromPlanes(body.subarray(0, count * size), size), count, size, out);
    out.set(body.subarray(count * size, ix), count * size);
    delta16(fromPlanes(body.subarray(ix), 8, out.subarray(ix)), 8, [0, 2, 4], true);
    return out;
  }
  if (filter === FILTER_SURFACE) return bytes % 12 === 0 ? decodeSurface(fromPlanes(body, 12)) : null;
  if (filter === FILTER_PLANES) {
    const n = inflated[1]!;
    return n > 0 && bytes % n === 0 ? fromPlanes(body, n) : null;
  }
  if (filter === FILTER_PIXELS) {
    const [channels, pictures, log2, planar] = [inflated[1]!, inflated[2]!, inflated[3]!, inflated[4]!];
    if (channels === 0 || log2 > 12 || pictureBytes(channels, pictures, 1 << log2) !== bytes) return null;
    const out = body.slice();
    pixels(out, channels, pictures, 1 << log2, planar === 1, true);
    return out;
  }
  return body.slice();
}
