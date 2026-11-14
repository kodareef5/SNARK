// Splits a whole pack into the file a client fetches at start and the file it fetches a level at a time, and writes
// the manifest that says where every level is.

import { MANIFEST_VERSION, type Manifest, type ManifestFile, type ManifestLevel, type ManifestMesh } from "../../shared/pack/manifest.ts";
import { CLIP_ROOT_BYTES, VERTEX_BYTES, clipRotBytes, lodVertices, parsePack, type PackHeader, type PackLod } from "../../shared/pack/pack.ts";
import { partHash } from "./manifest.ts";
import { PackBlob } from "./write.ts";

/** A level of no more bytes than this goes in the boot file with the coarsest: asking for it alone would cost more than it weighs. */
export const BOOT_LEVEL_BYTES = 4096;

export interface SplitFile {
  name: string;
  role: ManifestFile["role"];
  bytes: Uint8Array;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/**
 * The boot file holds the palette, the rigs, the clips, the coarsest level of every mesh and every small level, so a
 * client that has it can draw everything, coarsely. The mesh file holds every other level. Both are packs. The bytes
 * of a level are what they were in the whole pack.
 */
export function splitPack(whole: Uint8Array, name: string): { files: SplitFile[]; manifest: Manifest } {
  const pack = parsePack(whole);
  const blobs = [new PackBlob(), new PackBlob()];
  const headers: PackHeader[] = blobs.map((b) => ({ paletteOffset: b.append(pack.palette), meshes: [], rigs: [], clips: [] }));
  headers[0]!.rigs = pack.header.rigs;
  /** Per mesh, per level: the file it went to and where in that file's blob. */
  const placed: { file: number; lod: PackLod; bytes: number }[][] = [];
  for (const m of pack.header.meshes) {
    const levels: { file: number; lod: PackLod; bytes: number }[] = [];
    m.lods.forEach((lod, level) => {
      const bytes = pad4(lod.indexCount * lod.indexBytes) + lod.vertexCount * VERTEX_BYTES;
      const file = level === m.lods.length - 1 || bytes <= BOOT_LEVEL_BYTES ? 0 : 1;
      const at = blobs[file]!.append(pack.blob.subarray(lod.indexOffset, lod.indexOffset + bytes));
      levels.push({ file, bytes, lod: { ...lod, indexOffset: at, vertexOffset: at + pad4(lod.indexCount * lod.indexBytes) } });
    });
    placed.push(levels);
    for (const file of [0, 1]) {
      const lods = levels.filter((l) => l.file === file).map((l) => l.lod);
      if (lods.length > 0) headers[file]!.meshes.push({ ...m, lods });
    }
  }
  for (const c of pack.header.clips) {
    const rot = pack.blob.subarray(c.rotOffset, c.rotOffset + c.frames * clipRotBytes(c.bones));
    const root = pack.blob.subarray(c.rootOffset, c.rootOffset + c.frames * CLIP_ROOT_BYTES);
    headers[0]!.clips.push({ ...c, rotOffset: blobs[0]!.append(rot), rootOffset: blobs[0]!.append(root) });
  }

  const files: SplitFile[] = [
    { name: `${name}.boot.snpk`, role: "boot", bytes: blobs[0]!.file(headers[0]!) },
    { name: `${name}.mesh.snpk`, role: "mesh", bytes: blobs[1]!.file(headers[1]!) },
  ];
  const blobAt = files.map((f) => parsePack(f.bytes).blobAt);
  const meshes = pack.header.meshes.map((m, i): ManifestMesh => {
    const out: ManifestMesh = { id: m.id, center: m.center, half: m.half, levels: [] };
    if (m.skeleton !== undefined) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = m.rig;
    if (m.skeleton !== undefined && m.lods[0]!.vertexCount > 0) out.bone = lodVertices(pack, m.lods[0]!)[7]!;
    out.levels = placed[i]!.map((l): ManifestLevel => {
      const at = blobAt[l.file]! + l.lod.indexOffset;
      const hash = partHash(files[l.file]!.bytes.subarray(at, at + l.bytes));
      return { file: l.file, at, verts: l.lod.vertexCount, tris: l.lod.indexCount / 3, index: l.lod.indexBytes, error: l.lod.error, parts: [{ bytes: l.bytes, hash }] };
    });
    return out;
  });
  const manifest: Manifest = { version: MANIFEST_VERSION, files: files.map((f) => ({ name: f.name, bytes: f.bytes.length, role: f.role })), boot: 0, clipHash: pack.clips.hash, meshes };
  return { files, manifest };
}
