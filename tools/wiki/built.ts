// What the wiki takes from the game's build, client/dist: its manifest, boot pack and every clip with each landmark's joined
// after them, its files read by range as a client reads them, the loose sounds, and the names of the files the wiki's pages
// share with the game's.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { ClipSet } from "../../shared/anim/clip.ts";
import { allClips } from "../../shared/pack/clips.ts";
import { parseManifest, readPages, storedBytes, type Manifest } from "../../shared/pack/manifest.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { parsePack, type Pack, type PackLod, type PackMesh } from "../../shared/pack/pack.ts";
import type { ManifestSound } from "../../shared/pack/sound.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";

export interface Built {
  readonly dist: string;
  /** With every page read into it. */
  readonly manifest: Manifest;
  /** The pages' blobs, by page. */
  readonly pages: readonly Uint8Array[];
  readonly boot: Pack;
  /** Every clip of the build: the boot pack's, and each creature skeleton's from the clip file. */
  readonly clips: ClipSet;
  readonly loose: { file: string; sounds: ManifestSound[] } | null;
  /** `bytes` bytes of a file of the manifest, by its index, from `at`. */
  read(file: number, at: number, bytes: number): Uint8Array;
  /** The name under client/dist/assets of the one file whose name `pattern` matches. */
  asset(pattern: RegExp): string;
  close(): void;
}

export function readBuilt(dist: string): Built {
  const at = (name: string): string => join(dist, "assets", name);
  if (!existsSync(at("manifest.json"))) throw new Error(`${at("manifest.json")} is missing: build the game first (bun run build)`);
  const core = parseManifest(readFileSync(at("manifest.json"), "utf8"));
  if (core.soundRows) core.sounds = JSON.parse(readFileSync(at(core.soundRows), "utf8")) as ManifestSound[];
  const whole = (file: number): Uint8Array => new Uint8Array(readFileSync(at(core.files[file]!.name)));
  const inflate = (stored: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(stored));
  const pages = readPages(core, whole, inflate);
  const coreBoot = parsePack(whole(core.boot));
  const clips = allClips(core, coreBoot, whole, inflate);
  // Every landmark's meshes, materials and textures after the core's, as a client on a map that places it joins them.
  let joined = { manifest: core, boot: coreBoot };
  for (const name of existsSync(at("landmarks")) ? readdirSync(at("landmarks")).filter((n) => n.endsWith(".json")).sort() : []) {
    const m = parseManifest(readFileSync(at(`landmarks/${name}`), "utf8"));
    joined = joinLandmark(joined, { manifest: m, boot: parsePack(new Uint8Array(readFileSync(at(`landmarks/${m.files[m.boot]!.name}`)))) }, "landmarks");
  }
  const { manifest, boot } = joined;
  const loose = existsSync(at("loose.json")) ? (JSON.parse(readFileSync(at("loose.json"), "utf8")) as Built["loose"]) : null;
  const open = new Map<number, number>();
  const names = readdirSync(join(dist, "assets"));
  return {
    dist,
    manifest,
    pages,
    boot,
    clips,
    loose,
    read(file, from, bytes) {
      // The boot file is its pack's blob after its header, the landmarks' blobs after the core's (shared/pack/join.ts).
      if (file === manifest.boot) return boot.blob.slice(from - boot.blobAt, from - boot.blobAt + bytes);
      let fd = open.get(file);
      if (fd === undefined) open.set(file, (fd = openSync(at(manifest.files[file]!.name), "r")));
      const out = new Uint8Array(bytes);
      if (readSync(fd, out, 0, bytes, from) !== bytes) throw new Error(`${manifest.files[file]!.name} ends before ${from + bytes}`);
      return out;
    },
    asset(pattern) {
      const found = names.filter((n) => pattern.test(n));
      if (found.length !== 1) throw new Error(`client/dist/assets has ${found.length} files named like ${pattern}`);
      return found[0]!;
    },
    close() {
      for (const fd of open.values()) closeSync(fd);
      open.clear();
    },
  };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/**
 * A pack of the meshes named, each its finest level as the mesh file stores it, with the boot pack's palette and rigs,
 * every clip, and the manifest's materials and textures: what the rasterizer draws from.
 */
export function meshPack(b: Built, ids: readonly string[]): Pack {
  const parts: Uint8Array[] = [b.boot.palette];
  let size = b.boot.palette.length;
  const meshes = ids.map((id): PackMesh => {
    const m = b.manifest.meshes.find((m) => m.id === id);
    if (!m) throw new Error(`the game's build has no mesh ${id}`);
    const level = m.levels[0]!;
    const start = size;
    let file = level.file;
    let from = level.at;
    const offsets: number[] = [];
    level.parts.forEach((p, k) => {
      if (k === 1 && level.surface) [file, from] = [level.surface.file, level.surface.at];
      // A level a page holds is in the page's blob, as it is.
      const stored = b.manifest.files[file]!.role === "page" ? b.pages[m.page!]!.subarray(from, from + p.bytes) : b.read(file, from, storedBytes(p));
      from += stored.length;
      const bytes = p.stored === undefined ? stored : unfilterPart(new Uint8Array(inflateRawSync(stored)), p.bytes);
      if (!bytes) throw new Error(`a part of ${id} does not inflate`);
      offsets.push(size);
      parts.push(bytes);
      size += pad4(bytes.length);
      if (bytes.length % 4 !== 0) parts.push(new Uint8Array(pad4(bytes.length) - bytes.length));
    });
    const lod: PackLod = { indexOffset: start, indexCount: level.tris * 3, indexBytes: level.index, vertexOffset: start + pad4(level.tris * 3 * level.index), vertexCount: level.verts, error: 0 };
    if (offsets.length > 1) [lod.surfaceOffset, lod.sections] = [offsets[1], level.sections];
    if (offsets.length > 2) lod.skinOffset = offsets[2];
    const out: PackMesh = { id, center: m.center, half: m.half, lods: [lod], flat: offsets.length > 1 ? 1 : 0 };
    if (m.skeleton !== undefined) out.skeleton = m.skeleton;
    if (m.rig !== undefined) out.rig = m.rig;
    if (m.uv) out.uv = m.uv;
    return out;
  });
  const blob = new Uint8Array(size);
  parts.reduce((at, p) => (blob.set(p, at), at + p.length), 0);
  const textures = (b.manifest.textures ?? []).map(({ id, role, top }) => ({ id, role, top }));
  const header = { paletteOffset: 0, meshes, rigs: b.boot.header.rigs, clips: [], materials: b.manifest.materials ?? [], textures };
  return { header, blob, blobAt: 0, palette: blob.subarray(0, 1024), meshIndex: new Map(ids.map((id, k) => [id, k])), clips: b.clips };
}
