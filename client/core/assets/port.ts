// How the asset library asks for bytes and hears of them. Core decides what is wanted and in what order. A browser zone
// fetches, inflates, checks and caches. Tests and the benchmark use a network made of numbers (tests/fixtures/assetnet.ts).

import { storedBytes, storedStep, type ManifestClips, type ManifestLevel, type ManifestTexture } from "../../../shared/pack/manifest.ts";
import { blockOf, stepBytes, type TextureFormat } from "../../../shared/pack/texture.ts";
import type { KeepReport } from "./bulk.ts";
import type { StorageInfo } from "./storage.ts";

/** Why a part did not come: the network, bytes that do not have the hash listed, or a range the file does not have. */
export const FAIL_NET = 1;
export const FAIL_HASH = 2;
export const FAIL_RANGE = 3;

/**
 * A run of bytes in an asset file, and the hash its bytes must have. A part stored deflated (shared/pack/stored.ts)
 * says how many bytes it inflates to, and the hash is of those.
 */
export interface AssetPart {
  offset: number;
  length: number;
  hash: string;
  inflated?: number;
}

/** Parts `from` up to `to` of a level, where its file has them. */
export function levelParts(level: ManifestLevel, from: number, to: number): AssetPart[] {
  const out: AssetPart[] = [];
  let at = level.at;
  for (let k = 0; k < to; k++) {
    const p = level.parts[k]!;
    if (k === 1 && level.surface) at = level.surface.at;
    if (k >= from) out.push(p.stored === undefined ? { offset: at, length: p.bytes, hash: p.hash } : { offset: at, length: p.stored, hash: p.hash, inflated: p.bytes });
    at += storedBytes(p);
  }
  return out;
}

/** A skeleton's clips or a page, where its file has them. */
export function wholePart(e: Pick<ManifestClips, "at" | "part">): AssetPart {
  const p = e.part;
  return p.stored === undefined ? { offset: e.at, length: p.bytes, hash: p.hash } : { offset: e.at, length: p.stored, hash: p.hash, inflated: p.bytes };
}

/** Steps 0 to `last` of a texture in a variant it has, where its file has them. */
export function textureParts(tex: ManifestTexture, format: TextureFormat, last: number): AssetPart[] {
  const v = tex.in[format]!;
  const out: AssetPart[] = [];
  for (let k = 0, at = v.at; k <= last; k++) {
    const length = storedStep(v, format, tex.role, k);
    const bytes = stepBytes(format, tex.role, k, blockOf(format, v));
    out.push(length < bytes ? { offset: at, length, hash: v.hash[k]!, inflated: bytes } : { offset: at, length, hash: v.hash[k]! });
    at += length;
  }
  return out;
}

/**
 * How a part's bytes are asked for: `length` bytes of the file from `from`, by one range, never through the browser's
 * cache. Chrome sends the ranges of one file that go through its cache one at a time, every texture is a range of one
 * file and every mesh level of another, and the worker keeps its own copy (client/assets/assets-worker.ts).
 */
export function rangeAsk<Signal>(from: number, length: number, signal: Signal): { headers: { range: string }; signal: Signal; cache: "no-store" } {
  return { headers: { range: `bytes=${from}-${from + length - 1}` }, signal, cache: "no-store" };
}

export interface AssetRequest {
  /** The level of a mesh, its surface, the step of a texture, a skeleton's clips or a page, the bytes are for. */
  slot: number;
  /** Identifies this use of the slot when the caller can cancel and reissue it. */
  generation?: number;
  /** Index of the pack file in the manifest. */
  file: number;
  parts: readonly AssetPart[];
  /** Higher is sooner. */
  priority: number;
  /** Fetch it from the network whatever a cache holds: what the cache gave had the wrong hash. */
  fresh: boolean;
}

export interface AssetArrival {
  slot: number;
  /** Echoed from the request, including when the request failed. */
  generation?: number;
  /** Every part of the request, one after another in the order asked. Null when any failed, and `fail` says how: a FAIL_ code. */
  data: Uint8Array | null;
  fail: number;
  /** Bytes that came over the network, and bytes that came from the port's cache, as they are stored. */
  fetched: number;
  cached: number;
  /** Of `cached`, the bytes from memory and those from the disk, where the port tells them apart. */
  memory?: number;
  disk?: number;
  /** For a request that failed on the network, the HTTP status the server answered, or 0 for no answer. */
  status?: number;
  /** The ms the port took over it, from the ask to its answer, where it says. */
  took?: number;
}

/**
 * What the asset worker has done since the page opened it (client/assets/assets-worker.ts), sent with its report at
 * most once a second. Bytes are as stored, before they are inflated.
 */
export interface WorkerTotals {
  /**
   * Parts that came from memory, from the disk and over the network, and their bytes. The network's bytes are counted
   * for every fetch that ended, a failed or cancelled request's and the bulk fill's too, so the page's own counts of what
   * it took are less; a fetch cut off part way says none.
   */
  memoryParts: number;
  memoryBytes: number;
  diskParts: number;
  diskReadBytes: number;
  netParts: number;
  netBytes: number;
  /** Requests given up at the time limit, which the page hears of as network failures with no status. */
  timeouts: number;
  /**
   * Parts named to keep (`fill`); those the bulk fill fetched and wrote to disk, and their bytes; those it gave up after
   * their tries; and fetches of its runs that ran out of time, a part each. What is still to come is in `keep`.
   */
  fillAsked: number;
  fillDone: number;
  fillBytes: number;
  fillFailed: number;
  fillTimeouts: number;
}

export interface AssetPort {
  request(r: AssetRequest): void;
  cancel(slot: number): void;
  /** Moves what has arrived since the last call into `out`. Returns how many. */
  take(out: AssetArrival[]): number;
  /**
   * Names parts the player may ask to keep: everything the tier can fetch (Residency.download). The port counts them,
   * keeps them over other parts when it makes room, and fetches those it lacks while `keep` says to. None is handed over.
   */
  fill(parts: readonly { file: number; part: AssetPart }[]): void;
  /**
   * Bytes kept between visits and the most that may be, where they are kept, and how many parts named are still to
   * come while keeping. A port in a browser says besides why the disk is not used, if it is not: "none" where the
   * browser gives no folder (a private window, or no file system), "full" where writes failed twice; how many disk
   * writes are under way; what it has done since it was opened; and how the parts named stand.
   */
  readonly cache: { used: number; limit: number; mode: "disk" | "memory" | "none"; filling: number; off?: "" | "none" | "full"; writing?: number; totals?: WorkerTotals; keep?: KeepReport };
  /** How the files come, as the browser names it: "http/1.1", "h2", "h3", or "" while not known. */
  readonly protocol: string;
  /** What the browser says of keeping the files and of its room for them, where there is a browser. */
  readonly storage?: StorageInfo;
  /**
   * The Storage tab's controls, where the port has a disk. `keep`: a KEEP_ mode (bulk.ts) for the parts named, and with
   * `reset` they are forgotten first, for a new set. `clear` deletes every saved part. `limit` sets the most bytes the
   * disk keeps. `named` counts the parts given to `fill`, which `cache.totals.fillAsked` reaches once the port has them all.
   */
  keep?(mode: number, reset?: boolean): void;
  clear?(): void;
  limit?(bytes: number): void;
  readonly named?: number;
}
