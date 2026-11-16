// The ranged files of a build as it serves them. Every part a client fetches by range (a level's indices and vertices,
// its surface, its skin, a skeleton's clips, a step of a texture) is stored deflated where that makes it smaller, so a range brings fewer
// bytes and the client inflates them (shared/pack/stored.ts). The boot file is fetched whole and is left as it is.

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
type Filter = readonly [number, readonly number[]];

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

/** Every part of every ranged file, by file, in the order of the file. */
function partsOf(files: readonly SplitFile[], manifest: Manifest): Part[][] {
  const parts: Part[][] = files.map(() => []);
  for (const mesh of manifest.meshes) {
    for (const level of mesh.levels) {
      if (files[level.file]!.role !== "boot") {
        parts[level.file]!.push({ at: level.at, bytes: level.parts[0]!.bytes, filters: [[FILTER_LEVEL, [level.tris * 3, level.index]], [FILTER_NONE, []]], put: (at, stored) => void ((level.at = at), stored < level.parts[0]!.bytes && (level.parts[0]!.stored = stored)) });
      }
      const rest = level.surface ?? level;
      if (files[rest.file]!.role === "boot") continue;
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
  for (const e of manifest.clips ?? []) parts[e.file]!.push({ at: e.at, bytes: e.part.bytes, filters: [[FILTER_NONE, []]], put: (at, stored) => void ((e.at = at), stored < e.part.bytes && (e.part.stored = stored)) });
  for (const tex of manifest.textures ?? []) {
    for (const [format, v] of Object.entries(tex.in) as [TextureFormat, NonNullable<(typeof tex.in)[TextureFormat]>][]) {
      const stored: number[] = [];
      v.hash.forEach((_, step) => {
        const bytes = stepBytes(format, tex.role, step, blockOf(format, v));
        parts[v.file]!.push({
          at: v.at + stepOffset(format, tex.role, step, blockOf(format, v)),
          bytes,
          filters: textureFilters(format, tex.role, step),
          put: (to, size) => {
            if (step === 0) v.at = to;
            stored[step] = size;
            if (size < bytes) v.stored = stored;
          },
        });
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
 * The files with every ranged one remade of its parts, stored, one after another behind a header of its own, and the
 * manifest changed to say where each part now is and how many bytes it is stored in. Each part is tried with the
 * filters that suit it and kept as the smallest of those deflated, or as it is if none is smaller; a surface is first
 * made what its filter gives back, and hashed again. What is deflated is kept under .cache/ by the hash of what went in
 * and of the compressor's source, and every part is inflated again before it is written, to be sure it comes back.
 */
export async function storeParts(files: readonly SplitFile[], manifest: Manifest, opts: StoreOptions = {}): Promise<{ files: SplitFile[]; report: StoreReport }> {
  const cache = opts.cache === undefined ? PART_CACHE : opts.cache;
  const compressor = sha(readFileSync(join(import.meta.dir, "deflate.ts")));
  const workers = opts.workers ?? availableParallelism();
  const threads = pool(workers);
  const report: StoreReport = { parts: 0, deflated: 0, made: 0, raw: 0, stored: 0 };
  const deflated = async (data: Uint8Array): Promise<Uint8Array> => {
    const key = sha(compressor + sha(data));
    const path = cache && join(cache, key.slice(0, 2), key);
    if (path) {
      try {
        return new Uint8Array(readFileSync(path));
      } catch {
        // Not kept yet.
      }
    }
    const out = await threads.run(data);
    report.made++;
    if (path) {
      mkdirSync(join(cache!, key.slice(0, 2)), { recursive: true });
      writeFileSync(`${path}.${process.pid}.tmp`, out);
      renameSync(`${path}.${process.pid}.tmp`, path);
    }
    return out;
  };
  const lists = partsOf(files, manifest);
  const stored: Uint8Array[][] = lists.map(() => []);
  /** Parts not yet begun, as file and place in its list. A few more are under way than there are threads, so no more than those are held filtered. */
  const todo = lists.flatMap((list, f) => list.map((_, k) => [f, k] as const));
  const work = async (): Promise<void> => {
    for (let next = todo.shift(); next; next = todo.shift()) {
      const [f, k] = next;
      const p = lists[f]![k]!;
      const raw = files[f]!.bytes.subarray(p.at, p.at + p.bytes);
      if (raw.length !== p.bytes) throw new Error(`store: a part of ${files[f]!.name} lies outside it`);
      const filtered = p.filters.map(([filter, numbers]) => filterPart(raw, filter, numbers));
      const kept = p.hashed ? unfilterPart(filtered[0]!, p.bytes)! : raw;
      p.hashed?.(partHash(kept));
      let best: Uint8Array = kept;
      for (const [k, data] of filtered.entries()) {
        const out = await deflated(data);
        const back = unfilterPart(new Uint8Array(inflateRawSync(out)), p.bytes);
        if (!back || Buffer.compare(back, kept) !== 0) throw new Error(`store: a part of ${files[f]!.name} does not come back from filter ${p.filters[k]![0]}`);
        if (out.length < best.length) best = out;
      }
      stored[f]![k] = best;
    }
  };
  try {
    await Promise.all(Array.from({ length: workers * 2 }, work));
    const out = files.map((file, f): SplitFile => {
      if (file.role === "boot") return file;
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
    await threads.close();
  }
}
