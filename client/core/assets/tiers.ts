// The graphics tiers a player chooses between. A tier sets how much detail is asked for and how much memory it may take,
// how far the far layer reaches, and whether light, sky, shadows and the sea are drawn as on the lit tiers (medium and
// up) or as low poly has always drawn them. The shadow, cloud and water fields wait for the code that reads them, and
// `instanced` for stand-ins.

export interface Tier {
  readonly name: "lowpoly" | "medium" | "high" | "ultra";
  /** The widest texture loaded, in pixels. 0 for none: flat palette colours, as the game was first drawn. */
  readonly texture: number;
  /** The share of `gpuBytes` textures may hold. Meshes use what textures leave. */
  readonly textureShare: number;
  /** The most bodies a client asks its server to show it at once. */
  readonly view: number;
  /** The most bones posed in a frame. A body past it is drawn rigid on one bone. */
  readonly bones: number;
  /**
   * The error on screen, in pixels, above which a finer level is asked for. A level's error is the distance 95 points in
   * 100 of it lie within (tools/pack/error.ts), so its worst point moves several times this many pixels at a switch.
   */
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
  /** Drawn with the lit programs: light, exposure and tone from the frame block, the dome, haze, sun shadows and the sea. */
  readonly lit: boolean;
  /** Metres from the camera at which the far depth range begins. 0 for one range. */
  readonly split: number;
  /** How far off far things are drawn, in metres: bases as blocks, and trees, rocks and bushes at their coarsest level. 0 for none. */
  readonly reach: { readonly bases: number; readonly trees: number; readonly rocks: number; readonly bushes: number };
  /** The share of a reach over which a far thing fades out. */
  readonly fade: number;
  /**
   * Sun shadows: how many cascades, each map's side in texels, how far from the camera they reach in metres, how many
   * compared taps a lookup takes, how much of the splits is logarithmic rather than even, and whether the farthest
   * cascade is drawn only every other frame. No cascades for none.
   */
  readonly shadows: { readonly cascades: number; readonly size: number; readonly distance: number; readonly taps: number; readonly blend: number; readonly everyOther: boolean };
  /** Cloud layers over the dome. */
  readonly clouds: number;
  /** The sea: "flat", one see-through colour as low poly draws it, or "simple": the sky reflected, a glint, lighter over shallows. */
  readonly water: "flat" | "simple";
}

const MB = 1024 * 1024;

export const TIERS: readonly Tier[] = [
  {
    name: "lowpoly", texture: 0, textureShare: 0, view: 256, bones: 8192, threshold: 0.44, finest: 1, instanced: 160, pixelRatio: 1, gpuBytes: 96 * MB, uploadBytes: 0.5 * MB, diskBytes: 256 * MB,
    lit: false, split: 0, reach: { bases: 1024, trees: 500, rocks: 0, bushes: 0 }, fade: 0.1, shadows: { cascades: 0, size: 0, distance: 0, taps: 0, blend: 0, everyOther: false }, clouds: 0, water: "flat",
  },
  {
    name: "medium", texture: 1024, textureShare: 0.6, view: 512, bones: 16384, threshold: 0.22, finest: 0, instanced: 256, pixelRatio: 1.5, gpuBytes: 512 * MB, uploadBytes: 1 * MB, diskBytes: 2048 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 1200, rocks: 600, bushes: 300 }, fade: 0.1, shadows: { cascades: 2, size: 2048, distance: 64, taps: 4, blend: 0.8, everyOther: false }, clouds: 2, water: "simple",
  },
  {
    name: "high", texture: 2048, textureShare: 0.6, view: 1024, bones: 32768, threshold: 0.14, finest: 0, instanced: 384, pixelRatio: 2, gpuBytes: 1536 * MB, uploadBytes: 2 * MB, diskBytes: 8192 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 2000, rocks: 900, bushes: 500 }, fade: 0.1, shadows: { cascades: 3, size: 2048, distance: 128, taps: 9, blend: 0.85, everyOther: false }, clouds: 2, water: "simple",
  },
  {
    name: "ultra", texture: 4096, textureShare: 0.6, view: 2048, bones: 65536, threshold: 0.08, finest: 0, instanced: 512, pixelRatio: 0, gpuBytes: 4096 * MB, uploadBytes: 4 * MB, diskBytes: 24576 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 3000, rocks: 1200, bushes: 600 }, fade: 0.1, shadows: { cascades: 4, size: 2048, distance: 192, taps: 9, blend: 0.9, everyOther: false }, clouds: 2, water: "simple",
  },
];

/** What a new player gets. */
export const DEFAULT_TIER: Tier["name"] = "medium";

export function tierOf(name: string): Tier {
  return TIERS.find((t) => t.name === name) ?? TIERS.find((t) => t.name === DEFAULT_TIER)!;
}
