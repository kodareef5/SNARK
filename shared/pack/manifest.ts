// The directory of the asset files: what meshes there are, how detailed each level is, and which bytes of which file
// hold it. A client reads this first and then asks for the levels it wants.

import { VERTEX_BYTES, lodVertices, type Pack } from "./pack.ts";

export const MANIFEST_VERSION = 1;

export interface ManifestFile {
  name: string;
  bytes: number;
  /** "boot" is fetched whole at start. The others are fetched a level at a time. */
  role: "boot" | "mesh" | "tex";
}

/** A run of bytes fetched together, and the first eight bytes of its SHA-256 in hex. "" where nobody has hashed it. */
export interface ManifestPart {
  bytes: number;
  hash: string;
}

export interface ManifestLevel {
  /** Index into `files`, and where in that file the level starts. */
  file: number;
  at: number;
  verts: number;
  tris: number;
  /** Bytes of one index. */
  index: 2 | 4;
  /** How far, in metres, its surface lies from the finest level's (see PackLod). */
  error: number;
  /** The first part is the indices and the vertices. */
  parts: ManifestPart[];
}

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
}

export interface Manifest {
  version: number;
  files: ManifestFile[];
  /** Index into `files` of the pack that holds the palette, the rigs and the clips. */
  boot: number;
  /** The hash of the clips, which a client and its server must share. */
  clipHash: number;
  meshes: ManifestMesh[];
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
    for (const lod of m.lods) {
      const bytes = pad4(lod.indexCount * lod.indexBytes) + lod.vertexCount * VERTEX_BYTES;
      if (lod.vertexOffset + lod.vertexCount * VERTEX_BYTES !== lod.indexOffset + bytes) throw new Error(`manifest: a level of ${m.id} is not one run of bytes`);
      const part = pack.blob.subarray(lod.indexOffset, lod.indexOffset + bytes);
      out.levels.push({ file: 0, at: pack.blobAt + lod.indexOffset, verts: lod.vertexCount, tris: lod.indexCount / 3, index: lod.indexBytes, error: lod.error, parts: [{ bytes, hash: hash(part) }] });
    }
    return out;
  });
  return { version: MANIFEST_VERSION, files: [{ name: file.name, bytes: file.bytes, role: "boot" }], boot: 0, clipHash: pack.clips.hash, meshes };
}

/** Throws with a reason if the text is not a manifest this build can use. */
export function parseManifest(text: string): Manifest {
  const m = JSON.parse(text) as Manifest;
  if (m.version !== MANIFEST_VERSION) throw new Error(`manifest: version ${String(m.version)} is not supported`);
  if (!Array.isArray(m.files) || !Array.isArray(m.meshes) || m.files[m.boot]?.role !== "boot") throw new Error("manifest: no boot pack");
  const seen = new Set<string>();
  for (const mesh of m.meshes) {
    if (typeof mesh.id !== "string" || seen.has(mesh.id)) throw new Error(`manifest: mesh "${String(mesh.id)}" is listed twice or has no id`);
    seen.add(mesh.id);
    if (!Array.isArray(mesh.levels) || mesh.levels.length === 0) throw new Error(`manifest: mesh ${mesh.id} has no level`);
    for (const level of mesh.levels) {
      const file = m.files[level.file];
      const bytes = Array.isArray(level.parts) ? level.parts.reduce((sum, p) => sum + p.bytes, 0) : NaN;
      if (!file || !(level.at >= 0) || !(level.at + bytes <= file.bytes)) throw new Error(`manifest: a level of ${mesh.id} lies outside its file`);
      if ((level.index !== 2 && level.index !== 4) || !(level.error >= 0)) throw new Error(`manifest: a level of ${mesh.id} is not described`);
      if (level.parts[0]!.bytes !== pad4(level.tris * 3 * level.index) + level.verts * VERTEX_BYTES) throw new Error(`manifest: a level of ${mesh.id} is not the size its counts give`);
    }
  }
  return m;
}
