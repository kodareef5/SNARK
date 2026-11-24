// The ranged files of a build as it serves them. Every part a client fetches by range (a level's indices and vertices,
// its surface, its skin, a skeleton's clips, a page, a step of a texture) is stored deflated where that makes it smaller,
// so a range brings fewer bytes and the client inflates them (shared/pack/stored.ts). The boot file is fetched whole and
// is left as it is.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import { MANIFEST_VERSION, type Manifest } from "../../shared/pack/manifest.ts";
import { FILTER_LEVEL, FILTER_NONE, FILTER_PIXELS, FILTER_PLANES, FILTER_SURFACE, PARTS_HEADER_BYTES, PARTS_MAGIC, PARTS_VERSION, STORED_TEXTURE_VERSION, filterPart, unfilterPart } from "../../shared/pack/stored.ts";
import { STEP0_SIZE, TEXTURE_HEADER_BYTES, blockOf, stepBytes, stepOffset, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { partHash } from "./manifest.ts";
import type { SplitFile } from "./split.ts";

/** Where a build keeps the parts it has deflated. */
export const PART_CACHE = resolve(import.meta.dir, "../../.cache/parts");

/** A filter and its numbers. */
export type Filter = readonly [number, readonly number[]];

/** A part of a ranged file before it is stored. */
interface Part {
  /** Where it is in the file it was made in, and its bytes. */
  at: number;
  bytes: number;
  /** The filters tried on it. The one that deflates smallest is kept. */
  filters: readonly Filter[];
  /** Says where the part now starts and how many bytes it is stored in. */
  put(at: number, stored: number): void;
  /** A surface: its one filter gives back nearly what it was given, and the part is that, hashed again. */
  hashed?: (hash: string) => void;
}

/**
 * The filter a step of a texture is stored with. Blocks of base colour and normals deflate smaller in planes, and
 * those of the packed map and masks as they are. Pixels are predicted, those of a base colour as they are, since its
 * channels move together, and the rest a plane a channel.
 */
export function textureFilters(format: TextureFormat, role: TextureRole, step: number): Filter[] {
  if (format !== "rgba") return [role === "base" || role === "normal" ? [FILTER_PLANES, [16]] : [FILTER_NONE, []]];
  const pictures = step === 0 ? Math.log2(STEP0_SIZE) + 1 : 1;
  return [[FILTER_PIXELS, [role === "normal" ? 2 : 4, pictures, step === 0 ? 0 : Math.log2(STEP0_SIZE) + step, role === "base" ? 0 : 1]]];
}

/** Every part of every ranged file, by file, in the order of the file. A texture file not among `files` was stored as it was written (tools/pack/encode.ts writeTextures). */
function partsOf(files: readonly SplitFile[], manifest: Manifest): Part[][] {
  const parts: Part[][] = files.map(() => []);
  for (const mesh of manifest.meshes) {
    for (const level of mesh.levels) {
      if (files[level.file]!.role === "mesh") {
        parts[level.file]!.push({ at: level.at, bytes: level.parts[0]!.bytes, filters: [[FILTER_LEVEL, [level.tris * 3, level.index]], [FILTER_NONE, []]], put: (at, stored) => void ((level.at = at), stored < level.parts[0]!.bytes && (level.parts[0]!.stored = stored)) });
      }
      const rest = level.surface ?? level;
      if (files[rest.file]!.role !== "mesh") continue;
      let at = level.surface ? level.surface.at : level.at + level.parts[0]!.bytes;
      level.parts.forEach((p, k) => {
        if (k === 0) return;
        const put = (to: number, stored: number): void => void (k === 1 && level.surface && (level.surface.at = to), stored < p.bytes && (p.stored = stored));
        if (k === 1) parts[rest.file]!.push({ at, bytes: p.bytes, filters: [[FILTER_SURFACE, []]], put, hashed: (hash) => (p.hash = hash) });
        else parts[rest.file]!.push({ at, bytes: p.bytes, filters: [[FILTER_PLANES, [8]], [FILTER_NONE, []]], put });
        at += p.bytes;
      });
    }
  }
  // A skeleton's clips are in planes already.
  for (const e of [...(manifest.clips ?? []), ...(manifest.pages ?? [])]) parts[e.file]!.push({ at: e.at, bytes: e.part.bytes, filters: [[FILTER_NONE, []]], put: (at, stored) => void ((e.at = at), stored < e.part.bytes && (e.part.stored = stored)) });
  const textureParts = files.map(() => new Map<number, Part>());
  for (const tex of manifest.textures ?? []) {
    for (const [format, v] of Object.entries(tex.in) as [TextureFormat, NonNullable<(typeof tex.in)[TextureFormat]>][]) {
      if (v.file >= files.length) continue;
      const stored: number[] = [];
      v.hash.forEach((_, step) => {
        const bytes = stepBytes(format, tex.role, step, blockOf(format, v));
        const at = v.at + stepOffset(format, tex.role, step, blockOf(format, v));
        const put = (to: number, size: number): void => {
          if (step === 0) v.at = to;
          stored[step] = size;
          if (size < bytes) v.stored = stored;
        };
        const seen = textureParts[v.file]!.get(at);
        if (seen) {
          if (seen.bytes !== bytes) throw new Error(`store: shared texture step at ${at} has two lengths`);
          const prior = seen.put;
          seen.put = (to, size) => { prior(to, size); put(to, size); };
        } else {
          const part = { at, bytes, filters: textureFilters(format, tex.role, step), put };
          textureParts[v.file]!.set(at, part);
          parts[v.file]!.push(part);
        }
      });
    }
  }
  for (const list of parts) list.sort((a, b) => a.at - b.at);
  return parts;
}

/** Up to `most` threads, each started when first needed and given one part at a time. */
function pool(most: number): { run(data: Uint8Array): Promise<Uint8Array>; close(): Promise<unknown> } {
  const idle: Worker[] = [];
  const all: Worker[] = [];
  const waiting: (() => void)[] = [];
  return {
    async run(data) {
      while (idle.length === 0 && all.length >= most) await new Promise<void>((go) => waiting.push(go));
      let w = idle.pop();
      if (!w) {
        w = new Worker(new URL("./store-worker.ts", import.meta.url));
        all.push(w);
      }
      const worker = w;
      try {
        return await new Promise<Uint8Array>((done, fail) => {
          const ok = (m: { out: Uint8Array }): void => {
            worker.off("error", bad);
            done(m.out);
          };
          const bad = (e: unknown): void => {
            worker.off("message", ok);
            fail(e);
          };
          worker.once("message", ok);
          worker.once("error", bad);
          worker.postMessage({ id: 0, data });
        });
      } finally {
        idle.push(worker);
        waiting.shift()?.();
      }
    },
    close: () => Promise.all(all.map((w) => w.terminate())),
  };
}

export interface StoreOptions {
  /** Threads. Every core where not given. */
  workers?: number;
  /** The folder deflated parts are kept in, or null to keep none. */
  cache?: string | null;
  /** The files to store, by index. Every ranged file where not given. */
  only?: readonly number[];
}

export interface StoreReport {
  /** Parts, how many of them are stored deflated, and how many had to be deflated rather than taken from the cache. */
  parts: number;
  deflated: number;
  made: number;
  /** Bytes of the parts before and as stored. */
  raw: number;
  stored: number;
}

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/**
 * Stores parts: each is tried with the filters that suit it and kept as the smallest of those deflated, or as it is if
 * none is smaller. What is deflated is kept under .cache/ by the hash of what went in and of the compressor's source,
 * and is inflated again before it is used, to be sure it comes back. Threads are started as they are first needed.
 */
export class PartStore {
  /** Parts deflated rather than taken from the cache. */
  made = 0;
  readonly workers: number;
  private readonly cache: string | null;
  private readonly compressor = sha(readFileSync(join(import.meta.dir, "deflate.ts")));
  private readonly threads: ReturnType<typeof pool>;

  constructor(opts: { workers?: number; cache?: string | null } = {}) {
    this.cache = opts.cache === undefined ? PART_CACHE : opts.cache;
    this.workers = opts.workers ?? availableParallelism();
    this.threads = pool(this.workers);
  }

  private async deflated(data: Uint8Array): Promise<Uint8Array> {
    const key = sha(this.compressor + sha(data));
    const path = this.cache && join(this.cache, key.slice(0, 2), key);
    if (path) {
      try {
        return readFileSync(path);
      } catch {
        // Not kept yet.
      }
    }
    const out = await this.threads.run(data);
    this.made++;
    if (path) {
      mkdirSync(join(this.cache!, key.slice(0, 2)), { recursive: true });
      writeFileSync(`${path}.${process.pid}.tmp`, out);
      renameSync(`${path}.${process.pid}.tmp`, path);
    }
    return out;
  }

  /** `kept` as it is stored, from `filtered`, what each of `filters` makes of it. `what` names it where it does not come back. */
  async smallest(kept: Uint8Array, filtered: readonly Uint8Array[], filters: readonly Filter[], what: string): Promise<Uint8Array> {
    let best = kept;
    for (const [k, data] of filtered.entries()) {
      const out = await this.deflated(data);
      const back = unfilterPart(new Uint8Array(inflateRawSync(out)), kept.length);
      if (!back || Buffer.compare(back, kept) !== 0) throw new Error(`store: a part of ${what} does not come back from filter ${filters[k]![0]}`);
      if (out.length < best.length) best = out;
    }
    return best;
  }

  /** A part with no filter of its own to undo: `raw` as it is stored. */
  part(raw: Uint8Array, filters: readonly Filter[], what: string): Promise<Uint8Array> {
    return this.smallest(raw, filters.map(([filter, numbers]) => filterPart(raw, filter, numbers)), filters, what);
  }

  close(): Promise<unknown> {
    return this.threads.close();
  }
}

/**
 * The files with every ranged one remade of its parts, stored (PartStore), one after another behind a header of its
 * own, and the manifest changed to say where each part now is and how many bytes it is stored in. A surface is first
 * made what its filter gives back, and hashed again.
 */
export async function storeParts(files: readonly SplitFile[], manifest: Manifest, opts: StoreOptions = {}): Promise<{ files: SplitFile[]; report: StoreReport }> {
  const store = new PartStore(opts);
  const report: StoreReport = { parts: 0, deflated: 0, made: 0, raw: 0, stored: 0 };
  const only = (f: number): boolean => files[f]!.role !== "boot" && (opts.only?.includes(f) ?? true);
  const lists = partsOf(files, manifest);
  const stored: Uint8Array[][] = lists.map(() => []);
  /** Parts not yet begun, as file and place in its list. A few more are under way than there are threads, so no more than those are held filtered. */
  const todo = lists.flatMap((list, f) => (only(f) ? list.map((_, k) => [f, k] as const) : []));
  const work = async (): Promise<void> => {
    for (let next = todo.shift(); next; next = todo.shift()) {
      const [f, k] = next;
      const p = lists[f]![k]!;
      const raw = files[f]!.bytes.subarray(p.at, p.at + p.bytes);
      if (raw.length !== p.bytes) throw new Error(`store: a part of ${files[f]!.name} lies outside it`);
      const filtered = p.filters.map(([filter, numbers]) => filterPart(raw, filter, numbers));
      const kept = p.hashed ? unfilterPart(filtered[0]!, p.bytes)! : raw;
      p.hashed?.(partHash(kept));
      stored[f]![k] = await store.smallest(kept, filtered, p.filters, files[f]!.name);
    }
  };
  try {
    await Promise.all(Array.from({ length: store.workers * 2 }, work));
    report.made = store.made;
    const out = files.map((file, f): SplitFile => {
      if (!only(f)) return file;
      const list = lists[f]!;
      const body = stored[f]!;
      const bytes = new Uint8Array(body.reduce((sum, b) => sum + b.length, file.role === "tex" ? TEXTURE_HEADER_BYTES : PARTS_HEADER_BYTES));
      const view = new DataView(bytes.buffer);
      if (file.role === "tex") {
        // The texture file's own header, saying its parts are stored.
        bytes.set(file.bytes.subarray(0, TEXTURE_HEADER_BYTES));
        view.setUint16(4, STORED_TEXTURE_VERSION, true);
      } else {
        view.setUint32(0, PARTS_MAGIC, true);
        view.setUint16(4, PARTS_VERSION, true);
      }
      let at = file.role === "tex" ? TEXTURE_HEADER_BYTES : PARTS_HEADER_BYTES;
      list.forEach((p, k) => {
        const b = body[k]!;
        bytes.set(b, at);
        p.put(at, b.length);
        report.parts++;
        report.raw += p.bytes;
        report.stored += b.length;
        if (b.length < p.bytes) report.deflated++;
        at += b.length;
      });
      manifest.files[f]!.bytes = bytes.length;
      return { ...file, name: file.role === "mesh" ? file.name.replace(/\.snpk$/, ".snpt") : file.name, bytes };
    });
    out.forEach((f, i) => (manifest.files[i]!.name = f.name));
    manifest.version = MANIFEST_VERSION;
    return { files: out, report };
  } finally {
    await store.close();
  }
}
