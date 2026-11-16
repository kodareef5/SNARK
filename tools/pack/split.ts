// Splits a whole pack into the file a client fetches at start, the file it fetches a level at a time and the file it
// fetches a creature skeleton's clips from, and writes the manifest that says where every level and clip is.

import { MANIFEST_VERSION, type Manifest, type ManifestClips, type ManifestFile, type ManifestLevel, type ManifestMesh } from "../../shared/pack/manifest.ts";
import { CLIP_ROOT_BYTES, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, clipRotBytes, detailsAtlas, lodVertices, parsePack, type PackClip, type PackHeader, type PackLod } from "../../shared/pack/pack.ts";
import { PARTS_HEADER_BYTES, PARTS_MAGIC, PARTS_VERSION } from "../../shared/pack/stored.ts";
import { partsAt } from "./manifest.ts";
import { PackBlob } from "./write.ts";

/**
 * A level of no more bytes than this goes in the boot file with the coarsest, and a skeleton's clips of no more stay
 * in it: asking for either alone would cost more than it weighs.
 */
export const BOOT_LEVEL_BYTES = 4096;

export interface SplitFile {
  name: string;
  role: ManifestFile["role"];
  bytes: Uint8Array;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** Where a level went. `surfaceAt` is where the mesh file's blob has its surface and skin when the boot file has the rest of it, and -1 otherwise. */
interface Placed {
  file: number;
  lod: PackLod;
  sizes: number[];
  surfaceAt: number;
}

/**
 * The boot file holds the palette, the rigs, the survivor's clips, the coarsest level of every mesh and every small
 * level, so a client that has it can draw everything, coarsely, and pose its own body. It holds them flat: the surface
 * and the skin of a level are always in the mesh file, with every other level. Both are packs, though only the manifest
 * says where the mesh file has the surface of a level that is in the boot file. Each creature skeleton's clips are one
 * part of the clip file, a file of parts none of which is yet deflated. The bytes of a part are what they were in the
 * whole pack.
 */
export function splitPack(whole: Uint8Array, name: string): { files: SplitFile[]; manifest: Manifest } {
  const pack = parsePack(whole);
  const blobs = [new PackBlob(), new PackBlob()];
  const headers: PackHeader[] = blobs.map((b) => ({ paletteOffset: b.append(pack.palette), meshes: [], rigs: [], clips: [] }));
  headers[0]!.rigs = pack.header.rigs;
  // The sections in the mesh file name materials, so it lists them.
  if (pack.header.materials) headers[1]!.materials = pack.header.materials;
  if (pack.header.textures) headers[1]!.textures = pack.header.textures;
  const details = pack.header.details;
  if (details) headers[0]!.details = { ...details, atlas: { ...details.atlas, offset: blobs[0]!.append(detailsAtlas(pack)) } };
  const placed: Placed[][] = [];
  for (const m of pack.header.meshes) {
    const levels: Placed[] = [];
    m.lods.forEach((lod, level) => {
      const sizes = [pad4(lod.indexCount * lod.indexBytes) + lod.vertexCount * VERTEX_BYTES];
      if (lod.surfaceOffset !== undefined) sizes.push(lod.vertexCount * SURFACE_BYTES);
      if (lod.skinOffset !== undefined) sizes.push(lod.vertexCount * SKIN_BYTES);
      const bytes = sizes[0]!;
      const rest = (sizes[1] ?? 0) + (sizes[2] ?? 0);
      const file = level === m.lods.length - 1 || bytes <= BOOT_LEVEL_BYTES ? 0 : 1;
      const at = blobs[file]!.append(pack.blob.subarray(lod.indexOffset, lod.indexOffset + bytes + (file === 1 ? rest : 0)));
      const surfaceAt = file === 0 && rest > 0 ? blobs[1]!.append(pack.blob.subarray(lod.indexOffset + bytes, lod.indexOffset + bytes + rest)) : -1;
      const { surfaceOffset, skinOffset, sections, ...flat } = lod;
      const moved: PackLod = { ...(file === 1 ? lod : flat), indexOffset: at, vertexOffset: at + pad4(lod.indexCount * lod.indexBytes) };
      if (file === 1 && surfaceOffset !== undefined) moved.surfaceOffset = at + bytes;
      if (file === 1 && skinOffset !== undefined) moved.skinOffset = at + bytes + sizes[1]!;
      levels.push({ file, lod: moved, sizes, surfaceAt });
    });
    placed.push(levels);
    const { flat: _, ...mesh } = m;
    for (const file of [0, 1]) {
      const lods = levels.filter((l) => l.file === file).map((l) => l.lod);
      // A file's levels are the mesh's own in the same order, so those with a surface still come first.
      const surfaced = lods.filter((l) => l.surfaceOffset !== undefined).length;
      if (lods.length > 0) headers[file]!.meshes.push(surfaced > 0 ? { ...mesh, lods, flat: surfaced } : { ...mesh, lods });
    }
  }
  const rot = (c: PackClip): Uint8Array => pack.blob.subarray(c.rotOffset, c.rotOffset + c.frames * clipRotBytes(c.bones));
  const root = (c: PackClip): Uint8Array => pack.blob.subarray(c.rootOffset, c.rootOffset + c.frames * CLIP_ROOT_BYTES);
  const rigOf = (c: PackClip): string => c.id.slice(0, c.id.lastIndexOf("/"));
  const skeletons = new Map<string, PackClip[]>();
  for (const r of pack.header.rigs) if (r.names) skeletons.set(r.id, []);
  for (const c of pack.header.clips) skeletons.get(rigOf(c))?.push(c);
  const parts: Uint8Array[] = [];
  const streamed: ManifestClips[] = [];
  let end = PARTS_HEADER_BYTES;
  for (const [rig, list] of skeletons) {
    const bytes = list.reduce((sum, c) => sum + c.frames * (clipRotBytes(c.bones) + CLIP_ROOT_BYTES), 0);
    if (bytes <= BOOT_LEVEL_BYTES) continue;
    const part = new Uint8Array(bytes);
    let at = 0;
    for (const c of list) {
      for (const run of [rot(c), root(c)]) {
        part.set(run, at);
        at += run.length;
      }
    }
    streamed.push({ rig, file: 2, at: end, part: { bytes, hash: "" }, clips: list.map(({ id, bones, frames, loop }) => ({ id, bones, frames, loop })) });
    parts.push(part);
    end += bytes;
  }
  const away = new Set(streamed.map((e) => e.rig));
  for (const c of pack.header.clips) if (!away.has(rigOf(c))) headers[0]!.clips.push({ ...c, rotOffset: blobs[0]!.append(rot(c)), rootOffset: blobs[0]!.append(root(c)) });

  const files: SplitFile[] = [
    { name: `${name}.boot.snpk`, role: "boot", bytes: blobs[0]!.file(headers[0]!) },
    { name: `${name}.mesh.snpk`, role: "mesh", bytes: blobs[1]!.file(headers[1]!) },
  ];
  if (streamed.length > 0) {
    const bytes = new Uint8Array(end);
    new DataView(bytes.buffer).setUint32(0, PARTS_MAGIC, true);
    new DataView(bytes.buffer).setUint16(4, PARTS_VERSION, true);
    parts.forEach((p, k) => bytes.set(p, streamed[k]!.at));
    for (const e of streamed) e.part.hash = partsAt(bytes, e.at, [e.part.bytes])[0]!.hash;
    files.push({ name: `${name}.clip.snpt`, role: "clip", bytes });
  }
  const blobAt = files.slice(0, 2).map((f) => parsePack(f.bytes).blobAt);
  const meshes = pack.header.meshes.map((m, i): ManifestMesh => {
    const out: ManifestMesh = { id: m.id, center: m.center, half: m.half, levels: [] };
    if (m.skeleton !== undefined) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = m.rig;
    if (m.skeleton !== undefined && m.lods[0]!.vertexCount > 0) out.bone = lodVertices(pack, m.lods[0]!)[7]!;
    if (m.flat !== undefined) out.flat = m.flat;
    if (m.uv !== undefined) out.uv = m.uv;
    out.levels = placed[i]!.map((l, k): ManifestLevel => {
      const at = blobAt[l.file]! + l.lod.indexOffset;
      const level: ManifestLevel = { file: l.file, at, verts: l.lod.vertexCount, tris: l.lod.indexCount / 3, index: l.lod.indexBytes, error: l.lod.error, parts: partsAt(files[l.file]!.bytes, at, l.surfaceAt < 0 ? l.sizes : l.sizes.slice(0, 1)) };
      if (l.surfaceAt >= 0) {
        level.surface = { file: 1, at: blobAt[1]! + l.surfaceAt };
        level.parts.push(...partsAt(files[1]!.bytes, level.surface.at, l.sizes.slice(1)));
      }
      const sections = m.lods[k]!.sections;
      if (sections) level.sections = sections;
      return level;
    });
    return out;
  });
  const manifest: Manifest = { version: MANIFEST_VERSION, files: files.map((f) => ({ name: f.name, bytes: f.bytes.length, role: f.role })), boot: 0, clipHash: pack.clips.hash, meshes };
  if (streamed.length > 0) manifest.clips = streamed;
  if (pack.header.materials) manifest.materials = pack.header.materials;
  if (pack.header.textures) manifest.textures = pack.header.textures.map((t) => ({ ...t, in: {} }));
  return { files, manifest };
}
