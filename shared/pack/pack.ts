// Asset pack file. It holds a palette, many meshes, and the animation clips of the skeletons those meshes use.
//
//   0   "SNPK"
//   4   u16 version, u16 reserved
//   8   u32 length of the JSON header in bytes (padded to a multiple of 4)
//   12  JSON header (UTF-8)
//   ..  binary blob. Every offset in the header is relative to its start.
//
// The JSON header lists each mesh with byte ranges, so a client can fetch part of a large pack. A level of detail is one
// run of bytes: its indices padded to a multiple of 4, its vertices, and then, in a level that is drawn with materials,
// a surface entry and a skin entry for every vertex. A client that draws flat colours fetches only as far as the
// vertices. The renderer shares these fixed layouts:
//
//   vertex    8 bytes   i16 x, y, z   position, signed-normalized within bounds
//                       u8 colour     palette index, or a colour region
//                       u8 bone       the one bone this vertex follows, in a
//                                     mesh that names a skeleton; else 0
//   surface   12 bytes  u16 u, v      texture coordinate, 0..65535 across the mesh's `uv`
//                                     range, which is one texture where none is given
//                       u32 normal    x, y, z in 10 bits each, signed-normalized
//                       u32 tangent   the same, and in the top 2 bits the sign of
//                                     the bitangent: 1 or -1
//   skin      8 bytes   u8 x 4        bones, the first being the vertex's own
//                       u8 x 4        their weights, which sum to 255
//   index     u16, or u32 in a level of more than 65,535 vertices
//   instance  20 bytes  f32 x, y, z   relative to the batch origin
//                       u16 yaw       1/65536 turns
//                       u8 x 6        palette index for each colour region
//
//   clip      per frame, per bone: i16 x, y, z of the rotation quaternion,
//             signed-normalized, w >= 0 implied; then per frame f32 x, y, z of
//             the root bone's offset from rest
//
// A flat level stores no normals. The renderer derives the face normal for flat shading.
//
// Versions 2 and 3 are still read. Version 3 had no surface, skin, sections or materials. Version 2 also had 16-bit
// indices only, did not say how far a level lies from the finest, and kept a level's vertices before its indices.

import type { Clip, ClipSet } from "../anim/clip.ts";
import { hashBytes, hashString } from "../hash.ts";
import { stepOf, type TextureRole } from "./texture.ts";

export const PACK_MAGIC = 0x4b504e53; // "SNPK" little-endian
export const PACK_VERSION = 4;
export const VERTEX_BYTES = 8;
export const SURFACE_BYTES = 12;
export const SKIN_BYTES = 8;
export const INSTANCE_BYTES = 20;
/** The most materials one level is drawn with. */
export const MOST_SECTIONS = 3;

export interface PackLod {
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
  /** Bytes of one index: 2, or 4 in a level of more than 65,535 vertices. */
  indexBytes: 2 | 4;
  /**
   * How far, in metres, this level's surface lies from the finest level's: 95 points in 100 of either are within this of
   * the other (tools/pack/error.ts). 0 for the finest. NaN from a version 2 file, which did not say.
   */
  error: number;
  /** Where the surface entries are, one per vertex, right after the vertices. Absent in a flat level. */
  surfaceOffset?: number;
  /** Where the skin entries are, right after the surface. Absent in a flat level and in a mesh that follows one bone. */
  skinOffset?: number;
  /**
   * The runs of indices drawn with each material, three numbers a run: index into the header's `materials`, first
   * index, how many. The runs follow one another and cover the level. Absent in a flat level.
   */
  sections?: number[];
}

/** PackMaterial.flags. A cut-out material shows nothing where the base colour's alpha is under `cutoff`. */
export const MATERIAL_TWO_SIDED = 1;
export const MATERIAL_CUTOUT = 2;

export interface PackMaterial {
  id: string;
  /** Indices into the header's `textures`, -1 for none. */
  base: number;
  normal: number;
  mro: number;
  /** Regions 0 to 2, and regions 3 to 5. A material with three regions or fewer has no second. */
  mask: number;
  mask2: number;
  /**
   * Layers laid over the base colour as the body is hurt (the cue word's hurt stage) and as its corpse decays, each a
   * texture index. Absent for none, and nothing draws them yet.
   */
  hurt?: number;
  decay?: number;
  /** Multiplied over the base colour, linear 0..1. */
  tint: [number, number, number];
  /** The mean linear brightness of the base colour where the masks mark a region. A region's colour is divided by it, so the dyed surface averages that colour. */
  grey: number;
  /** How much the base colour glows where its alpha is high. 0 when alpha means coverage. */
  emissive: number;
  flags: number;
  cutoff: number;
  /** Metres of surface across one whole texture, measured when the pack was made. */
  span: number;
}

/** A texture a material names. Its pixels are in the texture files, not in the pack. */
export interface PackTexture {
  id: string;
  role: TextureRole;
  /** The side of the largest picture, in pixels. */
  top: number;
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
  /** Index into `rigs` of the body this mesh was made on. Absent when it was made on the skeleton itself. */
  rig?: number;
  /** The first level that is flat: it and every coarser one have no surface. Absent when every level is flat. */
  flat?: number;
  /**
   * What a stored texture coordinate spans: least u, least v, width, height, in textures. A stored u is `uv[0] + u / 65535 *
   * uv[2]`. Absent for 0, 0, 1, 1. A wall whose material repeats along it has a range wider than one texture.
   */
  uv?: [number, number, number, number];
}

/** A body with its own proportions on a shared skeleton. `rest` is each joint's rest position, x, y, z per bone. */
export interface PackRig {
  id: string;
  skeleton: string;
  rest: number[];
  /**
   * Present for a rig that is a whole skeleton (a creature's), absent for a body on a skeleton written in code (the humanoid's).
   * `names` lists the bones, root first. `parent` is each bone's parent index, -1 for the root. `caps` is nine numbers per hit
   * capsule: bone, zone, the two ends relative to the bone's joint, radius. A socket is positioned relative to its bone's joint.
   */
  names?: string[];
  parent?: number[];
  caps?: number[];
  sockets?: { name: string; bone: number; x: number; y: number; z: number }[];
  /** The bones it stands on, and the metres one turn of each gait clip carries it, by the clip's name. */
  feet?: number[];
  strides?: Record<string, number>;
  /** The bones that are bodies of its ragdoll, with their limits in degrees, and the frame of the death clip at which it goes limp. */
  ragdoll?: { limp: number; bodies: { bone: number; mass: number; swing: number; twist: number }[] };
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
  materials?: PackMaterial[];
  textures?: PackTexture[];
}

export interface Pack {
  readonly header: PackHeader;
  /** Offsets in the header index into this. */
  readonly blob: Uint8Array;
  /** Where the blob starts in the file. */
  readonly blobAt: number;
  readonly palette: Uint8Array;
  readonly meshIndex: ReadonlyMap<string, number>;
  /** Decoded. */
  readonly clips: ClipSet;
}

/** Bytes per frame of a clip's rotations, and of its root. */
export function clipRotBytes(bones: number): number {
  return bones * 6;
}
export const CLIP_ROOT_BYTES = 12;

/** Throws with a reason if the file is not a readable pack of this version. */
export function parsePack(file: Uint8Array): Pack {
  if (file.length < 12) throw new Error("pack: file too short");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== PACK_MAGIC) throw new Error("pack: bad magic");
  const version = view.getUint16(4, true);
  if (version < 2 || version > PACK_VERSION) throw new Error(`pack: version ${version} is not supported`);
  const jsonLength = view.getUint32(8, true);
  if (12 + jsonLength > file.length) throw new Error("pack: truncated header");
  const header = JSON.parse(decodeUtf8(file.subarray(12, 12 + jsonLength))) as PackHeader;
  const blob = file.subarray(12 + jsonLength);
  const meshIndex = new Map<string, number>();
  const textures = header.textures ?? [];
  const materials = header.materials ?? [];
  for (const t of textures) if (stepOf(t.top) < 0) throw new Error(`pack: texture ${t.id} is ${t.top} pixels across`);
  for (const m of materials) {
    m.mask2 ??= -1;
    for (const t of [m.base, m.normal, m.mro, m.mask, m.mask2, m.hurt ?? -1, m.decay ?? -1]) if (!(t >= -1 && t < textures.length)) throw new Error(`pack: material ${m.id} names a texture that is not there`);
  }
  header.meshes.forEach((m, i) => {
    meshIndex.set(m.id, i);
    m.lods.forEach((lod, level) => {
      if ((lod.surfaceOffset !== undefined) !== level < (m.flat ?? 0)) throw new Error(`pack: mesh ${m.id} does not turn flat where it says`);
    });
    for (const lod of m.lods) {
      lod.indexBytes ??= 2;
      lod.error ??= NaN;
      if (lod.vertexOffset + lod.vertexCount * VERTEX_BYTES > blob.length || lod.indexOffset + lod.indexCount * lod.indexBytes > blob.length) {
        throw new Error(`pack: mesh ${m.id} points outside the file`);
      }
      if (lod.surfaceOffset === undefined) {
        if (lod.skinOffset !== undefined || lod.sections !== undefined) throw new Error(`pack: a level of ${m.id} has skin or sections and no surface`);
        continue;
      }
      if (lod.surfaceOffset + lod.vertexCount * SURFACE_BYTES > blob.length || (lod.skinOffset !== undefined && lod.skinOffset + lod.vertexCount * SKIN_BYTES > blob.length)) {
        throw new Error(`pack: mesh ${m.id} points outside the file`);
      }
      const runs = lod.sections ?? [];
      let next = 0;
      for (let k = 0; k < runs.length; k += 3) {
        if (!(runs[k]! >= 0 && runs[k]! < materials.length) || runs[k + 1] !== next || !(runs[k + 2]! > 0)) throw new Error(`pack: a level of ${m.id} has a section that does not fit`);
        next += runs[k + 2]!;
      }
      if (runs.length === 0 || runs.length > MOST_SECTIONS * 3 || next !== lod.indexCount) throw new Error(`pack: the sections of a level of ${m.id} do not cover it`);
    }
  });
  if (header.paletteOffset + 1024 > blob.length) throw new Error("pack: palette outside the file");
  header.rigs ??= [];
  header.clips ??= [];
  return { header, blob, blobAt: 12 + jsonLength, palette: blob.subarray(header.paletteOffset, header.paletteOffset + 1024), meshIndex, clips: decodeClips(header.clips, blob) };
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

/** lodVertices and lodIndices return views into the pack. Indices are little-endian, `indexBytes` each. */
export function lodVertices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.vertexOffset, lod.vertexOffset + lod.vertexCount * VERTEX_BYTES);
}

export function lodIndices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.indexOffset, lod.indexOffset + lod.indexCount * lod.indexBytes);
}

/** Views into the pack, or null for a level that has none. */
export function lodSurface(pack: Pack, lod: PackLod): Uint8Array | null {
  return lod.surfaceOffset === undefined ? null : pack.blob.subarray(lod.surfaceOffset, lod.surfaceOffset + lod.vertexCount * SURFACE_BYTES);
}

export function lodSkin(pack: Pack, lod: PackLod): Uint8Array | null {
  return lod.skinOffset === undefined ? null : pack.blob.subarray(lod.skinOffset, lod.skinOffset + lod.vertexCount * SKIN_BYTES);
}

/** A level's indices as numbers, whichever width the file holds them in. */
export function readIndices(pack: Pack, lod: PackLod): Uint32Array {
  const view = new DataView(pack.blob.buffer, pack.blob.byteOffset + lod.indexOffset, lod.indexCount * lod.indexBytes);
  const out = new Uint32Array(lod.indexCount);
  for (let i = 0; i < out.length; i++) out[i] = lod.indexBytes === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
  return out;
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
