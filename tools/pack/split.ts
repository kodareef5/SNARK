// Splits a whole pack into the file a client fetches at start, the file it fetches a level at a time, the file it
// fetches a creature skeleton's clips from and the file of pages, and writes the manifest that says where everything is.

import { MANIFEST_VERSION, type Manifest, type ManifestClips, type ManifestFile, type ManifestLevel, type ManifestMesh, type MeshStub, type PageRows } from "../../shared/pack/manifest.ts";
import { CLIP_ROOT_BYTES, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, clipRotBytes, detailsAtlas, lodVertices, parsePack, textureOf, type PackClip, type PackHeader, type PackLod } from "../../shared/pack/pack.ts";
import { PARTS_HEADER_BYTES, PARTS_MAGIC, PARTS_VERSION } from "../../shared/pack/stored.ts";
import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { partHash, partsAt } from "./manifest.ts";
import { PackBlob } from "./write.ts";

/**
 * A level of no more bytes than this is held with the coarsest, in the boot file or its mesh's page, and a skeleton's
 * clips of no more stay in the boot file: asking for either alone would cost more than it weighs.
 */
export const HELD_LEVEL_BYTES = 4096;
/** A page takes meshes until the levels it holds come to this many bytes. */
export const PAGE_BYTES = 24 * 1024;

export interface SplitFile {
  name: string;
  role: ManifestFile["role"];
  bytes: Uint8Array;
}

export interface SplitOptions {
  /** Whether the boot file holds a mesh's smallest levels. Each mesh it does not is in a page. Every mesh where not given. */
  boot?: (id: string) => boolean;
  /** Paged meshes go by this, least first and then as the pack has them, and meshes of two ranks share no page. */
  rank?: (id: string) => number;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** Where a level went. `surfaceAt` is where the mesh file's blob has its surface and skin when the boot file or a page has the rest of it, and -1 otherwise. */
interface Placed {
  /** 0 the boot file, 1 the mesh file, 2 a page. */
  file: number;
  lod: PackLod;
  sizes: number[];
  surfaceAt: number;
}

/**
 * The boot file holds the palette, the rigs, the survivor's clips, the details atlas and the smallest levels of the
 * meshes `boot` names: the coarsest and every one of HELD_LEVEL_BYTES or less, so a client that has it can draw those,
 * coarsely, and pose its own body. Each other mesh's smallest levels are in its page, with its row. Both hold them flat:
 * the surface and the skin of a level are always in the mesh file, with every other level. The boot and mesh files are
 * packs, though only the manifest says where the mesh file has the surface of a level held elsewhere. Each creature
 * skeleton's clips are one part of the clip file. Neither the clip file's parts nor the pages are yet deflated. The bytes
 * of a part are what they were in the whole pack. `blobs` are the pages' blobs.
 */
export function splitPack(whole: Uint8Array, name: string, opts: SplitOptions = {}): { files: SplitFile[]; manifest: Manifest; blobs: Uint8Array[] } {
  const pack = parsePack(whole);
  const isBoot = opts.boot ?? (() => true);
  const rank = opts.rank ?? (() => 0);
  const blobs = [new PackBlob(), new PackBlob()];
  const headers: PackHeader[] = blobs.map((b) => ({ paletteOffset: b.append(pack.palette), meshes: [], rigs: [], clips: [] }));
  headers[0]!.rigs = pack.header.rigs;
  // The sections in the mesh file name materials, so it lists them.
  if (pack.header.materials) headers[1]!.materials = pack.header.materials;
  if (pack.header.textures) headers[1]!.textures = pack.header.textures;
  const details = pack.header.details;
  if (details) headers[0]!.details = { ...details, atlas: { ...details.atlas, offset: blobs[0]!.append(detailsAtlas(pack)) } };
  const held = (m: (typeof pack.header.meshes)[number], level: number, bytes: number): boolean => level === m.lods.length - 1 || bytes <= HELD_LEVEL_BYTES;
  const firstBytes = (lod: PackLod): number => pad4(lod.indexCount * lod.indexBytes) + lod.vertexCount * VERTEX_BYTES;
  // Paged meshes by rank, each page as many as its bytes allow.
  const pageOf = new Int32Array(pack.header.meshes.length).fill(-1);
  const paged = pack.header.meshes.map((m, i) => i).filter((i) => !isBoot(pack.header.meshes[i]!.id));
  paged.sort((a, b) => rank(pack.header.meshes[a]!.id) - rank(pack.header.meshes[b]!.id) || a - b);
  const pages: PackBlob[] = [];
  let lastRank = NaN;
  let size = 0;
  for (const i of paged) {
    const m = pack.header.meshes[i]!;
    const bytes = m.lods.reduce((sum, lod, l) => sum + (held(m, l, firstBytes(lod)) ? pad4(firstBytes(lod)) : 0), 0);
    if (pages.length === 0 || rank(m.id) !== lastRank || (size > 0 && size + bytes > PAGE_BYTES)) {
      pages.push(new PackBlob());
      size = 0;
    }
    lastRank = rank(m.id);
    size += bytes;
    pageOf[i] = pages.length - 1;
  }
  const placed: Placed[][] = [];
  pack.header.meshes.forEach((m, i) => {
    const levels: Placed[] = [];
    m.lods.forEach((lod, level) => {
      const sizes = [firstBytes(lod)];
      if (lod.surfaceOffset !== undefined) sizes.push(lod.vertexCount * SURFACE_BYTES);
      if (lod.skinOffset !== undefined) sizes.push(lod.vertexCount * SKIN_BYTES);
      const bytes = sizes[0]!;
      const rest = (sizes[1] ?? 0) + (sizes[2] ?? 0);
      const file = !held(m, level, bytes) ? 1 : pageOf[i]! < 0 ? 0 : 2;
      const blob = file === 2 ? pages[pageOf[i]!]! : blobs[file]!;
      const at = blob.append(pack.blob.subarray(lod.indexOffset, lod.indexOffset + bytes + (file === 1 ? rest : 0)));
      const surfaceAt = file !== 1 && rest > 0 ? blobs[1]!.append(pack.blob.subarray(lod.indexOffset + bytes, lod.indexOffset + bytes + rest)) : -1;
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
  });
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
    if (bytes <= HELD_LEVEL_BYTES) continue;
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
  const pageFile = files.length;
  const pageBlobs = pages.map(joined);
  if (pages.length > 0) files.push({ name: `${name}.page.snpt`, role: "page", bytes: new Uint8Array(PARTS_HEADER_BYTES) });
  const blobAt = files.slice(0, 2).map((f) => parsePack(f.bytes).blobAt);
  const meshes = pack.header.meshes.map((m, i): ManifestMesh => {
    const out: ManifestMesh = { id: m.id, center: m.center, half: m.half, levels: [] };
    if (m.skeleton !== undefined) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = m.rig;
    if (m.skeleton !== undefined && m.lods[0]!.vertexCount > 0) out.bone = lodVertices(pack, m.lods[0]!)[7]!;
    if (m.flat !== undefined) out.flat = m.flat;
    if (m.uv !== undefined) out.uv = m.uv;
    if (pageOf[i]! >= 0) out.page = pageOf[i]!;
    out.levels = placed[i]!.map((l, k): ManifestLevel => {
      const inPage = l.file === 2;
      const at = inPage ? l.lod.indexOffset : blobAt[l.file]! + l.lod.indexOffset;
      const first = inPage ? partsAt(pageBlobs[pageOf[i]!]!, at, l.sizes.slice(0, 1)) : partsAt(files[l.file]!.bytes, at, l.surfaceAt < 0 ? l.sizes : l.sizes.slice(0, 1));
      const level: ManifestLevel = { file: inPage ? pageFile : l.file, at, verts: l.lod.vertexCount, tris: l.lod.indexCount / 3, index: l.lod.indexBytes, error: l.lod.error, parts: first };
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
  if (pages.length > 0) {
    manifest.pages = pages.map(() => ({ file: pageFile, at: 0, part: { bytes: 0, hash: "" } }));
    files[pageFile]!.bytes = writePages(manifest, pageBlobs);
  }
  return { files, manifest, blobs: pageBlobs };
}

/** A blob's bytes as one array. */
function joined(b: PackBlob): Uint8Array {
  const out = new Uint8Array(b.size);
  let at = 0;
  for (const p of b.parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The rows page `p` holds: its meshes', the materials their sections name and the textures those name. */
function pageRows(m: Manifest, p: number): PageRows {
  const meshes = m.meshes.flatMap((mesh, i): [number, ManifestMesh][] => (mesh.page === p ? [[i, mesh]] : []));
  const materials = [...new Set(meshes.flatMap(([, mesh]) => mesh.levels.flatMap((l) => (l.sections ?? []).filter((_, k) => k % 3 === 0))))].sort((a, b) => a - b);
  const textures = [...new Set(materials.flatMap((k) => TEXTURE_ROLES.map((role) => textureOf(m.materials![k]!, role)).filter((t) => t >= 0)))].sort((a, b) => a - b);
  return { meshes, materials: materials.map((k) => [k, m.materials![k]!]), textures: textures.map((t) => [t, m.textures![t]!]) };
}

/**
 * The page file as the manifest's rows now stand: each page its rows as JSON and its blob, one after another behind a
 * parts header, with `pages` saying where each is and its hash. Rows say where everything else is, so this is written
 * again once the other files are stored.
 */
export function writePages(m: Manifest, blobs: readonly Uint8Array[]): Uint8Array {
  const pages = blobs.map((blob, p) => {
    const json = new TextEncoder().encode(JSON.stringify(pageRows(m, p)));
    const bytes = new Uint8Array(4 + pad4(json.length) + blob.length).fill(0x20, 4 + json.length, 4 + pad4(json.length));
    new DataView(bytes.buffer).setUint32(0, json.length, true);
    bytes.set(json, 4);
    bytes.set(blob, 4 + pad4(json.length));
    return bytes;
  });
  const out = new Uint8Array(pages.reduce((sum, p) => sum + p.length, PARTS_HEADER_BYTES));
  new DataView(out.buffer).setUint32(0, PARTS_MAGIC, true);
  new DataView(out.buffer).setUint16(4, PARTS_VERSION, true);
  let at = PARTS_HEADER_BYTES;
  pages.forEach((bytes, p) => {
    out.set(bytes, at);
    const file = m.pages![p]!.file;
    m.pages![p] = { file, at, part: { bytes: bytes.length, hash: partHash(bytes) } };
    at += bytes.length;
  });
  m.files[m.pages![0]!.file]!.bytes = out.length;
  return out;
}

/**
 * The manifest as a client first reads it: in full, the rows of the meshes the boot file holds and of the materials and
 * textures one of those, or none of the paged, is drawn with; every other mesh a stub and every other material and
 * texture null, its row in a page.
 */
export function bootManifest(m: Manifest): unknown {
  const paged = new Set<number>();
  const kept = new Set<number>();
  for (const mesh of m.meshes) for (const l of mesh.levels) for (let k = 0; k < (l.sections?.length ?? 0); k += 3) (mesh.page === undefined ? kept : paged).add(l.sections![k]!);
  const away = (k: number): boolean => paged.has(k) && !kept.has(k);
  const textures = new Set<number>();
  const named = new Set<number>();
  (m.materials ?? []).forEach((mat, k) => {
    for (const role of TEXTURE_ROLES) {
      const t = textureOf(mat, role);
      if (t < 0) continue;
      named.add(t);
      if (!away(k)) textures.add(t);
    }
  });
  const meshes = m.meshes.map((mesh): ManifestMesh | MeshStub => {
    if (mesh.page === undefined) return mesh;
    const stub: MeshStub = { id: mesh.id, page: mesh.page, count: mesh.levels.length };
    if (mesh.skeleton !== undefined) stub.skeleton = mesh.skeleton;
    if (mesh.rig !== undefined) stub.rig = mesh.rig;
    if (mesh.bone !== undefined) stub.bone = mesh.bone;
    return stub;
  });
  const out: Record<string, unknown> = { ...m, meshes };
  if (m.materials) out.materials = m.materials.map((mat, k) => (away(k) ? null : mat));
  if (m.textures) out.textures = m.textures.map((t, k) => (named.has(k) && !textures.has(k) ? null : t));
  delete out.sounds;
  return out;
}
