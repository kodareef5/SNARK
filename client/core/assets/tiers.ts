// The graphics tiers a player chooses between. A tier sets how much detail is asked for and how much memory it may take.
// A stub: the table is here and nothing reads it until levels are chosen by screen error and assets stream.

export interface Tier {
  readonly name: "lowpoly" | "medium" | "high" | "ultra";
  /** The widest texture loaded, in pixels. 0 for none: flat palette colours, as the game was first drawn. */
  readonly texture: number;
  /** The error on screen, in pixels, above which a finer level is asked for. */
  readonly threshold: number;
  /** The finest level ever drawn. 0 is the finest there is. */
  readonly finest: number;
  /** How far off single pieces are drawn, in metres. Beyond it a chunk is one stand-in. */
  readonly instanced: number;
  /** The most device pixels drawn for one CSS pixel. 0 for as many as the screen has. */
  readonly pixelRatio: number;
  /** Bytes of meshes and textures kept on the graphics card. */
  readonly gpuBytes: number;
  /** Bytes sent to the graphics card in one frame. */
  readonly uploadBytes: number;
  /** Bytes kept on disk between visits. */
  readonly diskBytes: number;
}

const MB = 1024 * 1024;

export const TIERS: readonly Tier[] = [
  { name: "lowpoly", texture: 0, threshold: 4, finest: 1, instanced: 160, pixelRatio: 1, gpuBytes: 96 * MB, uploadBytes: 0.5 * MB, diskBytes: 256 * MB },
  { name: "medium", texture: 1024, threshold: 2, finest: 0, instanced: 256, pixelRatio: 1.5, gpuBytes: 512 * MB, uploadBytes: 1 * MB, diskBytes: 2048 * MB },
  { name: "high", texture: 2048, threshold: 1.25, finest: 0, instanced: 384, pixelRatio: 2, gpuBytes: 1536 * MB, uploadBytes: 2 * MB, diskBytes: 8192 * MB },
  { name: "ultra", texture: 4096, threshold: 0.75, finest: 0, instanced: 512, pixelRatio: 0, gpuBytes: 4096 * MB, uploadBytes: 4 * MB, diskBytes: 24576 * MB },
];

/** What a new player gets. */
export const DEFAULT_TIER: Tier["name"] = "medium";

export function tierOf(name: string): Tier {
  return TIERS.find((t) => t.name === name) ?? TIERS.find((t) => t.name === DEFAULT_TIER)!;
}
