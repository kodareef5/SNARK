// The texture build: from the RGBA8 mips of every texture to the three texture files, bc, astc and rgba, and what the
// manifest lists of them. The block variants are encoded in worker threads, a range of blocks at a time, and every
// picture encoded is kept under .cache/ by what went into it, so a build encodes only what it has not seen before.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT } from "../../shared/pack/pack.ts";
import { TEXTURE_FORMATS, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import type { AstcKind } from "./astc.ts";
import type { SplitFile } from "./split.ts";
import { rgbaTexture, writeTextureFile, type EncodedTexture, type PlacedTexture } from "./texture.ts";

/** A texture for the build: what the manifest lists of it, and a way to its pictures. */
export interface TextureSource {
  id: string;
  role: TextureRole;
  /** The side of its largest picture, in pixels. */
  top: number;
  /** Its pictures as RGBA8, smallest first, from one pixel across up to `top`: what materialMips makes, cut at `top`. Asked for once, when the build reaches the texture. */
  mips(): Uint8Array[];
}

type BlockFormat = Exclude<TextureFormat, "rgba">;
const BLOCK_FORMATS: readonly BlockFormat[] = ["bc", "astc"];

/** The encoder a picture goes through, and what it is told of the picture. */
export type Encoding = { with: "bc5" } | { with: "bc7"; channels: 3 | 4 } | { with: "astc"; kind: AstcKind };

/** How a role is stored in a block variant. `alpha` is whether anything reads the alpha of a base colour. */
export function encodingOf(format: BlockFormat, role: TextureRole, alpha: boolean): Encoding {
  if (format === "astc") return { with: "astc", kind: role === "base" ? "srgb" : role === "normal" ? "normal" : "linear" };
  return role === "normal" ? { with: "bc5" } : { with: "bc7", channels: role === "base" && alpha ? 4 : 3 };
}

/** What a thread is sent: blocks `from` up to `to` of a picture `size` pixels across. The picture and its blocks are shared memory. */
export interface EncodeJob {
  rgba: Uint8Array;
  out: Uint8Array;
  size: number;
  how: Encoding;
  from: number;
  to: number;
}

interface Thread {
  worker: Worker;
  /** Ends the job it is on. */
  done: ((failed?: unknown) => void) | null;
}

/** Up to `most` threads, each started when first needed and on one job at a time. */
function pool(most: number): { run(job: EncodeJob): Promise<void>; close(): Promise<unknown> } {
  const all: Thread[] = [];
  const idle: Thread[] = [];
  const waiting: ((t: Thread) => void)[] = [];
  const start = (): Thread => {
    const t: Thread = { worker: new Worker(new URL("./encode-worker.ts", import.meta.url)), done: null };
    t.worker.on("message", () => t.done?.());
    t.worker.on("error", (failed) => t.done?.(failed));
    all.push(t);
    return t;
  };
  return {
    async run(job) {
      const t = idle.pop() ?? (all.length < Math.max(1, most) ? start() : await new Promise<Thread>((free) => waiting.push(free)));
      try {
        await new Promise<void>((resolve, reject) => {
          t.done = (failed) => (failed === undefined ? resolve() : reject(failed));
          t.worker.postMessage(job);
        });
      } finally {
        const next = waiting.shift();
        if (next) next(t);
        else idle.push(t);
      }
    },
    close: () => Promise.all(all.map((t) => t.worker.terminate())),
  };
}

/** Where a build keeps the pictures it has encoded. */
export const TEXTURE_CACHE = resolve(import.meta.dir, "../../.cache/textures");

/** Blocks in the range a thread is sent: 128 by 128 pixels, a few hundredths of a second. */
const CUT = 1024;

function sha(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A picture kept under `key`, if it is there and whole. */
function kept(dir: string, key: string, bytes: number): Uint8Array | null {
  try {
    const file = readFileSync(join(dir, key.slice(0, 2), key));
    return file.length === bytes ? file : null;
  } catch {
    return null;
  }
}

function keep(dir: string, key: string, picture: Uint8Array): void {
  mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, key.slice(0, 2), key), picture);
}

export interface EncodeOptions {
  /** Worker threads. Every core where not given. */
  workers?: number;
  /** Blocks in the range a thread is sent at a time. */
  cut?: number;
  /** The folder encoded pictures are kept in, or null to keep none. The repo's .cache/textures where not given. */
  cache?: string | null;
  /** The ids of the base colours whose alpha something reads. */
  alpha?: ReadonlySet<string>;
  /** The text of an encoder, which is part of what a picture is kept under. The encoder's own file where not given. */
  encoders?: Readonly<Partial<Record<BlockFormat, string>>>;
}

export interface EncodeReport {
  /** Pictures in the two block variants, and how many of them had to be encoded. The rest were kept from an earlier build, or were the same as another. */
  pictures: number;
  encoded: number;
  /** Megapixels encoded. */
  megapixels: number;
}

/**
 * The texture file of each variant, in the order of TEXTURE_FORMATS, and where each texture is in it. The bytes are
 * the same whatever the number of threads and however the blocks are shared out among them.
 *
 * A picture is kept under the hash of its pixels, its role, its variant, how it is encoded and the text of its
 * encoder's source file, so changing an encoder encodes everything again and nothing else has to be remembered.
 * Where nothing reads alpha the block variants are given it as 255, so no bits are spent on it.
 */
export async function encodeTextures(sources: readonly TextureSource[], opts: EncodeOptions = {}): Promise<{ variants: { format: TextureFormat; bytes: Uint8Array; placed: PlacedTexture[] }[]; report: EncodeReport }> {
  const cache = opts.cache === undefined ? TEXTURE_CACHE : opts.cache;
  const cut = opts.cut ?? CUT;
  const text = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");
  const encoder = { bc: sha(opts.encoders?.bc ?? text("bc.ts")), astc: sha(opts.encoders?.astc ?? text("astc.ts")) };
  const threads = pool(opts.workers ?? availableParallelism());
  const report: EncodeReport = { pictures: 0, encoded: 0, megapixels: 0 };
  const encode = async (key: string, how: Encoding, rgba: Uint8Array, size: number): Promise<Uint8Array> => {
    const blocks = ((size + 3) >> 2) ** 2;
    const was = cache && kept(cache, key, blocks * 16);
    if (was) return was;
    const out = new Uint8Array(new SharedArrayBuffer(blocks * 16));
    const ranges: Promise<void>[] = [];
    for (let from = 0; from < blocks; from += cut) ranges.push(threads.run({ rgba, out, size, how, from, to: Math.min(from + cut, blocks) }));
    await Promise.all(ranges);
    report.encoded++;
    report.megapixels += (size * size) / 1e6;
    if (cache) keep(cache, key, out);
    return out;
  };
  /** By key, so that pictures that are the same are encoded once. */
  const made = new Map<string, Promise<Uint8Array>>();
  const textures: Record<TextureFormat, EncodedTexture[]> = { bc: [], astc: [], rgba: [] };
  try {
    // A texture at a time, so that no more than one texture's pictures are held unencoded. Its blocks keep every thread busy.
    for (const s of sources) {
      const mips = s.mips();
      if (mips.length !== Math.log2(s.top) + 1 || mips.some((m, i) => m.length !== 4 ** i * 4)) throw new Error(`texture ${s.id}: its pictures are not the sizes from 1 to ${s.top} pixels across`);
      const alpha = s.role === "base" && (opts.alpha?.has(s.id) ?? false);
      const pictures: Promise<Uint8Array>[][] = [[], []];
      mips.forEach((mip, i) => {
        const rgba = new Uint8Array(new SharedArrayBuffer(mip.length));
        rgba.set(mip);
        if (s.role !== "normal" && !alpha) for (let a = 3; a < rgba.length; a += 4) rgba[a] = 255;
        const pixels = sha(rgba);
        BLOCK_FORMATS.forEach((format, f) => {
          const how = encodingOf(format, s.role, alpha);
          const key = sha(JSON.stringify([encoder[format], format, s.role, how, pixels]));
          if (!made.has(key)) made.set(key, encode(key, how, rgba, 1 << i));
          pictures[f]!.push(made.get(key)!);
          report.pictures++;
        });
      });
      const [bc, astc] = await Promise.all(pictures.map((p) => Promise.all(p)));
      textures.bc.push({ role: s.role, pictures: bc! });
      textures.astc.push({ role: s.role, pictures: astc! });
      textures.rgba.push(rgbaTexture(s.role, mips));
    }
  } finally {
    await threads.close();
  }
  return { variants: TEXTURE_FORMATS.map((format) => ({ format, ...writeTextureFile(format, textures[format]) })), report };
}

export interface TextureFile extends SplitFile {
  format: TextureFormat;
}

/**
 * Encodes the textures of a build and lists them in its manifest: the three files after the files it has, and where
 * each texture is in each. The textures the manifest names keep their places, since materials name them by place, and
 * each must have a source. Sources that nothing names follow them. Returns the files to write, which are none when
 * there are no textures.
 */
export async function buildTextures(manifest: Manifest, sources: readonly TextureSource[], name: string, opts: EncodeOptions = {}): Promise<{ files: TextureFile[]; report: EncodeReport }> {
  const named = manifest.textures ?? [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  if (byId.size !== sources.length) throw new Error("textures: two sources have one id");
  const all = named.map((t) => {
    const s = byId.get(t.id);
    if (!s) throw new Error(`texture ${t.id} is named by a mesh, and nothing has its pictures`);
    if (s.role !== t.role || s.top !== t.top) throw new Error(`texture ${t.id} is ${t.role} at ${t.top} to its mesh, and its pictures are ${s.role} at ${s.top}`);
    byId.delete(t.id);
    return s;
  });
  all.push(...byId.values());
  if (all.length === 0) return { files: [], report: { pictures: 0, encoded: 0, megapixels: 0 } };
  const alpha = new Set<string>();
  for (const m of manifest.materials ?? []) if (m.base >= 0 && ((m.flags & MATERIAL_CUTOUT) !== 0 || m.emissive > 0)) alpha.add(named[m.base]!.id);
  const { variants, report } = await encodeTextures(all, { ...opts, alpha });
  const first = manifest.files.length;
  manifest.textures = all.map((s, i) => ({ id: s.id, role: s.role, top: s.top, in: Object.fromEntries(variants.map((v, k) => [v.format, { file: first + k, ...v.placed[i]! }])) }));
  const files = variants.map((v): TextureFile => ({ name: `${name}.tex.${v.format}.sntx`, role: "tex", format: v.format, bytes: v.bytes }));
  for (const f of files) manifest.files.push({ name: f.name, bytes: f.bytes.length, role: "tex", format: f.format });
  return { files, report };
}
