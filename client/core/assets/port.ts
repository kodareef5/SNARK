// How the asset library asks for bytes and hears of them. Core decides what is wanted and in what order. A browser zone
// fetches, checks and caches. A stub: nothing implements it until assets stream.

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
  /** Higher is sooner. Asking again with another priority moves a request in the queue. */
  priority: number;
}

export interface AssetArrival {
  slot: number;
  /** Null when it failed, and `fail` says how. */
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
  /** The texture formats the graphics card takes, as bits. */
  readonly formats: number;
  readonly cache: { used: number; limit: number; mode: "disk" | "memory" | "none" };
}
