// How the asset library asks for bytes and hears of them. Core decides what is wanted and in what order. A browser zone
// fetches, inflates, checks and caches. Tests and the benchmark use a network made of numbers (tests/fixtures/assetnet.ts).

import { storedBytes, storedStep, type ManifestClips, type ManifestLevel, type ManifestTexture } from "../../../shared/pack/manifest.ts";
import { blockOf, stepBytes, type TextureFormat } from "../../../shared/pack/texture.ts";

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

export interface AssetRequest {
  /** The level of a mesh, its surface, the step of a texture, a skeleton's clips or a page, the bytes are for. */
  slot: number;
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
  /** Every part of the request, one after another in the order asked. Null when any failed, and `fail` says how: a FAIL_ code. */
  data: Uint8Array | null;
  fail: number;
  /** Bytes that came over the network, and bytes that came from the disk cache, as they are stored. */
  fetched: number;
  cached: number;
  /** For a request that failed on the network, the HTTP status the server answered, or 0 for no answer. */
  status?: number;
}

export interface AssetPort {
  request(r: AssetRequest): void;
  cancel(slot: number): void;
  /** Moves what has arrived since the last call into `out`. Returns how many. */
  take(out: AssetArrival[]): number;
  /** Fetches parts into the cache and hands none of them over, so that they need not be fetched while playing. */
  fill(parts: readonly { file: number; part: AssetPart }[]): void;
  /** Bytes kept between visits and the most that may be, where they are kept, and how many parts asked for with `fill` are still to come. */
  readonly cache: { used: number; limit: number; mode: "disk" | "memory" | "none"; filling: number };
  /** How the files come, as the browser names it: "http/1.1", "h2", "h3", or "" while not known. */
  readonly protocol: string;
}
