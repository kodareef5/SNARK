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
//   clip      rot: each rotation as x, y, z of its axis times the tangent of a quarter of its angle, w >= 0, in
//             1/CLIP_ROT_STEPS; by bone, by parameter, by frame, each less what the two frames before foretell (twice
//             the last less the one before), zigzagged as i16, every low byte and then every high byte
//             root: the root bone's offset from rest in 1/CLIP_ROOT_STEPS m, by axis, by frame, foretold alike,
//             zigzagged as i32, in four planes of bytes
//
// A flat level stores no normals. The renderer derives the face normal for flat shading.

import type { Clip, ClipSet } from "../anim/clip.ts";
import { hashBytes, hashString } from "../hash.ts";
import { ATLAS_MOST, CELL, atlasBytes, type PackDetails } from "./details.ts";
import type { LandmarkFarRow } from "./far.ts";
import { stepOf, type TextureRole } from "./texture.ts";

export const PACK_MAGIC = 0x4b504e53; // "SNPK" little-endian
export const PACK_VERSION = 5;
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
   * the other (tools/pack/error.ts). 0 for the finest.
   */
  error: number;
  /** Where the surface entries are, one per vertex, right after the vertices. Absent in a flat level. */
  surfaceOffset?: number;
  /** Where the skin entries are, right after the surface. Absent in a flat level, in a mesh that follows one bone, and where every vertex is wholly on its own. */
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
/** A material whose glow (`emissive`) is on only from dusk to dawn, as a working street lamp's lens (client/core/render/surface.ts `lampsOn`). */
export const MATERIAL_NIGHT = 4;
/** Tinted reflective lens. Drawn after its opaque backing with angle-dependent coverage. */
export const MATERIAL_LENS = 8;
/** A self-dimming status light. Limits its own apparent luminance as the eye adapts to darkness. */
export const MATERIAL_INDICATOR = 16;
/** Emitting gas with procedural coverage along its local UV axis. */
export const MATERIAL_EXHAUST = 32;
/** Light with no surface of its own: drawn after everything opaque, blended over it, showing both faces and writing no depth. */
export const MATERIAL_BLEND = 64;

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
   * What the surface turns to as the body is hurt (the cue word's hurt stage) and as its corpse decays: one texture of
   * role "layer" made from the asset's hurt and decay pictures (tools/pack/image.ts `layerPicture`). Absent for none.
   */
  layer?: number;
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
  /** A thin sheet's: how much of the light on one face its other face shows (shared/pack/finish.ts). Absent for none. */
  sheet?: number;
}

/** The texture a material names in a role, -1 for none. */
export const textureOf = (m: PackMaterial, role: TextureRole): number => (role === "layer" ? (m.layer ?? -1) : m[role]);

/** Names `t` in a role; a material with no layer leaves the field out. */
export function setTexture(m: PackMaterial, role: TextureRole, t: number): void {
  if (role !== "layer") m[role] = t;
  else if (t >= 0) m.layer = t;
  else delete m.layer;
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
  /** Drawn see-through, its finishes showing their share (shared/pack/finish.ts). */
  seeThrough?: boolean;
}

/** Native upright-grip calibration at unit hand size. Twelve values per radius, six per hand (left then right): marker X/Z,
 * finger/distal curl, thumb Z curl/Y opposition. Rows are equally spaced; span bounds the native contact witnesses along the bar. */
export interface PackGrip {
  mesh: string;
  start: number;
  step: number;
  poses: number[];
  span: [number, number];
  /** When stored in the blob, poses gives the count followed at this offset by that many little-endian i32s. */
  poseOffset?: number;
}

export const GRIP_POSE_UNITS = 1_000_000_000;

/** Contact boundaries in the source clip's 0..1 turn, before gait phase alignment. */
export interface PackFootfall { bone: number; plant: number; lift: number }

/** A centre of mass is authored in metres relative to its bone joint. */
export function validMassCentre(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
}

/** Skin-fitted convex contacts. Boxes and outward planes are bone-local metres. */
export interface PackHitSurface {
  root: number;
  zone: number;
  bones: { bone: number; pieces: { box: number[]; planes: number[] }[] }[];
}

/** Rig proportions and anatomy, with each rest joint in model space. */
export interface PackRig {
  hitSurfaces?: PackHitSurface[];
  id: string;
  skeleton: string;
  rest: number[];
  /** Native rigid foot/toe sole witnesses, model-space xyz after quantization, keyed by the actual foot mesh.
   * Four samples in HUMAN foot.L, toe.L, foot.R, toe.R order; empty points mean the actual mesh lacks usable calibration.
   * Boot headers retain these without loading fine geometry. */
  soles?: { mesh: string; points: number[] }[];
  /** Optional actual bare/gloved hand profiles; a body without them keeps ordinary marker fitting. */
  grips?: PackGrip[];
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
  /** Two distinct named airway witnesses, sampled from the posed head during unconsciousness and recovery. */
  breath?: [string, string];
  strides?: Record<string, number>;
  footfalls?: Record<string, PackFootfall[]>;
  /** Optional grounded pose fitting. Angles are degrees; distances are metres at native size. */
  ground?: { maxTilt: number; maxStep: number; probe: number; legs: { upper: number; lower: number; end: number; socket: string }[] };
  /** The bones that are bodies of its ragdoll, with their limits in degrees, and the frame of the death clip at which it goes limp. */
  ragdoll?: { limp: number; bodies: { bone: number; mass: number; swing: number; twist: number; massCentre?: readonly [number, number, number] }[]; contacts?: number[] };
}

export interface PackClip {
  id: string;
  bones: number;
  frames: number;
  loop: boolean;
  rotOffset: number;
  rootOffset: number;
}

export const HIT_PLANE_UNITS = 10000;

export interface PackHeader {
  paletteOffset: number;
  /** Boot packs may store a piece's planes as its coefficient count, followed here by that many little-endian i16s. */
  hitPlaneOffset?: number;
  meshes: PackMesh[];
  rigs: PackRig[];
  clips: PackClip[];
  materials?: PackMaterial[];
  textures?: PackTexture[];
  /** Small details: their atlas, effects and cue sheets (shared/pack/details.ts). The boot file carries them. */
  details?: PackDetails;
  /** In a built landmark's pack, its far mesh's row (shared/pack/far.ts). A source pack has none. */
  landmarks?: LandmarkFarRow[];
  /** In an asset's pack, the finishes its flat levels are lit with (shared/pack/finish.ts), FINISH_NUMBERS each. */
  finishes?: number[];
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
/** Steps a rotation parameter and a metre of the root's offset are counted in. Rounded to them, a bone turns at most 0.025 degrees from its clip. */
export const CLIP_ROT_STEPS = 8192;
export const CLIP_ROOT_STEPS = 4096;

/** Throws with a reason if the file is not a readable pack of this version. */
export function parsePack(file: Uint8Array): Pack {
  if (file.length < 12) throw new Error("pack: file too short");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== PACK_MAGIC) throw new Error("pack: bad magic");
  const version = view.getUint16(4, true);
  if (version !== PACK_VERSION) throw new Error(`pack: version ${version} is not supported`);
  const jsonLength = view.getUint32(8, true);
  if (12 + jsonLength > file.length) throw new Error("pack: truncated header");
  const header = JSON.parse(decodeUtf8(file.subarray(12, 12 + jsonLength))) as PackHeader;
  let blob = file.subarray(12 + jsonLength);
  const meshIndex = new Map<string, number>();
  const textures = header.textures ?? [];
  const materials = header.materials ?? [];
  for (const t of textures) if (stepOf(t.top) < 0) throw new Error(`pack: texture ${t.id} is ${t.top} pixels across`);
  for (const m of materials) {
    for (const t of [m.base, m.normal, m.mro, m.mask, m.mask2, m.layer ?? -1]) if (!(t >= -1 && t < textures.length)) throw new Error(`pack: material ${m.id} names a texture that is not there`);
  }
  header.meshes.forEach((m, i) => {
    meshIndex.set(m.id, i);
    m.lods.forEach((lod, level) => {
      if ((lod.surfaceOffset !== undefined) !== level < (m.flat ?? 0)) throw new Error(`pack: mesh ${m.id} does not turn flat where it says`);
    });
    for (const lod of m.lods) {
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
  if (header.hitPlaneOffset !== undefined) {
    let at = header.hitPlaneOffset;
    if (!Number.isSafeInteger(at) || at < 0 || at > blob.length) throw new Error("pack: hit planes outside the file");
    const planes = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    for (const rig of header.rigs) for (const surface of rig.hitSurfaces ?? []) for (const bone of surface.bones) for (const piece of bone.pieces) {
      if (piece.planes.length !== 1) continue;
      const count = piece.planes[0]!;
      if (!Number.isSafeInteger(count) || count <= 0 || count % 4 || at + 2 * count > blob.length) throw new Error("pack: invalid hit plane count");
      const values = new Array<number>(count);
      for (let k = 0; k < count; k++, at += 2) values[k] = planes.getInt16(at, true) / HIT_PLANE_UNITS;
      piece.planes = values;
    }
    delete header.hitPlaneOffset;
  }
  for (const rig of header.rigs) for (const grip of rig.grips ?? []) {
    const at = grip.poseOffset;
    if (at === undefined) continue;
    const count = Array.isArray(grip.poses) && grip.poses.length === 1 ? grip.poses[0]! : 0;
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(count) || count <= 0 || at + count * 4 > blob.length) {
      throw new Error(`pack: grip ${grip.mesh} points outside the file`);
    }
    grip.poses = Array.from({ length: count }, (_, k) => view.getInt32(12 + jsonLength + at + 4 * k, true) / GRIP_POSE_UNITS);
    delete grip.poseOffset;
  }
  const d = header.details;
  if (d && !(d.atlas.side >= CELL && d.atlas.side <= ATLAS_MOST && (d.atlas.side & (d.atlas.side - 1)) === 0)) throw new Error(`pack: the details atlas is ${d.atlas.side} pixels across`);
  if (d) {
    const { offset, side, firstMip = 0, planar } = d.atlas;
    if (!Number.isInteger(firstMip) || firstMip < 0 || firstMip > Math.log2(side / CELL)) throw new Error("pack: invalid first mip of the details atlas");
    const bytes = atlasBytes(side >> firstMip);
    if (!Number.isInteger(offset) || offset < 0 || offset + bytes > blob.length) throw new Error("pack: the details atlas is outside the file");
    if (planar) {
      // A caller may cache, hash or parse the same file again. Own the decoded blob.
      const planes = blob.subarray(offset, offset + bytes), pixels = bytes / 4;
      blob = new Uint8Array(blob);
      for (let c = 0; c < 4; c++) {
        for (let i = 0; i < pixels; i++) blob[offset + 4 * i + c] = planes[c * pixels + i]!;
      }
      delete d.atlas.planar;
    }
  }
  return { header, blob, blobAt: 12 + jsonLength, palette: blob.subarray(header.paletteOffset, header.paletteOffset + 1024), meshIndex, clips: decodeClips(header.clips, blob) };
}

const unzig = (z: number): number => (z >>> 1) ^ -(z & 1);

/** The clips `list` names in `blob`. A clip's hash is taken over the bytes it is stored in. */
export function decodeClips(list: readonly PackClip[], blob: Uint8Array): ClipSet {
  const index = new Map<string, number>();
  const seed = hashString("snark-clips-2");
  let hash = 0;
  const clips: Clip[] = list.map((c, i) => {
    const rotBytes = c.frames * clipRotBytes(c.bones);
    if (!(c.frames > 0 && c.bones > 0) || c.rotOffset + rotBytes > blob.length || c.rootOffset + c.frames * CLIP_ROOT_BYTES > blob.length) throw new Error(`pack: clip ${c.id} points outside the file`);
    const rot = new Float32Array(c.frames * c.bones * 4);
    const n = c.frames * c.bones * 3;
    for (let b = 0, at = c.rotOffset; b < c.bones; b++) {
      for (let a = 0; a < 3; a++) {
        for (let f = 0, last = 0, before = 0; f < c.frames; f++, at++) {
          const x = ((2 * last - before + unzig(blob[at]! | (blob[at + n]! << 8))) << 16) >> 16;
          rot[(f * c.bones + b) * 4 + a] = x;
          before = f === 0 ? x : last;
          last = x;
        }
      }
    }
    for (let k = 0; k < rot.length; k += 4) {
      const x = rot[k]! / CLIP_ROT_STEPS;
      const y = rot[k + 1]! / CLIP_ROT_STEPS;
      const z = rot[k + 2]! / CLIP_ROT_STEPS;
      const s = x * x + y * y + z * z;
      rot[k] = (2 * x) / (1 + s);
      rot[k + 1] = (2 * y) / (1 + s);
      rot[k + 2] = (2 * z) / (1 + s);
      rot[k + 3] = (1 - s) / (1 + s);
    }
    const root = new Float32Array(c.frames * 3);
    const m = root.length;
    for (let a = 0, at = c.rootOffset; a < 3; a++) {
      for (let f = 0, last = 0, before = 0; f < c.frames; f++, at++) {
        const x = (2 * last - before + unzig(blob[at]! | (blob[at + m]! << 8) | (blob[at + 2 * m]! << 16) | (blob[at + 3 * m]! << 24))) | 0;
        root[f * 3 + a] = x / CLIP_ROOT_STEPS;
        before = f === 0 ? x : last;
        last = x;
      }
    }
    index.set(c.id, i);
    const own = hashBytes(blob.subarray(c.rootOffset, c.rootOffset + c.frames * CLIP_ROOT_BYTES), hashBytes(blob.subarray(c.rotOffset, c.rotOffset + rotBytes), hashString(`${c.id}:${c.bones}:${c.frames}:${c.loop}`, seed)));
    hash = (hash + own) >>> 0;
    return { id: c.id, bones: c.bones, frames: c.frames, loop: c.loop, rot, root };
  });
  return { clips, index, hash };
}

/** The resident mips of the details atlas, largest first, as a view into the pack; empty for a pack without details. */
export function detailsAtlas(pack: Pack): Uint8Array {
  const d = pack.header.details;
  return d ? pack.blob.subarray(d.atlas.offset, d.atlas.offset + atlasBytes(d.atlas.side >> (d.atlas.firstMip ?? 0))) : new Uint8Array(0);
}

/** lodVertices and lodIndices return views into the pack. Indices are little-endian, `indexBytes` each. */
export function lodVertices(pack: Pack, lod: PackLod): Uint8Array {
  return pack.blob.subarray(lod.vertexOffset, lod.vertexOffset + lod.vertexCount * VERTEX_BYTES);
}

/**
 * How far a mesh reaches sideways from its origin at any of its levels, in metres, as its vertices stand: the radius a
 * turn about its upright axis keeps it within, never more than its bounds' corner. Rounded up to a centimetre.
 */
export function meshReach(pack: Pack, m: PackMesh): number {
  const known = reaches.get(m);
  if (known !== undefined) return known;
  let most = 0;
  for (const lod of m.lods) {
    const v = lodVertices(pack, lod), view = new DataView(v.buffer, v.byteOffset, v.byteLength);
    for (let i = 0; i < lod.vertexCount; i++) {
      const x = m.center[0] + (Math.max(-32767, view.getInt16(i * VERTEX_BYTES, true)) / 32767) * m.half[0];
      const z = m.center[2] + (Math.max(-32767, view.getInt16(i * VERTEX_BYTES + 4, true)) / 32767) * m.half[2];
      most = Math.max(most, x * x + z * z);
    }
  }
  const reach = Math.ceil(Math.sqrt(most) * 100) / 100;
  reaches.set(m, reach);
  return reach;
}

/** Each mesh's reach once measured: a pack's meshes are described again for every scene a test makes. */
const reaches = new WeakMap<PackMesh, number>();

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

// The platform's decoder, which every engine the game runs on has though ECMAScript does not name it. A string built a
// character at a time is a piece per character in JavaScriptCore, about 36 bytes of heap each.
const utf8 = new (globalThis as unknown as { TextDecoder: new () => { decode(bytes: Uint8Array): string } }).TextDecoder();

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}
