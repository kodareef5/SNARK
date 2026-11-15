// The directory of the asset files: what meshes there are, how detailed each level is, and which bytes of which file
// hold it. A client reads this first and then asks for the levels it wants.

import { MOST_SECTIONS, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodVertices, type Pack, type PackMaterial } from "./pack.ts";
import { soundFault, type ManifestSound } from "./sound.ts";
import { TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_ROLES, stepBytes, stepOf, topIn, type TextureFormat, type TextureRole } from "./texture.ts";

/**
 * Versions 1 and 2 are still read. Version 2 had no part stored deflated. Version 1 had flat levels only, and no
 * materials or textures.
 */
export const MANIFEST_VERSION = 3;

export interface ManifestFile {
  name: string;
  bytes: number;
  /** "boot" is fetched whole at start. The others are fetched a level, a step or a sound at a time. */
  role: "boot" | "mesh" | "tex" | "sound";
  /** For a texture file, the variant it holds. */
  format?: TextureFormat;
}

/**
 * A run of bytes fetched together, and the first eight bytes of its SHA-256 in hex. "" where nobody has hashed it.
 * `bytes` and the hash are of the part as its counts give it. A part stored deflated says how many bytes it is stored
 * in, fewer than `bytes` (shared/pack/stored.ts).
 */
export interface ManifestPart {
  bytes: number;
  hash: string;
  stored?: number;
}

/** Bytes of a part in its file. */
export const storedBytes = (p: ManifestPart): number => p.stored ?? p.bytes;

export interface ManifestLevel {
  /** Index into `files`, and where in that file the level starts. Its parts follow one another there, as stored. */
  file: number;
  at: number;
  verts: number;
  tris: number;
  /** Bytes of one index. */
  index: 2 | 4;
  /** How far, in metres, its surface lies from the finest level's (see PackLod). */
  error: number;
  /** The first part is the indices and the vertices. A level drawn with materials has a second, its surface, and may have a third, its skin. */
  parts: ManifestPart[];
  /** Where the parts after the first are, when they do not follow it: the boot file holds first parts only. */
  surface?: { file: number; at: number };
  /** See PackLod. The materials are indices into the manifest's. */
  sections?: number[];
}

/** A texture, and where each variant that was built keeps it. */
export interface ManifestTexture {
  id: string;
  role: TextureRole;
  /** The side of the largest picture, in pixels. The rgba variant stops at 1024. */
  top: number;
  /**
   * Per variant: index into `files`, where in that file the texture starts, and the hash of each step. Where any step
   * is stored deflated, `stored` gives the bytes each step is stored in, and the steps follow one another as stored.
   */
  in: Partial<Record<TextureFormat, ManifestVariant>>;
}

export interface ManifestVariant {
  file: number;
  at: number;
  hash: string[];
  stored?: number[];
}

/** Bytes of a step of a texture in its file. */
export const storedStep = (v: ManifestVariant, format: TextureFormat, role: TextureRole, step: number): number => v.stored?.[step] ?? stepBytes(format, role, step);

export interface ManifestMesh {
  id: string;
  center: [number, number, number];
  half: [number, number, number];
  skeleton?: string;
  /** Index into the boot pack's rigs. */
  rig?: number;
  /** For a mesh whose every vertex follows one bone (a held item), that bone. */
  bone?: number;
  /** Finest first. */
  levels: ManifestLevel[];
  /** The first level that is flat (see PackMesh). Absent when every level is. */
  flat?: number;
  /** What a stored texture coordinate spans (see PackMesh). */
  uv?: [number, number, number, number];
}

export interface Manifest {
  version: number;
  files: ManifestFile[];
  /** Index into `files` of the pack that holds the palette, the rigs and the clips. */
  boot: number;
  /** The hash of the clips, which a client and its server must share. */
  clipHash: number;
  meshes: ManifestMesh[];
  materials?: PackMaterial[];
  textures?: ManifestTexture[];
  /** Sounds, in a file of their own (shared/pack/sound.ts). */
  sounds?: ManifestSound[];
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** The manifest of one pack that holds everything. `hash` is given by tools, which can hash, and left out by the client. */
export function describePack(pack: Pack, file: { name: string; bytes: number }, hash: (part: Uint8Array) => string = () => ""): Manifest {
  const meshes = pack.header.meshes.map((m): ManifestMesh => {
    const out: ManifestMesh = { id: m.id, center: m.center, half: m.half, levels: [] };
    if (m.skeleton !== undefined) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = m.rig;
    // Every vertex of a one-bone mesh names the same bone, so the first says which.
    if (m.skeleton !== undefined && m.lods[0]!.vertexCount > 0) out.bone = lodVertices(pack, m.lods[0]!)[7]!;
    if (m.flat !== undefined) out.flat = m.flat;
    if (m.uv !== undefined) out.uv = m.uv;
    for (const lod of m.lods) {
      const sizes = [pad4(lod.indexCount * lod.indexBytes) + lod.vertexCount * VERTEX_BYTES];
      if (lod.surfaceOffset !== undefined) sizes.push(lod.vertexCount * SURFACE_BYTES);
      if (lod.skinOffset !== undefined) sizes.push(lod.vertexCount * SKIN_BYTES);
      const starts = [lod.indexOffset, lod.surfaceOffset, lod.skinOffset];
      const parts: ManifestPart[] = [];
      let at = lod.indexOffset;
      sizes.forEach((bytes, k) => {
        if (starts[k] !== at || (k === 0 && lod.vertexOffset + lod.vertexCount * VERTEX_BYTES !== at + bytes)) throw new Error(`manifest: a level of ${m.id} is not one run of bytes`);
        parts.push({ bytes, hash: hash(pack.blob.subarray(at, at + bytes)) });
        at += bytes;
      });
      const level: ManifestLevel = { file: 0, at: pack.blobAt + lod.indexOffset, verts: lod.vertexCount, tris: lod.indexCount / 3, index: lod.indexBytes, error: lod.error, parts };
      if (lod.sections) level.sections = lod.sections;
      out.levels.push(level);
    }
    return out;
  });
  const out: Manifest = { version: MANIFEST_VERSION, files: [{ name: file.name, bytes: file.bytes, role: "boot" }], boot: 0, clipHash: pack.clips.hash, meshes };
  if (pack.header.materials) out.materials = pack.header.materials;
  // A pack names its textures and holds none of their pixels, so no variant is listed here. The build adds them.
  if (pack.header.textures) out.textures = pack.header.textures.map((t) => ({ ...t, in: {} }));
  return out;
}

/** Throws with a reason if the text is not a manifest this build can use. */
export function parseManifest(text: string): Manifest {
  const m = JSON.parse(text) as Manifest;
  if (m.version !== MANIFEST_VERSION && m.version !== 2 && m.version !== 1) throw new Error(`manifest: version ${String(m.version)} is not supported`);
  if (!Array.isArray(m.files) || !Array.isArray(m.meshes) || m.files[m.boot]?.role !== "boot") throw new Error("manifest: no boot pack");
  const textures = m.textures ?? [];
  const materials = m.materials ?? [];
  for (const t of textures) {
    if (typeof t.id !== "string" || !TEXTURE_ROLES.includes(t.role) || stepOf(t.top) < 0) throw new Error(`manifest: texture "${String(t.id)}" is not described`);
    for (const format of TEXTURE_FORMATS) {
      const v = t.in?.[format];
      if (!v) continue;
      const file = m.files[v.file];
      const top = topIn(format, t.top);
      if (file?.role !== "tex" || file.format !== format) throw new Error(`manifest: texture ${t.id} names a file that does not hold ${format}`);
      if (!Array.isArray(v.hash) || v.hash.length !== stepOf(top) + 1) throw new Error(`manifest: texture ${t.id} does not have a hash for every step`);
      if (v.stored && (v.stored.length !== v.hash.length || v.stored.some((s, k) => !(s > 0 && s <= stepBytes(format, t.role, k))))) throw new Error(`manifest: texture ${t.id} says it is stored in more bytes than it has`);
      const bytes = v.hash.reduce((sum, _, k) => sum + storedStep(v, format, t.role, k), 0);
      if (!(v.at >= TEXTURE_HEADER_BYTES) || !(v.at + bytes <= file.bytes)) throw new Error(`manifest: texture ${t.id} lies outside its file`);
    }
  }
  for (const mat of materials) {
    mat.mask2 ??= -1;
    for (const t of [mat.base, mat.normal, mat.mro, mat.mask, mat.mask2]) if (!(t >= -1 && t < textures.length)) throw new Error(`manifest: material ${mat.id} names a texture that is not there`);
  }
  const sounds = m.sounds ? soundFault(m.sounds, m.files) : "";
  if (sounds !== "") throw new Error(`manifest: ${sounds}`);
  const seen = new Set<string>();
  for (const mesh of m.meshes) {
    if (typeof mesh.id !== "string" || seen.has(mesh.id)) throw new Error(`manifest: mesh "${String(mesh.id)}" is listed twice or has no id`);
    seen.add(mesh.id);
    if (!Array.isArray(mesh.levels) || mesh.levels.length === 0) throw new Error(`manifest: mesh ${mesh.id} has no level`);
    const flat = mesh.flat ?? 0;
    if (!(flat >= 0 && flat <= mesh.levels.length)) throw new Error(`manifest: mesh ${mesh.id} turns flat at a level it does not have`);
    mesh.levels.forEach((level, at) => {
      const file = m.files[level.file];
      const parts = Array.isArray(level.parts) ? level.parts : [];
      if (parts.some((p) => p.stored !== undefined && !(p.stored > 0 && p.stored < p.bytes))) throw new Error(`manifest: a part of a level of ${mesh.id} says it is stored in as many bytes as it has, or more`);
      const bytes = parts.reduce((sum, p) => sum + storedBytes(p), 0);
      const first = level.surface && parts[0] ? storedBytes(parts[0]) : bytes;
      if (!file || parts.length === 0 || !(level.at >= 0) || !(level.at + first <= file.bytes)) throw new Error(`manifest: a level of ${mesh.id} lies outside its file`);
      if (level.surface && !(level.surface.at >= 0 && level.surface.at + bytes - first <= (m.files[level.surface.file]?.bytes ?? -1))) throw new Error(`manifest: the surface of a level of ${mesh.id} lies outside its file`);
      if ((level.index !== 2 && level.index !== 4) || !(level.error >= 0)) throw new Error(`manifest: a level of ${mesh.id} is not described`);
      const sizes = [pad4(level.tris * 3 * level.index) + level.verts * VERTEX_BYTES, level.verts * SURFACE_BYTES, level.verts * SKIN_BYTES];
      if (parts.length > 3 || parts.some((p, k) => p.bytes !== sizes[k])) throw new Error(`manifest: a level of ${mesh.id} is not the size its counts give`);
      if (parts.length > 1 !== at < flat) throw new Error(`manifest: mesh ${mesh.id} does not turn flat where it says`);
      const runs = level.sections ?? [];
      let next = 0;
      for (let k = 0; k < runs.length; k += 3) {
        if (!(runs[k]! >= 0 && runs[k]! < materials.length) || runs[k + 1] !== next || !(runs[k + 2]! > 0)) throw new Error(`manifest: a level of ${mesh.id} has a section that does not fit`);
        next += runs[k + 2]!;
      }
      if (parts.length > 1 ? runs.length === 0 || runs.length > MOST_SECTIONS * 3 || next !== level.tris * 3 : runs.length > 0) throw new Error(`manifest: the sections of a level of ${mesh.id} do not cover it`);
    });
  }
  return m;
}
