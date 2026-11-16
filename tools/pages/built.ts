// What the guide takes from the game's build, client/dist: its manifest and boot pack, its files read by range as a
// client reads them, the loose sounds, and the names of the files the guide's pages share with the game's.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { parseManifest, storedBytes, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack, type Pack, type PackLod, type PackMesh } from "../../shared/pack/pack.ts";
import type { ManifestSound } from "../../shared/pack/sound.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";

export interface Built {
  readonly dist: string;
  readonly manifest: Manifest;
  readonly boot: Pack;
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
  const manifest = parseManifest(readFileSync(at("manifest.json"), "utf8"));
  const boot = parsePack(new Uint8Array(readFileSync(at(manifest.files[manifest.boot]!.name))));
  const loose = existsSync(at("loose.json")) ? (JSON.parse(readFileSync(at("loose.json"), "utf8")) as Built["loose"]) : null;
  const open = new Map<number, number>();
  const names = readdirSync(join(dist, "assets"));
  return {
    dist,
    manifest,
    boot,
    loose,
    read(file, from, bytes) {
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
 * A pack of the meshes named, each its finest level as the mesh file stores it, with the boot pack's palette, rigs and
 * clips and the manifest's materials and textures: what the rasterizer draws from.
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
      const stored = b.read(file, from, storedBytes(p));
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
  const header = { paletteOffset: 0, meshes, rigs: b.boot.header.rigs, clips: [], materials: b.manifest.materials ?? [], textures: (b.manifest.textures ?? []).map(({ id, role, top }) => ({ id, role, top })) };
  return { header, blob, blobAt: 0, palette: blob.subarray(0, 1024), meshIndex: new Map(ids.map((id, k) => [id, k])), clips: b.boot.clips };
}
