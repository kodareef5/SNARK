// The directory of the asset files: what meshes there are, how detailed each level is, and which bytes of which file
// hold it. A client reads this first and then asks for the levels it wants.
//
// What a client reads first names every mesh and holds in full only the rows of the meshes the boot pack holds. Every
// other mesh's row is in a page, with the rows of the materials and textures it is drawn with and the first parts of
// its smallest levels, and a client knows of the mesh only its id, its page, how many levels it has and what it hangs
// on until that page has come. A page's bytes:
//
//   0   u32 bytes of its rows as JSON (PageRows)
//   4   the JSON, padded with spaces to a multiple of 4
//   ..  its blob: the first parts of the levels it holds, each from a multiple of 4. Such a level's `at` is where in
//       the blob it starts.

import type { ClipSet } from "../anim/clip.ts";
import type { LandmarkFarRow } from "./far.ts";
import { checkIcons, type ManifestIcons } from "./icons.ts";
import { CLIP_ROOT_BYTES, MOST_SECTIONS, SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, clipRotBytes, decodeClips, decodeUtf8, lodVertices, type Pack, type PackClip, type PackMaterial } from "./pack.ts";
import { soundFault, type ManifestSound } from "./sound.ts";
import { unfilterPart } from "./stored.ts";
import { ASTC_BLOCKS, STEP0_SIZE, TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_ROLES, blockOf, stepBytes, stepOf, topIn, type TextureFormat, type TextureRole } from "./texture.ts";

/** Raised whenever the form changes: a build reads only its own. */
export const MANIFEST_VERSION = 7;

export interface ManifestFile {
  name: string;
  bytes: number;
  /**
   * "boot" is fetched whole at start. "mesh", "page", "tex", "clip" and "sound" are fetched a level, a page, a step, a
   * skeleton's clips or a sound at a time. "icon" is a PNG sheet of inventory pictures (shared/pack/icons.ts), fetched
   * whole when one of its pictures is first shown.
   */
  role: "boot" | "mesh" | "page" | "tex" | "clip" | "icon" | "sound";
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
  /**
   * Index into `files`, and where in that file the level starts. Its parts follow one another there, as stored. In a
   * page file, where in its mesh's page's blob its first part is.
   */
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
  /** Where the parts after the first are, when they do not follow it: the boot file and a page hold first parts only. */
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
   * `block` is the side of an astc texture's blocks in pixels, where it is not 4.
   */
  in: Partial<Record<TextureFormat, ManifestVariant>>;
}

export interface ManifestVariant {
  file: number;
  at: number;
  hash: string[];
  stored?: number[];
  block?: number;
}

/** Bytes of a step of a texture in its file. */
export const storedStep = (v: ManifestVariant, format: TextureFormat, role: TextureRole, step: number): number => v.stored?.[step] ?? stepBytes(format, role, step, blockOf(format, v));

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
  /** Drawn see-through (see PackMesh). */
  seeThrough?: boolean;
  /** The page that holds its row and its smallest levels. Absent for a mesh the boot pack holds. */
  page?: number;
}

/** How what a client reads first names a mesh whose row is in a page: what binds content to it and what it hangs on. */
export interface MeshStub {
  id: string;
  page: number;
  /** How many levels it has. */
  count: number;
  skeleton?: string;
  rig?: number;
  bone?: number;
}

/** One part of the page file (see the top of this file). */
export interface ManifestPage {
  file: number;
  at: number;
  part: ManifestPart;
}

/** The rows a page holds, each with its index in the manifest. */
export interface PageRows {
  meshes: [number, ManifestMesh][];
  materials: [number, PackMaterial][];
  textures: [number, ManifestTexture][];
}

/**
 * A creature skeleton's clips: a part of the clip file, asked for in the first frame a body of that skeleton is drawn. The
 * boot pack holds the survivor's and any skeleton's of 4 KB or less (tools/pack/split.ts). Its part holds each clip's
 * rotations and then its root, as a pack stores them, one clip after another in the order listed.
 */
export interface ManifestClips {
  /** The rig they are for, as the boot pack's rigs name it. */
  rig: string;
  file: number;
  at: number;
  part: ManifestPart;
  clips: { id: string; bones: number; frames: number; loop: boolean }[];
}

export interface Manifest {
  version: number;
  files: ManifestFile[];
  /** Index into `files` of the pack that holds the palette, the rigs and the clips the first frame poses with. */
  boot: number;
  /** The hash of every clip, the boot pack's and those listed in `clips`, which a client and its server must share. */
  clipHash: number;
  /** Every mesh. One whose page has not come is a stand-in (`placeholderMesh`) until it does. */
  meshes: ManifestMesh[];
  pages?: ManifestPage[];
  clips?: ManifestClips[];
  /** Every material and texture, those a page holds as stand-ins until it comes. */
  materials?: PackMaterial[];
  textures?: ManifestTexture[];
  /** Sounds, in a file of their own (shared/pack/sound.ts), listed in `soundRows`, a JSON file beside this. */
  sounds?: ManifestSound[];
  soundRows?: string;
  /** The inventory pictures. A manifest without them has none. */
  icons?: ManifestIcons;
  /** The colour far blocks draw each palette colour in (client/core/render/far.ts), worked out by the build from every piece. */
  farColours?: number[];
  /** Each landmark's far mesh (shared/pack/far.ts), read by `landmarkFars`. */
  landmarks?: LandmarkFarRow[];
}

const pad4 = (n: number): number => (n + 3) & ~3;

const STAND_IN_MATERIAL: PackMaterial = { id: "", base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 1 };
const STAND_IN_TEXTURE: ManifestTexture = { id: "", role: "base", top: STEP0_SIZE, in: {} };

const STAND_IN_LEVEL: ManifestLevel = Object.freeze({ file: -1, at: 0, verts: 0, tris: 0, index: 2, error: 0, parts: Object.freeze([]) as unknown as ManifestPart[] });
const POINT = Object.freeze([0, 0, 0]) as unknown as [number, number, number];

/** A mesh as known before its page comes: its levels, as many as it has, are empty, and its bounds a point. Its page's row takes its place whole. */
export function placeholderMesh(s: MeshStub): ManifestMesh {
  const out: ManifestMesh = { id: s.id, center: POINT, half: POINT, page: s.page, levels: new Array<ManifestLevel>(s.count).fill(STAND_IN_LEVEL) };
  if (s.skeleton !== undefined) out.skeleton = s.skeleton;
  if (s.rig !== undefined) out.rig = s.rig;
  if (s.bone !== undefined) out.bone = s.bone;
  return out;
}

/** Whether a mesh's row is in the manifest, not a stand-in for one whose page has not come. */
export const meshKnown = (m: ManifestMesh): boolean => m.levels[0]!.parts.length > 0;

/** Where in a skeleton's part each of its clips is. */
export function partClips(e: ManifestClips): PackClip[] {
  let at = 0;
  return e.clips.map((c) => {
    const rotOffset = at;
    const rootOffset = rotOffset + c.frames * clipRotBytes(c.bones);
    at = rootOffset + c.frames * CLIP_ROOT_BYTES;
    return { ...c, rotOffset, rootOffset };
  });
}

/** A skeleton's clips from its part's bytes. */
export const skeletonClips = (e: ManifestClips, part: Uint8Array): ClipSet => decodeClips(partClips(e), part);

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
    if (m.seeThrough) out.seeThrough = true;
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
  if (pack.header.landmarks) out.landmarks = pack.header.landmarks;
  return out;
}

function checkTexture(m: Manifest, t: ManifestTexture): void {
  if (typeof t.id !== "string" || t.id === "" || !TEXTURE_ROLES.includes(t.role) || stepOf(t.top) < 0) throw new Error(`manifest: texture "${String(t.id)}" is not described`);
  for (const format of TEXTURE_FORMATS) {
    const v = t.in?.[format];
    if (!v) continue;
    const file = m.files[v.file];
    const top = topIn(format, t.top);
    if (file?.role !== "tex" || file.format !== format) throw new Error(`manifest: texture ${t.id} names a file that does not hold ${format}`);
    if (!Array.isArray(v.hash) || v.hash.length !== stepOf(top) + 1) throw new Error(`manifest: texture ${t.id} does not have a hash for every step`);
    if (v.block !== undefined && (format !== "astc" || !ASTC_BLOCKS.includes(v.block))) throw new Error(`manifest: texture ${t.id} has ${format} blocks of a side there are not`);
    if (v.stored && (v.stored.length !== v.hash.length || v.stored.some((s, k) => !(s > 0 && s <= stepBytes(format, t.role, k, blockOf(format, v)))))) throw new Error(`manifest: texture ${t.id} says it is stored in more bytes than it has`);
    const bytes = v.hash.reduce((sum, _, k) => sum + storedStep(v, format, t.role, k), 0);
    if (!(v.at >= TEXTURE_HEADER_BYTES) || !(v.at + bytes <= file.bytes)) throw new Error(`manifest: texture ${t.id} lies outside its file`);
  }
}

function checkMaterial(m: Manifest, mat: PackMaterial): void {
  const textures = m.textures?.length ?? 0;
  for (const t of [mat.base, mat.normal, mat.mro, mat.mask, mat.mask2, mat.layer ?? -1]) if (!(t >= -1 && t < textures)) throw new Error(`manifest: material ${mat.id} names a texture that is not there`);
}

/** `blob` is the bytes of the blob of the page that holds the mesh's row, or -1 where it is not known, in a manifest whose pages a tool has read. */
function checkMesh(m: Manifest, mesh: ManifestMesh, blob: number): void {
  if (!Array.isArray(mesh.levels) || mesh.levels.length === 0) throw new Error(`manifest: mesh ${mesh.id} has no level`);
  const flat = mesh.flat ?? 0;
  const materials = m.materials?.length ?? 0;
  if (!(flat >= 0 && flat <= mesh.levels.length)) throw new Error(`manifest: mesh ${mesh.id} turns flat at a level it does not have`);
  mesh.levels.forEach((level, at) => {
    const file = m.files[level.file];
    const parts = Array.isArray(level.parts) ? level.parts : [];
    if (parts.some((p) => p.stored !== undefined && !(p.stored > 0 && p.stored < p.bytes))) throw new Error(`manifest: a part of a level of ${mesh.id} says it is stored in as many bytes as it has, or more`);
    const bytes = parts.reduce((sum, p) => sum + storedBytes(p), 0);
    const first = level.surface && parts[0] ? (file?.role === "page" ? parts[0].bytes : storedBytes(parts[0])) : bytes;
    const room = file?.role === "page" ? (blob < 0 ? Infinity : blob) : (file?.bytes ?? -1);
    if (!file || parts.length === 0 || !(level.at >= 0) || !(level.at + first <= room) || (file.role === "page" && (parts[0]!.stored !== undefined || (parts.length > 1 && !level.surface)))) throw new Error(`manifest: a level of ${mesh.id} lies outside its file`);
    if (level.surface && !(level.surface.at >= 0 && level.surface.at + bytes - storedBytes(parts[0]!) <= (m.files[level.surface.file]?.bytes ?? -1))) throw new Error(`manifest: the surface of a level of ${mesh.id} lies outside its file`);
    if ((level.index !== 2 && level.index !== 4) || !(level.error >= 0)) throw new Error(`manifest: a level of ${mesh.id} is not described`);
    const sizes = [pad4(level.tris * 3 * level.index) + level.verts * VERTEX_BYTES, level.verts * SURFACE_BYTES, level.verts * SKIN_BYTES];
    if (parts.length > 3 || parts.some((p, k) => p.bytes !== sizes[k])) throw new Error(`manifest: a level of ${mesh.id} is not the size its counts give`);
    if (parts.length > 1 !== at < flat) throw new Error(`manifest: mesh ${mesh.id} does not turn flat where it says`);
    const runs = level.sections ?? [];
    let next = 0;
    for (let k = 0; k < runs.length; k += 3) {
      if (!(runs[k]! >= 0 && runs[k]! < materials) || runs[k + 1] !== next || !(runs[k + 2]! > 0)) throw new Error(`manifest: a level of ${mesh.id} has a section that does not fit`);
      next += runs[k + 2]!;
    }
    if (parts.length > 1 ? runs.length === 0 || runs.length > MOST_SECTIONS * 3 || next !== level.tris * 3 : runs.length > 0) throw new Error(`manifest: the sections of a level of ${mesh.id} do not cover it`);
  });
}

/** Whether a part of `bytes` stored in `stored`, if given, at `at` lies within `size`. */
const partFits = (at: number, p: ManifestPart | undefined, size: number): boolean => p !== undefined && p.bytes > 0 && (p.stored === undefined || (p.stored > 0 && p.stored < p.bytes)) && at >= 0 && at + storedBytes(p) <= size;

/** Throws with a reason if the text is not a manifest this build can use. What a page holds is a stand-in until `readPage`. */
export function parseManifest(text: string): Manifest {
  const m = JSON.parse(text) as Manifest;
  if (m.version !== MANIFEST_VERSION) throw new Error(`manifest: version ${String(m.version)} is not supported`);
  if (!Array.isArray(m.files) || !Array.isArray(m.meshes) || m.files[m.boot]?.role !== "boot") throw new Error("manifest: no boot pack");
  if (m.icons) checkIcons(m.icons, (file) => m.files[file]?.role);
  const pages = m.pages ?? [];
  for (const p of pages) if (m.files[p.file]?.role !== "page" || !partFits(p.at, p.part, m.files[p.file]!.bytes)) throw new Error("manifest: a page lies outside its file");
  if (m.materials) m.materials = (m.materials as (PackMaterial | null)[]).map((x) => x ?? { ...STAND_IN_MATERIAL });
  if (m.textures) m.textures = (m.textures as (ManifestTexture | null)[]).map((x) => x ?? { ...STAND_IN_TEXTURE, in: {} });
  for (const t of m.textures ?? []) if (t.id !== "") checkTexture(m, t);
  for (const mat of m.materials ?? []) checkMaterial(m, mat);
  const sounds = m.sounds ? soundFault(m.sounds, m.files) : "";
  if (sounds !== "") throw new Error(`manifest: ${sounds}`);
  for (const e of m.clips ?? []) {
    const file = m.files[e.file];
    const bytes = Array.isArray(e.clips) ? e.clips.reduce((sum, c) => sum + (c.frames > 0 && c.bones > 0 ? c.frames * (clipRotBytes(c.bones) + CLIP_ROOT_BYTES) : NaN), 0) : NaN;
    if (typeof e.rig !== "string" || file?.role !== "clip" || e.part?.bytes !== bytes || !partFits(e.at, e.part, file.bytes)) throw new Error(`manifest: the clips of ${String(e.rig)} are not described`);
  }
  const seen = new Set<string>();
  m.meshes = (m.meshes as (ManifestMesh | MeshStub)[]).map((row) => {
    if (typeof row.id !== "string" || seen.has(row.id)) throw new Error(`manifest: mesh "${String(row.id)}" is listed twice or has no id`);
    seen.add(row.id);
    if (!("count" in row)) {
      checkMesh(m, row, -1);
      return row;
    }
    if (!(row.page >= 0 && row.page < pages.length && row.count >= 1 && row.count <= 32)) throw new Error(`manifest: mesh ${row.id} names a page there is not`);
    return placeholderMesh(row);
  });
  return m;
}

/**
 * Takes the rows page `p` holds from its bytes into the manifest, in place of the stand-ins, and gives its blob and the
 * meshes, materials and textures it gave rows for. Throws where the bytes are not such a page or name what is not there.
 */
export function readPage(m: Manifest, p: number, bytes: Uint8Array): { blob: Uint8Array; meshes: number[]; materials: number[]; textures: number[] } {
  const length = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) : -1;
  if (!(length >= 0 && 4 + length <= bytes.length)) throw new Error(`manifest: page ${p} is not a page`);
  const rows = JSON.parse(decodeUtf8(bytes.subarray(4, 4 + length))) as PageRows;
  const out = { blob: bytes.subarray(4 + pad4(length)), meshes: [] as number[], materials: [] as number[], textures: [] as number[] };
  const textures = m.textures ?? [];
  const materials = m.materials ?? [];
  for (const [t, row] of rows.textures) {
    if (!textures[t] || (textures[t].id !== "" && textures[t].id !== row.id)) throw new Error(`manifest: page ${p} names a texture there is not`);
    if (textures[t].id !== "") continue;
    checkTexture(m, row);
    textures[t] = row;
    out.textures.push(t);
  }
  for (const [k, row] of rows.materials) {
    if (!materials[k] || (materials[k].id !== "" && materials[k].id !== row.id)) throw new Error(`manifest: page ${p} names a material there is not`);
    if (materials[k].id !== "") continue;
    checkMaterial(m, row);
    if ([row.base, row.normal, row.mro, row.mask, row.mask2, row.layer ?? -1].some((t) => t >= 0 && textures[t]!.id === "")) throw new Error(`manifest: page ${p} holds material ${row.id} and not its textures`);
    materials[k] = row;
    out.materials.push(k);
  }
  for (const [i, row] of rows.meshes) {
    const was = m.meshes[i];
    if (!was || was.id !== row.id || row.page !== p || row.levels?.length !== was.levels.length) throw new Error(`manifest: page ${p} names a mesh there is not`);
    if (meshKnown(was)) continue;
    checkMesh(m, row, out.blob.length);
    for (const level of row.levels) for (let k = 0; k < (level.sections?.length ?? 0); k += 3) if (materials[level.sections![k]!]!.id === "") throw new Error(`manifest: page ${p} holds mesh ${row.id} and not its materials`);
    m.meshes[i] = row;
    out.meshes.push(i);
  }
  return out;
}

/** A part of a ranged file from the file's bytes as served, inflated and its filter undone: null where it does not come back. */
export function partIn(file: Uint8Array, at: number, p: ManifestPart, inflate: (stored: Uint8Array) => Uint8Array): Uint8Array | null {
  const stored = file.subarray(at, at + storedBytes(p));
  const bytes = p.stored === undefined ? stored : unfilterPart(inflate(stored), p.bytes);
  return bytes && bytes.length === p.bytes ? bytes : null;
}

/**
 * Every page read into the manifest, as tools and the server see the build: `read` gives a file's bytes as served and
 * `inflate` undoes raw deflate. Returns the page blobs, by page.
 */
export function readPages(m: Manifest, read: (file: number) => Uint8Array, inflate: (stored: Uint8Array) => Uint8Array): Uint8Array[] {
  const files = new Map<number, Uint8Array>();
  return (m.pages ?? []).map((page, p) => {
    if (!files.has(page.file)) files.set(page.file, read(page.file));
    const bytes = partIn(files.get(page.file)!, page.at, page.part, inflate);
    if (!bytes) throw new Error(`manifest: page ${p} does not come back from its file`);
    return readPage(m, p, bytes).blob;
  });
}
