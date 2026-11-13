// Asset pack format, version 2. One file holds a palette, many meshes, and
// the animation clips of the skeletons those meshes hang on.
//
//   0   "SNPK"
//   4   u16 version, u16 reserved
//   8   u32 length of the JSON header in bytes (padded to a multiple of 4)
//   12  JSON header (UTF-8)
//   ..  binary blob; every offset in the header is relative to its start
//
// The header lists each mesh with byte ranges, so a client can fetch part of a
// large pack. Vertex and instance layouts are fixed and shared with the
// renderer:
//
//   vertex    8 bytes   i16 x, y, z   position, signed-normalized within bounds
//                       u8 colour     palette index, or a colour region
//                       u8 bone       the one bone this vertex follows, in a
//                                     mesh that names a skeleton; else 0
//   index     u16
//   instance  20 bytes  f32 x, y, z   relative to the batch origin
//                       u16 yaw       1/65536 turns
//                       u8 x 6        palette index for each colour region
//
//   clip      per frame, per bone: i16 x, y, z of the rotation quaternion,
//             signed-normalized, w >= 0 implied; then per frame f32 x, y, z of
//             the root bone's offset from rest
//
// Flat shading needs no stored normals: the renderer derives the face normal.

import type { Clip, ClipSet } from "../anim/clip.ts";
import { hashBytes, hashString } from "../hash.ts";

export const PACK_MAGIC = 0x4b504e53; // "SNPK" little-endian
export const PACK_VERSION = 2;
export const VERTEX_BYTES = 8;
export const INSTANCE_BYTES = 20;

export interface PackLod {
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
}

export interface PackMesh {
  id: string;
  /** Bounds that positions are quantized within. */
  center: [number, number, number];
  half: [number, number, number];
  lods: PackLod[];
  /** Half extents of the authored collision box, when the source had one. */
  collider?: [number, number, number];
  /** Id of the skeleton whose bones the vertices follow. Absent for a rigid mesh. */
  skeleton?: string;
  /** Index into `rigs`: the body this mesh was made on. Absent when it was made on the skeleton itself. */
  rig?: number;
}

/** A body of its own proportions on a shared skeleton: where each joint rests, x, y, z per bone. */
export interface PackRig {
  id: string;
  skeleton: string;
  rest: number[];
  /**
   * A rig that is a whole skeleton (a creature's): its bones by name, the
   * root first; each bone's parent among them, -1 for the root; its hit
   * capsules, nine numbers each (the bone that carries it, its zone, its two
   * ends relative to that bone's joint, its radius); and named places on it,
   * each relative to a bone's joint. Absent for a body made on a skeleton the
   * code defines (the humanoid's).
   */
  names?: string[];
  parent?: number[];
  caps?: number[];
  sockets?: { name: string; bone: number; x: number; y: number; z: number }[];
}

export interface PackClip {
  id: string;
  bones: number;
  frames: number;
  loop: boolean;
  rotOffset: number;
  rootOffset: number;
}

export interface PackHeader {
  paletteOffset: number;
  meshes: PackMesh[];
  rigs: PackRig[];
  clips: PackClip[];
}

export interface Pack {
  readonly header: PackHeader;
  /** The binary blob. Offsets in the header index into this. */
  readonly blob: Uint8Array;
  readonly palette: Uint8Array;
  readonly meshIndex: ReadonlyMap<string, number>;
  /** The clips, decoded. */
  readonly clips: ClipSet;
}

/** Bytes one frame of a clip takes for its rotations, and for its root. */
export function clipRotBytes(bones: number): number {
  return bones * 6;
}
export const CLIP_ROOT_BYTES = 12;

/** Parse a pack file. Throws with a reason if it is not a readable pack of this version. */
export function parsePack(file: Uint8Array): Pack {
  if (file.length < 12) throw new Error("pack: file too short");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== PACK_MAGIC) throw new Error("pack: bad magic");
  const version = view.getUint16(4, true);
  if (version !== PACK_VERSION) throw new Error(`pack: version ${version} is not supported`);
  const jsonLength = view.getUint32(8, true);
  if (12 + jsonLength > file.length) throw new Error("pack: truncated header");
  const header = JSON.parse(decodeUtf8(file.subarray(12, 12 + jsonLength))) as PackHeader;
  const blob = file.subarray(12 + jsonLength);
  const meshIndex = new Map<string, number>();
  header.meshes.forEach((m, i) => {
    meshIndex.set(m.id, i);
    for (const lod of m.lods) {
      if (lod.vertexOffset + lod.vertexCount * VERTEX_BYTES > blob.length || lod.indexOffset + lod.indexCount * 2 > blob.length) {
        throw new Error(`pack: mesh ${m.id} points outside the file`);
      }
    }
  });
  if (header.paletteOffset + 1024 > blob.length) throw new Error("pack: palette outside the file");
  header.rigs ??= [];
  header.clips ??= [];
  return { header, blob, palette: blob.subarray(header.paletteOffset, header.paletteOffset + 1024), meshIndex, clips: decodeClips(header.clips, blob) };
}

function decodeClips(list: readonly PackClip[], blob: Uint8Array): ClipSet {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const index = new Map<string, number>();
  let hash = hashString("snark-clips-1");
  const clips: Clip[] = list.map((c, i) => {
    const rotBytes = c.frames * clipRotBytes(c.bones);
    if (!(c.frames > 0 && c.bones > 0) || c.rotOffset + rotBytes > blob.length || c.rootOffset + c.frames * CLIP_ROOT_BYTES > blob.length) throw new Error(`pack: clip ${c.id} points outside the file`);
    const rot = new Float32Array(c.frames * c.bones * 4);
    for (let k = 0; k < c.frames * c.bones; k++) {
      const x = view.getInt16(c.rotOffset + k * 6, true) / 32767;
      const y = view.getInt16(c.rotOffset + k * 6 + 2, true) / 32767;
      const z = view.getInt16(c.rotOffset + k * 6 + 4, true) / 32767;
      const ww = 1 - x * x - y * y - z * z;
      rot[k * 4] = x;
      rot[k * 4 + 1] = y;
      rot[k * 4 + 2] = z;
      rot[k * 4 + 3] = ww > 0 ? Math.sqrt(ww) : 0;
    }
    const root = new Float32Array(c.frames * 3);
    for (let k = 0; k < root.length; k++) root[k] = view.getFloat32(c.rootOffset + k * 4, true);
    index.set(c.id, i);
    hash = hashString(`${c.id}:${c.bones}:${c.frames}:${c.loop}`, hash);
    hash = hashBytes(blob.subarray(c.rotOffset, c.rotOffset + rotBytes), hash);
    hash = hashBytes(blob.subarray(c.rootOffset, c.rootOffset + c.frames * CLIP_ROOT_BYTES), hash);
    return { id: c.id, bones: c.bones, frames: c.frames, loop: c.loop, rot, root };
  });
  return { clips, index, hash };
}

/** Vertex bytes of one level of detail, as a view into the pack. */
export function lodVertices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.vertexOffset, lod.vertexOffset + lod.vertexCount * VERTEX_BYTES);
}

/** Index bytes (u16 little-endian) of one level of detail, as a view into the pack. */
export function lodIndices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.indexOffset, lod.indexOffset + lod.indexCount * 2);
}

export function decodeUtf8(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!;
    let c = b;
    let extra = 0;
    if (b >= 0xf0) {
      c = b & 7;
      extra = 3;
    } else if (b >= 0xe0) {
      c = b & 15;
      extra = 2;
    } else if (b >= 0xc0) {
      c = b & 31;
      extra = 1;
    }
    for (; extra > 0 && i < bytes.length; extra--) c = (c << 6) | (bytes[i++]! & 63);
    if (c >= 0x10000) {
      c -= 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else s += String.fromCharCode(c);
  }
  return s;
}
