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
   * Trees, rocks and bushes near: the chunks round the body's the near node field holds, and the band, in metres from the
   * camera to a node's foot, over which the near store's draw of a node hands over to the far store's (render/hand.ts).
   * A chunk changes hands no nearer the body than `chunks` chunks, and the camera stands at most 3.5 m from the eye, so
   * the band ends before that and a chunk is drawn alike on both sides of the change.
   */
  readonly nodes: { readonly chunks: number; readonly band: readonly [number, number] };
  /**
   * Sun shadows: how many cascades, each map's side in texels, how far from the camera they reach in metres, how many
   * compared taps a lookup takes, how much of the splits is logarithmic rather than even, and whether the farthest
   * cascade is drawn only every other frame. No cascades for none.
   */
  readonly shadows: { readonly cascades: number; readonly size: number; readonly distance: number; readonly taps: number; readonly blend: number; readonly everyOther: boolean };
  /**
   * What a touch-first device draws on this tier in place of the tier's own values, or null for the same (forTouch), and
   * whether its settings offer the tier at all. Each value is a phone's report's (planning/decisions.md, M2's rows).
   */
  readonly touch: { readonly shadows?: Tier["shadows"]; readonly offered?: boolean } | null;
  /** Cloud layers over the dome. */
  readonly clouds: number;
  /** The sea: "flat", one see-through colour as low poly draws it, or "simple": the sky reflected, a glint, lighter over shallows. */
  readonly water: "flat" | "simple";
}

const MB = 1024 * 1024;

// The touch rule, from the iPhone's kept reports (planning/reference/device-reports, D349): a depth pass into a 1,024
// map costs 0.18 ms per 100,000 triangles against 0.38 into a 2,048 one, and a lookup of 1 compared tap 0.06 ms a
// megapixel against 0.19 for 4 and 0.49 for 9 (the quick look of 07-35-24). Ultra draws at the phone's own three pixels
// a side and broke the ladder at 256 to 512 draws and 64 to 128 near rocks where high held 1,024 and 128 (the ladders of
// 07-43-00 and 08-19-25), and its textures may take 2.4 GB where the phone's tab was dropped at 2 GB, so a phone is not
// offered it.

export const TIERS: readonly Tier[] = [
  {
    name: "lowpoly", texture: 0, textureShare: 0, view: 256, bones: 8192, threshold: 0.44, finest: 1, instanced: 160, pixelRatio: 1, gpuBytes: 96 * MB, uploadBytes: 0.5 * MB, diskBytes: 256 * MB,
    lit: false, split: 0, reach: { bases: 1024, trees: 500, rocks: 0, bushes: 0 }, fade: 0.1, nodes: { chunks: 3, band: [152, 184] }, shadows: { cascades: 0, size: 0, distance: 0, taps: 0, blend: 0, everyOther: false }, touch: null, clouds: 0, water: "flat",
  },
  {
    name: "medium", texture: 1024, textureShare: 0.6, view: 512, bones: 16384, threshold: 0.22, finest: 0, instanced: 256, pixelRatio: 1.5, gpuBytes: 512 * MB, uploadBytes: 1 * MB, diskBytes: 2048 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 1200, rocks: 600, bushes: 300 }, fade: 0.1, nodes: { chunks: 3, band: [152, 184] }, shadows: { cascades: 2, size: 2048, distance: 64, taps: 4, blend: 0.8, everyOther: false }, touch: { shadows: { cascades: 2, size: 1024, distance: 64, taps: 1, blend: 0.8, everyOther: false } }, clouds: 2, water: "simple",
  },
  {
    name: "high", texture: 2048, textureShare: 0.6, view: 1024, bones: 32768, threshold: 0.14, finest: 0, instanced: 384, pixelRatio: 2, gpuBytes: 1536 * MB, uploadBytes: 2 * MB, diskBytes: 8192 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 2000, rocks: 900, bushes: 500 }, fade: 0.1, nodes: { chunks: 4, band: [216, 248] }, shadows: { cascades: 3, size: 2048, distance: 128, taps: 9, blend: 0.85, everyOther: false }, touch: { shadows: { cascades: 3, size: 1024, distance: 128, taps: 1, blend: 0.85, everyOther: false } }, clouds: 2, water: "simple",
  },
  {
    name: "ultra", texture: 4096, textureShare: 0.6, view: 2048, bones: 65536, threshold: 0.08, finest: 0, instanced: 512, pixelRatio: 0, gpuBytes: 4096 * MB, uploadBytes: 4 * MB, diskBytes: 24576 * MB,
    lit: true, split: 384, reach: { bases: 2048, trees: 3000, rocks: 1200, bushes: 600 }, fade: 0.1, nodes: { chunks: 5, band: [280, 312] }, shadows: { cascades: 4, size: 2048, distance: 192, taps: 9, blend: 0.9, everyOther: false }, touch: { offered: false }, clouds: 2, water: "simple",
  },
];

/** What a new player gets. */
export const DEFAULT_TIER: Tier["name"] = "medium";

export function tierOf(name: string): Tier {
  return TIERS.find((t) => t.name === name) ?? TIERS.find((t) => t.name === DEFAULT_TIER)!;
}

const touched = new Map<Tier, Tier>();

/** The rule for touch-first devices: a tier as one draws it, the same copy each time, since the renderer keeps programs by the tier. */
export function forTouch(tier: Tier, touchFirst: boolean): Tier {
  if (!touchFirst || !tier.touch) return tier;
  const { offered: _, ...values } = tier.touch;
  return touched.get(tier) ?? touched.set(tier, { ...tier, ...values }).get(tier)!;
}

/** The tiers the settings offer: on a touch-first device, those whose touch rule does not leave them out. */
export const offeredTiers = (touchFirst: boolean): readonly Tier[] => TIERS.filter((t) => !touchFirst || t.touch?.offered !== false);
