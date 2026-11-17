// Builds pack files from meshes in authoring form.

import type { Clip } from "../../shared/anim/clip.ts";
import {
  CLIP_ROOT_BYTES, CLIP_ROOT_STEPS, CLIP_ROT_STEPS, MATERIAL_CUTOUT, MOST_SECTIONS, PACK_MAGIC, PACK_VERSION, SKIN_BYTES, VERTEX_BYTES, clipRotBytes, lodSkin, lodSurface, lodVertices, readIndices,
  setTexture, textureOf, type Pack, type PackHeader, type PackLod, type PackMaterial, type PackMesh, type PackRig, type PackTexture,
} from "../../shared/pack/pack.ts";
import type { PackDetails } from "../../shared/pack/details.ts";
import type { LandmarkFarRow } from "../../shared/pack/far.ts";
import { TEXTURE_ROLES, stepOf } from "../../shared/pack/texture.ts";
import { surfaceError } from "./error.ts";
import { rankSprays } from "./sprays.ts";
import { decodeSkin, decodeSurface, encodeSkin, encodeSurface, tangentsOf, uvRange } from "./surface.ts";

/** One level of detail before quantization. */
export interface SourceLod {
  /** x, y, z per vertex, metres, model space. */
  positions: Float32Array;
  /** Palette index or colour region per vertex. */
  colors: Uint8Array;
  indices: Uint32Array;
  /** The bone each vertex follows, in a mesh with a skeleton. */
  bones?: Uint8Array;
  /** How far, in metres, its surface lies from the finest level's, where what made it knows. Measured where it is not given. */
  error?: number;
  // What follows is for a level drawn with materials, which needs `uvs` and `normals`. All but `sections` are per vertex.
  /** u, v: 0 to 1 across the picture, with v = 0 at its first row. */
  uvs?: Float32Array;
  /** x, y, z, of length 1. */
  normals?: Float32Array;
  /** x, y, z and the sign of the bitangent, 1 or -1, as glTF has them. Worked out from the texture coordinates where not given. */
  tangents?: Float32Array;
  /** Four bones and their four weights, in a mesh with a skeleton. `bones[v]` must be one of the four. The weights need not sum to 1. */
  joints?: Uint8Array;
  weights?: Float32Array;
  /** Per triangle, which of the mesh's `materials` it is drawn with. Absent where every triangle is drawn with the first. */
  sections?: Uint8Array;
}

export interface SourceMesh {
  id: string;
  lods: SourceLod[];
  collider?: [number, number, number];
  /** Skeleton the vertices follow, and optionally the rig (by id) the mesh was made on. */
  skeleton?: string;
  rig?: string;
  /**
   * The first level that is flat. The levels before it are drawn with materials. It and every coarser one are written
   * flat, whatever else they have. Absent when every level is flat.
   */
  flat?: number;
  /**
   * The materials its triangles are drawn with, and the textures those name: where a material names a texture it gives
   * its place in `textures`, or -1. A pack keeps one material and one texture of each id, whichever meshes name it.
   */
  materials?: PackMaterial[];
  textures?: PackTexture[];
}

/** The blob of a pack as it is put together: runs of bytes, each padded to a multiple of 4. */
export class PackBlob {
  readonly parts: Uint8Array[] = [];
  size = 0;

  /** Returns where the bytes start in the blob. */
  append(bytes: Uint8Array): number {
    const at = this.size;
    this.parts.push(bytes);
    this.size += bytes.length;
    const pad = (4 - (this.size & 3)) & 3;
    if (pad > 0) {
      this.parts.push(new Uint8Array(pad));
      this.size += pad;
    }
    return at;
  }

  /** The pack file: the header as JSON, then the blob. */
  file(header: PackHeader): Uint8Array {
    let json = new TextEncoder().encode(JSON.stringify(header));
    const pad = (4 - (json.length & 3)) & 3;
    if (pad > 0) {
      const padded = new Uint8Array(json.length + pad).fill(0x20);
      padded.set(json);
      json = padded;
    }
    const file = new Uint8Array(12 + json.length + this.size);
    const view = new DataView(file.buffer);
    view.setUint32(0, PACK_MAGIC, true);
    view.setUint16(4, PACK_VERSION, true);
    view.setUint32(8, json.length, true);
    file.set(json, 12);
    let at = 12 + json.length;
    for (const p of this.parts) {
      file.set(p, at);
      at += p.length;
    }
    return file;
  }
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** How many of a mesh's levels are drawn with materials. */
const surfaced = (mesh: SourceMesh): number => Math.min(mesh.flat ?? 0, mesh.lods.length);

/** The materials the meshes' triangles are drawn with and the textures those name, one of each id, in order of id. */
function pool(meshes: readonly SourceMesh[]): { materials: PackMaterial[]; textures: PackTexture[] } {
  const textures = new Map<string, PackTexture>();
  /** Per id: the material, the ids of its textures by role, and both as text, to tell two that differ. */
  const materials = new Map<string, { material: PackMaterial; names: (string | null)[]; text: string }>();
  for (const mesh of meshes) {
    const used = new Set<number>();
    for (const lod of mesh.lods.slice(0, surfaced(mesh))) for (let t = 0; t < lod.indices.length / 3; t++) used.add(lod.sections?.[t] ?? 0);
    for (const k of used) {
      const m = mesh.materials?.[k];
      if (!m) throw new Error(`${mesh.id}: a triangle is drawn with material ${k}, which the mesh does not have`);
      const names = TEXTURE_ROLES.map((role) => {
        const at = textureOf(m, role);
        if (at < 0) return null;
        const t = mesh.textures?.[at];
        if (!t || t.role !== role || stepOf(t.top) < 0) throw new Error(`${mesh.id}: material ${m.id} has no usable ${role} texture at ${at}`);
        const had = textures.get(t.id);
        if (had && (had.role !== t.role || had.top !== t.top)) throw new Error(`${mesh.id}: texture ${t.id} is described twice, and differently`);
        textures.set(t.id, { id: t.id, role: t.role, top: t.top });
        return t.id;
      });
      const material: PackMaterial = { id: m.id, base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: m.tint, grey: m.grey, emissive: m.emissive, flags: m.flags, cutoff: m.cutoff, span: m.span, ...(m.sheet ? { sheet: m.sheet } : {}) };
      const text = JSON.stringify([material, names]);
      const had = materials.get(m.id);
      if (had && had.text !== text) throw new Error(`${mesh.id}: material ${m.id} is described twice, and differently`);
      materials.set(m.id, { material, names, text });
    }
  }
  const out = [...textures.values()].sort(byId);
  for (const { material, names } of materials.values()) TEXTURE_ROLES.forEach((role, k) => setTexture(material, role, out.findIndex((t) => t.id === names[k])));
  return { textures: out, materials: [...materials.values()].map((m) => m.material).sort(byId) };
}

/**
 * A level's triangles as one run for each material, in the pack's order of materials, and the runs as PackLod lists
 * them. `place` is where the pack has each of the mesh's materials.
 */
function inSections(lod: SourceLod, place: readonly number[]): { indices: Uint32Array; sections: number[] } {
  const n = lod.indices.length / 3;
  // Counted out by material, each material's triangles in the order they came: a stable sort, at the cost of one pass.
  const of = new Int32Array(n);
  let most = 0;
  for (let t = 0; t < n; t++) most = Math.max(most, (of[t] = place[lod.sections?.[t] ?? 0]! + 1));
  const start = new Uint32Array(most + 2);
  for (let t = 0; t < n; t++) start[of[t]! + 1]!++;
  const sections: number[] = [];
  for (let m = 0; m <= most; m++) {
    if (start[m + 1]! > 0) sections.push(m - 1, start[m]! * 3, start[m + 1]! * 3);
    start[m + 1]! += start[m]!;
  }
  const indices = new Uint32Array(n * 3);
  const from = lod.indices;
  for (let t = 0; t < n; t++) {
    const k = start[of[t]!]!++ * 3;
    indices[k] = from[t * 3]!;
    indices[k + 1] = from[t * 3 + 1]!;
    indices[k + 2] = from[t * 3 + 2]!;
  }
  return { indices, sections };
}

/** Small details as a build carries them: the header's numbers, whose atlas offset is set when written, and the atlas. */
export interface SourceDetails {
  header: PackDetails;
  atlas: Uint8Array;
}

/** `landmarks` are the rows of the far meshes among `meshes` (tools/pack/far.ts), and `finishes` an asset's (shared/pack/finish.ts). */
export function buildPack(meshes: SourceMesh[], palette: Uint8Array, clips: readonly Clip[] = [], rigs: readonly PackRig[] = [], details: SourceDetails | null = null, landmarks: readonly LandmarkFarRow[] = [], finishes: readonly number[] = []): Uint8Array {
  const blob = new PackBlob();
  const append = (bytes: Uint8Array): number => blob.append(bytes);

  const header: PackHeader = { paletteOffset: append(palette), meshes: [], rigs: [...rigs].sort(byId), clips: [] };
  if (landmarks.length > 0) header.landmarks = [...landmarks];
  if (finishes.length > 0) header.finishes = [...finishes];
  if (details) header.details = { ...details.header, atlas: { ...details.header.atlas, offset: append(details.atlas) } };
  const sorted = [...meshes].sort(byId);
  const { materials, textures } = pool(sorted);
  if (materials.length > 0) header.materials = materials;
  if (textures.length > 0) header.textures = textures;
  for (const mesh of sorted) {
    if (mesh.lods.length === 0) throw new Error(`${mesh.id}: no geometry`);
    // One set of bounds for all levels, so they overlay exactly.
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const lod of mesh.lods) {
      for (let i = 0; i < lod.positions.length; i++) {
        const v = lod.positions[i]!;
        if (v < min[i % 3]!) min[i % 3] = v;
        if (v > max[i % 3]!) max[i % 3] = v;
      }
    }
    const center = min.map((lo, a) => (lo + max[a]!) / 2) as [number, number, number];
    const half = min.map((lo, a) => Math.max((max[a]! - lo) / 2, 1e-4)) as [number, number, number];
    const out: PackMesh = { id: mesh.id, center, half, lods: [] };
    if (mesh.collider) out.collider = mesh.collider;
    if (mesh.skeleton) out.skeleton = mesh.skeleton;
    if (mesh.rig) {
      out.rig = header.rigs.findIndex((r) => r.id === mesh.rig);
      if (out.rig < 0) throw new Error(`${mesh.id}: rig "${mesh.rig}" is not in the pack`);
    }
    const flat = surfaced(mesh);
    if (flat > 0) out.flat = flat;
    const range = uvRange(mesh.lods.slice(0, flat).map((lod) => lod.uvs));
    if (range) out.uv = range;
    const place = (mesh.materials ?? []).map((m) => materials.findIndex((p) => p.id === m.id));
    mesh.lods.forEach((lod, level) => {
      const n = lod.positions.length / 3;
      const verts = new Uint8Array(n * VERTEX_BYTES);
      const view = new DataView(verts.buffer);
      for (let v = 0; v < n; v++) {
        for (let a = 0; a < 3; a++) {
          const q = Math.round(((lod.positions[v * 3 + a]! - center[a]!) / half[a]!) * 32767);
          view.setInt16(v * VERTEX_BYTES + a * 2, q, true);
        }
        verts[v * VERTEX_BYTES + 6] = lod.colors[v]!;
        if (lod.bones) verts[v * VERTEX_BYTES + 7] = lod.bones[v]!;
      }
      if (mesh.skeleton && !lod.bones) throw new Error(`${mesh.id}: a mesh with a skeleton needs a bone for every vertex`);
      // A level drawn with materials has its triangles sorted by material, a cut-out material's best seen first (sprays.ts).
      // A flat one keeps the order it came in.
      const textured = level < flat ? inSections(lod, place) : null;
      if (textured) rankSprays(lod.positions, textured.indices, textured.sections, (m) => (materials[m]!.flags & MATERIAL_CUTOUT) !== 0);
      const indices = textured ? textured.indices : lod.indices;
      const indexBytes = n > 65535 ? 4 : 2;
      const idx = new Uint8Array(indices.length * indexBytes);
      const iview = new DataView(idx.buffer);
      indices.forEach((i, k) => (indexBytes === 4 ? iview.setUint32(k * 4, i, true) : iview.setUint16(k * 2, i, true)));
      const error = lod === mesh.lods[0] ? 0 : Math.round((lod.error ?? surfaceError(mesh.lods[0]!, lod)) * 1e5) / 1e5;
      // Indices and then vertices, so the level is one run of bytes. The surface and the skin go on the end of it.
      const indexOffset = append(idx);
      const made: PackLod = { vertexOffset: append(verts), vertexCount: n, indexOffset, indexCount: indices.length, indexBytes, error };
      if (textured) {
        const { uvs, normals } = lod;
        if (uvs?.length !== n * 2 || normals?.length !== n * 3) throw new Error(`${mesh.id}: a level drawn with materials needs a texture coordinate and a normal for every vertex`);
        const runs = textured.sections.length / 3;
        if (runs < 1 || runs > MOST_SECTIONS) throw new Error(`${mesh.id}: a level is drawn with ${runs} materials, and may be with 1 to ${MOST_SECTIONS}`);
        made.surfaceOffset = append(encodeSurface(uvs, normals, lod.tangents ?? tangentsOf({ positions: lod.positions, indices, uvs, normals }), out.uv));
        const skin = mesh.skeleton && lod.joints && lod.weights ? encodeSkin(lod.joints, lod.weights, lod.bones!, mesh.id) : null;
        // A skin whose every vertex is wholly on its own bone says no more than the vertices do.
        if (skin?.some((w, k) => k % SKIN_BYTES === 4 && w !== 255)) made.skinOffset = append(skin);
        made.sections = textured.sections;
      }
      out.lods.push(made);
    });
    header.meshes.push(out);
  }

  for (const clip of [...clips].sort(byId)) {
    const { rot, root } = encodeClip(clip);
    header.clips.push({ id: clip.id, bones: clip.bones, frames: clip.frames, loop: clip.loop, rotOffset: append(rot), rootOffset: append(root) });
  }

  return blob.file(header);
}

const zig = (d: number): number => ((d << 1) ^ (d >> 31)) >>> 0;

/** A clip's rotations and root as a pack stores them (shared/pack/pack.ts). */
export function encodeClip(clip: Clip): { rot: Uint8Array; root: Uint8Array } {
  const { bones, frames, rot: q } = clip;
  const n = frames * bones * 3;
  const rot = new Uint8Array(frames * clipRotBytes(bones));
  for (let b = 0, at = 0; b < bones; b++) {
    for (let a = 0; a < 3; a++) {
      for (let f = 0, last = 0, before = 0; f < frames; f++, at++) {
        const k = (f * bones + b) * 4;
        const l = Math.sqrt(q[k]! * q[k]! + q[k + 1]! * q[k + 1]! + q[k + 2]! * q[k + 2]! + q[k + 3]! * q[k + 3]!) || 1;
        const x = Math.round(((q[k + 3]! < 0 ? -q[k + a]! : q[k + a]!) / (l + Math.abs(q[k + 3]!))) * CLIP_ROT_STEPS);
        const d = zig(((x - (2 * last - before)) << 16) >> 16);
        rot[at] = d & 255;
        rot[at + n] = d >> 8;
        before = f === 0 ? x : last;
        last = x;
      }
    }
  }
  const m = frames * 3;
  const root = new Uint8Array(frames * CLIP_ROOT_BYTES);
  for (let a = 0, at = 0; a < 3; a++) {
    for (let f = 0, last = 0, before = 0; f < frames; f++, at++) {
      const x = Math.round(clip.root[f * 3 + a]! * CLIP_ROOT_STEPS);
      const d = zig((x - (2 * last - before)) | 0);
      for (let k = 0; k < 4; k++) root[at + k * m] = (d >>> (8 * k)) & 255;
      before = f === 0 ? x : last;
      last = x;
    }
  }
  return { rot, root };
}

/** The meshes of a pack back in authoring form, to put them into another pack. */
export function unpackMeshes(pack: Pack): SourceMesh[] {
  return pack.header.meshes.map((m) => {
    const lods = m.lods.map((lod, level): SourceLod => {
      const verts = lodVertices(pack, lod);
      const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
      const positions = new Float32Array(lod.vertexCount * 3);
      const colors = new Uint8Array(lod.vertexCount);
      const bones = new Uint8Array(lod.vertexCount);
      for (let v = 0; v < lod.vertexCount; v++) {
        for (let a = 0; a < 3; a++) positions[v * 3 + a] = m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
        colors[v] = verts[v * VERTEX_BYTES + 6]!;
        bones[v] = verts[v * VERTEX_BYTES + 7]!;
      }
      const out: SourceLod = { positions, colors, indices: readIndices(pack, lod) };
      if (m.skeleton) out.bones = bones;
      if (level > 0) out.error = lod.error;
      const surface = lodSurface(pack, lod);
      const skin = lodSkin(pack, lod);
      if (surface) Object.assign(out, decodeSurface(surface, m.uv), skin ? decodeSkin(skin) : {});
      return out;
    });
    const out: SourceMesh = { id: m.id, lods };
    if (m.collider) out.collider = m.collider;
    if (m.skeleton) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = pack.header.rigs[m.rig]!.id;
    if (m.flat === undefined) return out;
    // The mesh's own lists: the pack's materials that its sections name, and the textures those name.
    const all = pack.header.materials ?? [];
    const used = [...new Set(m.lods.flatMap((lod) => (lod.sections ?? []).filter((_, k) => k % 3 === 0)))].sort((a, b) => a - b);
    const named = [...new Set(used.flatMap((k) => TEXTURE_ROLES.map((role) => textureOf(all[k]!, role))).filter((t) => t >= 0))].sort((a, b) => a - b);
    out.flat = m.flat;
    out.materials = used.map((k) => {
      const material = { ...all[k]! };
      for (const role of TEXTURE_ROLES) setTexture(material, role, named.indexOf(textureOf(material, role)));
      return material;
    });
    out.textures = named.map((t) => ({ ...pack.header.textures![t]! }));
    m.lods.forEach((lod, level) => {
      const runs = lod.sections;
      if (!runs) return;
      const sections = (lods[level]!.sections = new Uint8Array(lod.indexCount / 3));
      for (let k = 0; k < runs.length; k += 3) sections.fill(used.indexOf(runs[k]!), runs[k + 1]! / 3, (runs[k + 1]! + runs[k + 2]!) / 3);
    });
    return out;
  });
}

/** One colour, outward-facing triangles. */
export function boxMesh(half: readonly [number, number, number], color: number): SourceLod {
  const [hx, hy, hz] = half;
  const positions: number[] = [];
  const indices: number[] = [];
  // Each face is a corner and two edge vectors whose cross product points outward.
  const faces: [number[], number[], number[]][] = [
    [[hx, -hy, -hz], [0, 2 * hy, 0], [0, 0, 2 * hz]], // +X
    [[-hx, -hy, hz], [0, 2 * hy, 0], [0, 0, -2 * hz]], // -X
    [[-hx, hy, -hz], [0, 0, 2 * hz], [2 * hx, 0, 0]], // +Y
    [[-hx, -hy, hz], [0, 0, -2 * hz], [2 * hx, 0, 0]], // -Y
    [[hx, -hy, hz], [0, 2 * hy, 0], [-2 * hx, 0, 0]], // +Z
    [[-hx, -hy, -hz], [0, 2 * hy, 0], [2 * hx, 0, 0]], // -Z
  ];
  for (const [o, u, v] of faces) {
    const base = positions.length / 3;
    positions.push(o[0]!, o[1]!, o[2]!);
    positions.push(o[0]! + u[0]!, o[1]! + u[1]!, o[2]! + u[2]!);
    positions.push(o[0]! + u[0]! + v[0]!, o[1]! + u[1]! + v[1]!, o[2]! + u[2]! + v[2]!);
    positions.push(o[0]! + v[0]!, o[1]! + v[1]!, o[2]! + v[2]!);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(24).fill(color), indices: Uint32Array.from(indices) };
}
