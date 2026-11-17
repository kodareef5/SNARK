// The texture build: from the RGBA8 mips of every texture to the three texture files, bc, astc and rgba, and what the
// manifest lists of them. The block variants are encoded in worker threads, a range of blocks at a time, and every
// picture encoded is kept under .cache/ by what went into it, so a build encodes only what it has not seen before.

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT, setTexture, textureOf } from "../../shared/pack/pack.ts";
import { STORED_TEXTURE_VERSION } from "../../shared/pack/stored.ts";
import { TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_ROLES, stepBytes, stepOffset, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import type { AstcKind } from "./astc.ts";
import { fileHash } from "./manifest.ts";
import type { SplitFile } from "./split.ts";
import { PartStore, textureFilters, type StoreReport } from "./store.ts";
import { isNeutral, laidOut, placedAt, rgbaTexture, textureHeader, writeTextureFile, type EncodedTexture, type PlacedTexture } from "./texture.ts";

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
export type Encoding = { with: "bc5" } | { with: "bc7"; channels: 3 | 4 } | { with: "astc"; kind: AstcKind; block: number };

/**
 * The side of a role's ASTC blocks: the coarsest at which the rasterizer's close views of real assets move no more
 * than about a thousandth of the pixels by over 8 levels from 4 by 4 (planning/quality/encoders.md). Base colour 6,
 * normals 5, the packed map 8, and the masks 4, which must stay exact (D149). Where its alpha is read a base colour is
 * 5, as is the layer: a cut-out's edge moves with its alpha.
 */
export function astcBlock(role: TextureRole, alpha: boolean): number {
  if (role === "base") return alpha ? 5 : 6;
  return role === "normal" || role === "layer" ? 5 : role === "mro" ? 8 : 4;
}

/** How a role is stored in a block variant. `alpha` is whether anything reads the alpha of a base colour. A layer is a base colour whose alpha is always read. */
export function encodingOf(format: BlockFormat, role: TextureRole, alpha: boolean): Encoding {
  if (format === "astc") return { with: "astc", kind: role === "base" || role === "layer" ? "srgb" : role === "normal" ? "normal" : "linear", block: astcBlock(role, alpha) };
  return role === "normal" ? { with: "bc5" } : { with: "bc7", channels: (role === "base" && alpha) || role === "layer" ? 4 : 3 };
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
    // A thread that stops with a job in hand fails it. One that had finished has nothing to fail.
    t.worker.on("exit", (code) => t.done?.(new Error(`textures: an encoding thread stopped with code ${code}`)));
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

/** Written whole or not at all, so checkouts may share one cache folder through a link. */
function keep(dir: string, key: string, picture: Uint8Array): void {
  mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
  const path = join(dir, key.slice(0, 2), key);
  writeFileSync(`${path}.${process.pid}.tmp`, picture);
  renameSync(`${path}.${process.pid}.tmp`, path);
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
  /**
   * Writes a texture whose role, alpha and pictures are an earlier one's once, for both, and leaves out one that is
   * its role's neutral in every texel a shader reads, which a material without that map is drawn with.
   */
  share?: boolean;
}

export interface EncodeReport {
  /** Pictures in the two block variants, and how many of them had to be encoded. The rest were kept from an earlier build, or were the same as another. */
  pictures: number;
  encoded: number;
  /** Megapixels encoded. */
  megapixels: number;
}

/** One texture in each variant. */
export type Variants = Record<TextureFormat, EncodedTexture>;

/**
 * Encodes `sources` a texture at a time and hands each to `take`, in order, while the next is encoded, so that no more
 * than two textures' pictures are held. Returns the place of each source among those handed on: its own, another's
 * with `share` where they are the same, or -1 where it was left out. The bytes are the same whatever the number of
 * threads and however the blocks are shared out among them.
 *
 * A picture is kept under the hash of its pixels, its role, its variant, how it is encoded and the text of its
 * encoder's source file, so changing an encoder encodes everything again and nothing else has to be remembered. A
 * picture that is the same as one before it is encoded once: read back from the cache, or held for the whole build
 * where there is none. Where nothing reads alpha the block variants are given it as 255, so no bits are spent on it.
 */
export async function eachTexture(sources: readonly TextureSource[], opts: EncodeOptions, take: (t: Variants) => Promise<void>): Promise<{ report: EncodeReport; places: number[] }> {
  const cache = opts.cache === undefined ? TEXTURE_CACHE : opts.cache;
  const cut = opts.cut ?? CUT;
  const text = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");
  const encoder = { bc: sha(opts.encoders?.bc ?? text("bc.ts")), astc: sha(opts.encoders?.astc ?? text("astc.ts")) };
  const threads = pool(opts.workers ?? availableParallelism());
  const report: EncodeReport = { pictures: 0, encoded: 0, megapixels: 0 };
  const encode = async (key: string, how: Encoding, rgba: Uint8Array, size: number): Promise<Uint8Array> => {
    const blocks = Math.ceil(size / (how.with === "astc" ? how.block : 4)) ** 2;
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
  /** By key, so that pictures that are the same are encoded once. With a cache, only while they are being encoded. */
  const made = new Map<string, Promise<Uint8Array>>();
  const places: number[] = [];
  /** The place of each texture handed on, by its role, alpha and pictures as given. */
  const written = new Map<string, number>();
  let count = 0;
  let taking: Promise<void> = Promise.resolve();
  try {
    for (const s of sources) {
      const mips = s.mips();
      if (mips.length !== Math.log2(s.top) + 1 || mips.some((m, i) => m.length !== 4 ** i * 4)) throw new Error(`texture ${s.id}: its pictures are not the sizes from 1 to ${s.top} pixels across`);
      const alpha = (s.role === "base" && (opts.alpha?.has(s.id) ?? false)) || s.role === "layer";
      if (opts.share) {
        if (isNeutral(s.role, alpha, mips)) {
          places.push(-1);
          continue;
        }
        const same = sha(JSON.stringify([s.role, alpha, ...mips.map((m) => sha(m))]));
        const had = written.get(same);
        if (had !== undefined) {
          places.push(had);
          continue;
        }
        written.set(same, count);
      }
      places.push(count++);
      const pictures: Promise<Uint8Array>[][] = [[], []];
      mips.forEach((mip, i) => {
        const rgba = new Uint8Array(new SharedArrayBuffer(mip.length));
        rgba.set(mip);
        if (s.role !== "normal" && !alpha) for (let a = 3; a < rgba.length; a += 4) rgba[a] = 255;
        const pixels = sha(rgba);
        BLOCK_FORMATS.forEach((format, f) => {
          const how = encodingOf(format, s.role, alpha);
          const key = sha(JSON.stringify([encoder[format], format, s.role, how, pixels]));
          let picture = made.get(key);
          if (!picture) {
            made.set(key, (picture = encode(key, how, rgba, 1 << i)));
            if (cache) picture.then(() => made.delete(key), () => made.delete(key));
          }
          pictures[f]!.push(picture);
          report.pictures++;
        });
      });
      const [bc, astc] = await Promise.all(pictures.map((p) => Promise.all(p)));
      await taking;
      taking = take({ bc: { role: s.role, block: 4, pictures: bc! }, astc: { role: s.role, block: astcBlock(s.role, alpha), pictures: astc! }, rgba: rgbaTexture(s.role, mips) });
    }
    await taking;
  } finally {
    await taking.catch(() => undefined);
    await threads.close();
  }
  return { report, places };
}

/** The texture file of each variant, in the order of TEXTURE_FORMATS, where each texture is in it, and the place in the files of each source (eachTexture). */
export async function encodeTextures(sources: readonly TextureSource[], opts: EncodeOptions = {}): Promise<{ variants: { format: TextureFormat; bytes: Uint8Array; placed: PlacedTexture[] }[]; report: EncodeReport; places: number[] }> {
  const textures: Record<TextureFormat, EncodedTexture[]> = { bc: [], astc: [], rgba: [] };
  const { report, places } = await eachTexture(sources, opts, async (t) => {
    for (const format of TEXTURE_FORMATS) textures[format].push(t[format]);
  });
  return { variants: TEXTURE_FORMATS.map((format) => ({ format, ...writeTextureFile(format, textures[format]) })), report, places };
}

export interface TextureFile extends SplitFile {
  format: TextureFormat;
}

/**
 * The sources of a build in the order they are written: one for each texture the manifest names, in its order, then
 * those it does not name. And the ids of the base colours whose alpha something reads.
 */
function buildOrder(manifest: Manifest, sources: readonly TextureSource[]): { all: TextureSource[]; alpha: Set<string> } {
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
  const alpha = new Set<string>();
  for (const m of manifest.materials ?? []) if (m.base >= 0 && ((m.flags & MATERIAL_CUTOUT) !== 0 || m.emissive > 0)) alpha.add(named[m.base]!.id);
  return { all, alpha };
}

/** Lists in the manifest the textures written, where each is in the file of each variant (`placed`, by format, from file `first`), and tells the materials their places. */
function listTextures(manifest: Manifest, all: readonly TextureSource[], places: readonly number[], placed: readonly (readonly PlacedTexture[])[], first: number): void {
  const kept = all.filter((_, i) => places[i] !== -1 && places.indexOf(places[i]!) === i);
  manifest.textures = kept.map((s, i) => ({ id: s.id, role: s.role, top: s.top, in: Object.fromEntries(TEXTURE_FORMATS.map((format, k) => [format, { file: first + k, ...placed[k]![i]! }])) }));
  for (const m of manifest.materials ?? []) for (const role of TEXTURE_ROLES) if (textureOf(m, role) >= 0) setTexture(m, role, places[textureOf(m, role)]!);
}

/**
 * Encodes the textures of a build and lists them in its manifest: the three files after the files it has, and where
 * each texture is in each. Each texture the manifest names must have a source, and sources that nothing names follow
 * them. Textures that are the same are listed once, under the first one's id, and one that is its role's neutral is
 * left out (`share`), so the materials are told the places of theirs again. Returns the files to write, which are
 * none when there are no textures.
 */
export async function buildTextures(manifest: Manifest, sources: readonly TextureSource[], name: string, opts: EncodeOptions = {}): Promise<{ files: TextureFile[]; report: EncodeReport }> {
  const { all, alpha } = buildOrder(manifest, sources);
  if (all.length === 0) return { files: [], report: { pictures: 0, encoded: 0, megapixels: 0 } };
  const { variants, report, places } = await encodeTextures(all, { ...opts, alpha, share: true });
  listTextures(manifest, all, places, variants.map((v) => v.placed), manifest.files.length);
  const files = variants.map((v): TextureFile => ({ name: `${name}.tex.${v.format}.sntx`, role: "tex", format: v.format, bytes: v.bytes }));
  for (const f of files) manifest.files.push({ name: f.name, bytes: f.bytes.length, role: "tex", format: f.format });
  return { files, report };
}

/** Raw bytes of the textures being stored at once, past which the next is not encoded: enough to give every thread parts to deflate. */
export const STORING = 256 << 20;

/** Writes all of `bytes` at `at`. */
function writeAt(fd: number, bytes: Uint8Array, at: number): void {
  for (let done = 0; done < bytes.length; ) done += writeSync(fd, bytes, done, bytes.length - done, at + done);
}

/**
 * The three texture files of buildTextures, stored as storeParts stores them, written to `dir`, named after their hash
 * as a build serves them, and listed so in the manifest. Each texture is stored as soon as it is encoded and written
 * once those before it are, so a few textures are held at a time and never a file. `parts` is where deflated parts
 * are kept (PartStore), and `storing` the raw bytes being stored at once (STORING). Returns the bytes of the files
 * before they were stored, and what each stage did.
 */
export async function writeTextures(manifest: Manifest, sources: readonly TextureSource[], name: string, dir: string, opts: EncodeOptions & { parts?: string | null; storing?: number } = {}): Promise<{ raw: number; report: EncodeReport; stored: StoreReport }> {
  const { all, alpha } = buildOrder(manifest, sources);
  const stored: StoreReport = { parts: 0, deflated: 0, made: 0, raw: 0, stored: 0 };
  if (all.length === 0) return { raw: 0, report: { pictures: 0, encoded: 0, megapixels: 0 }, stored };
  const store = new PartStore({ workers: opts.workers, cache: opts.parts });
  const files = TEXTURE_FORMATS.map((format) => {
    const path = join(dir, `${name}.tex.${format}.sntx`);
    return { format, path, fd: openSync(path, "w"), at: TEXTURE_HEADER_BYTES, raw: TEXTURE_HEADER_BYTES, placed: [] as PlacedTexture[] };
  });
  let count = 0;
  /** Raw bytes of the textures handed on and not yet written, and a promise for each that it is written. */
  let held = 0;
  let writing: Promise<void> = Promise.resolve();
  const queue: Promise<void>[] = [];
  const room = async (): Promise<void> => {
    while (held > (opts.storing ?? STORING)) await queue.shift()!;
  };
  try {
    const { report, places } = await eachTexture(all, { ...opts, alpha, share: true }, (t) => {
      const i = count++;
      const laid = files.map((file) => {
        const { role, block } = t[file.format];
        const { bytes, hash } = laidOut(file.format, t[file.format], i);
        const steps = hash.map((_, s) => bytes.subarray(stepOffset(file.format, role, s, block), stepOffset(file.format, role, s, block) + stepBytes(file.format, role, s, block)));
        return { placed: placedAt(file.format, t[file.format], 0, hash), steps, stored: Promise.all(steps.map((raw, s) => store.part(raw, textureFilters(file.format, role, s), file.path))) };
      });
      const bytes = laid.reduce((sum, l) => sum + l.steps.reduce((n, s) => n + s.length, 0), 0);
      const ready = Promise.all(laid.map((l) => l.stored));
      ready.catch(() => undefined);
      held += bytes;
      writing = writing.then(async () => {
        const parts = await ready;
        laid.forEach(({ placed, steps }, k) => {
          const file = files[k]!;
          placed.at = file.at;
          const sizes = parts[k]!.map((part, s) => {
            writeAt(file.fd, part, file.at);
            file.at += part.length;
            file.raw += steps[s]!.length;
            stored.parts++;
            stored.raw += steps[s]!.length;
            stored.stored += part.length;
            if (part.length < steps[s]!.length) stored.deflated++;
            return part.length;
          });
          if (sizes.some((n, s) => n < steps[s]!.length)) placed.stored = sizes;
          file.placed.push(placed);
        });
        held -= bytes;
      });
      queue.push(writing);
      return room();
    });
    await writing;
    stored.made = store.made;
    for (const file of files) {
      writeAt(file.fd, textureHeader(file.format, count, STORED_TEXTURE_VERSION), 0);
      closeSync(file.fd);
      file.fd = -1;
    }
    listTextures(manifest, all, places, files.map((f) => f.placed), manifest.files.length);
    for (const file of files) {
      const named = `${name}.tex.${file.format}.${fileHash(file.path)}.sntx`;
      renameSync(file.path, join(dir, named));
      manifest.files.push({ name: named, bytes: file.at, role: "tex", format: file.format });
    }
    return { raw: files.reduce((sum, f) => sum + f.raw, 0), report, stored };
  } finally {
    await writing.catch(() => undefined);
    for (const file of files) if (file.fd >= 0) closeSync(file.fd);
    await store.close();
  }
}
