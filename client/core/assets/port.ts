// How the asset library asks for bytes and hears of them. Core decides what is wanted and in what order. A browser zone
// fetches, checks and caches. Tests and the benchmark use a network made of numbers (tests/fixtures/assetnet.ts).

/** Why a part did not come: the network, bytes that do not have the hash listed, or a range the file does not have. */
export const FAIL_NET = 1;
export const FAIL_HASH = 2;
export const FAIL_RANGE = 3;

/** A run of bytes in a pack file, and the hash it must have. */
export interface AssetPart {
  offset: number;
  length: number;
  hash: string;
}

export interface AssetRequest {
  /** The level of a mesh, or the step of a texture, the bytes are for. */
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
  /** Null when it failed, and `fail` says how: a FAIL_ code. */
  data: Uint8Array | null;
  fail: number;
  /** Bytes that came over the network, and bytes that came from the disk cache. */
  fetched: number;
  cached: number;
}

export interface AssetPort {
  request(r: AssetRequest): void;
  cancel(slot: number): void;
  /** Moves what has arrived since the last call into `out`. Returns how many. */
  take(out: AssetArrival[]): number;
  /** Fetches parts into the cache and hands none of them over, so that they need not be fetched while playing. */
  fill(parts: readonly { file: number; part: AssetPart }[]): void;
  /** The texture formats the graphics card takes, as bits. */
  readonly formats: number;
  /** Bytes kept between visits and the most that may be, where they are kept, and how many parts asked for with `fill` are still to come. */
  readonly cache: { used: number; limit: number; mode: "disk" | "memory" | "none"; filling: number };
}
