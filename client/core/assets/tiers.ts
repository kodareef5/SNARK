// The graphics tiers a player chooses between. A tier sets how much detail is asked for and how much memory it may take,
// how far the far layer reaches, and whether light, sky, shadows and the sea are drawn as on the lit tiers (medium and
// up) or as low poly has always drawn them. The shadow, cloud and water fields wait for the code that reads them, and
// `instanced` for stand-ins.

import type { CityLevel } from "../render/farcity.ts";

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
  /**
   * How far off far things are drawn, in metres: bases as blocks, the map's own buildings (render/farcity.ts), and trees,
   * rocks and bushes at their coarsest level. 0 for none.
   */
  readonly reach: { readonly bases: number; readonly city: number; readonly trees: number; readonly rocks: number; readonly bushes: number };
  /** The map's own buildings far off: each form a tile takes, finest first, to how far from the camera (render/farcity.ts). */
  readonly city: { readonly levels: readonly CityLevel[] };
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
  readonly touch: { readonly shadows?: Tier["shadows"]; readonly gpuBytes?: number; readonly offered?: boolean } | null;
  /**
   * What a frame may spend (render/budget.ts): triangles, which crowns near give up for what stands above them in the
   * frame's order, and draws, which are counted and told. From the iPhone's tree order (D423) on medium: the young wood
   * held 60 a second at 2.1 M triangles and the elder oaks took 6.5 ms more for each million past it.
   */
  readonly budget: { readonly triangles: number; readonly draws: number };
  /** How many times the tier's threshold a body's level may err by: 1, and more at the governor's last step. */
  readonly bodyError: number;
  /** Cloud layers over the dome. */
  readonly clouds: number;
  /** The sea: "flat", one see-through colour as low poly draws it, or "simple": the sky reflected, a glint, lighter over shallows. */
  readonly water: "flat" | "simple";
  /**
   * Small details (client/core/details/): the most particles alive, the share of a burst's count made, how far each
   * effect's reach is taken, and the most of the screen the blended ones may cover, in screens.
   */
  readonly details: { readonly pool: number; readonly share: number; readonly reach: number; readonly fill: number };
}

const MB = 1024 * 1024;
// The far city's levels, each drawn to `to` metres (render/farcity.ts): every box, touching boxes merged, which is the
// near drawing; the lattice, boxes merged across half a metre and those of 2.1 m or less left out, which changes 1% of
// pixels or less; a building's mass in cells `size` metres wide and 4 m tall.
const boxes = (to: number): CityLevel => ({ to, gap: 0.01, least: 0, cell: 0, tall: 0 });
const lattice = (to: number): CityLevel => ({ to, gap: 0.5, least: 2.1, cell: 0, tall: 0 });
const mass = (to: number, size: number): CityLevel => ({ to, gap: -1, least: 0, cell: size, tall: 4 });

// The touch rule, from the iPhone's kept reports (planning/reference/device-reports, D349): a depth pass into a 1,024
// map costs 0.18 ms per 100,000 triangles against 0.38 into a 2,048 one, and a lookup of 1 compared tap 0.06 ms a
// megapixel against 0.19 for 4 and 0.49 for 9 (the quick look of 07-35-24). Ultra draws at the phone's own three pixels
// a side and broke the ladder at 256 to 512 draws and 64 to 128 near rocks where high held 1,024 and 128 (the ladders of
// 07-43-00 and 08-19-25), and its textures may take 2.4 GB where the phone's tab was dropped at 2 GB, so a phone is not
// offered it. iOS ends a tab short of memory without the card saying so (D123 never hears of it): the device page's
// memory step lost the iPhone's tab between 1.5 and 2 GB of textures, where high's card may hold 1.9 GB with its
// overflow. High's card on a phone is a first guess, 1.25 GB with the overflow, for the phone to confirm.
const PHONE_HIGH_CARD = 1024 * MB;

export const TIERS: readonly Tier[] = [
  {
    name: "lowpoly", texture: 0, textureShare: 0, view: 256, bones: 8192, threshold: 0.44, finest: 1, instanced: 160, pixelRatio: 1, gpuBytes: 96 * MB, uploadBytes: 0.5 * MB, diskBytes: 256 * MB,
    lit: false, split: 0, reach: { bases: 1024, city: 2048, trees: 500, rocks: 0, bushes: 0 }, fade: 0.1, city: { levels: [boxes(340), lattice(600), mass(Infinity, 8)] }, nodes: { chunks: 3, band: [152, 184] }, shadows: { cascades: 0, size: 0, distance: 0, taps: 0, blend: 0, everyOther: false }, touch: null, clouds: 0, water: "flat",
    details: { pool: 384, share: 0.5, reach: 0.6, fill: 0.5 }, budget: { triangles: 2e6, draws: 2048 }, bodyError: 1,
  },
  {
    name: "medium", texture: 1024, textureShare: 0.6, view: 512, bones: 16384, threshold: 0.22, finest: 0, instanced: 256, pixelRatio: 1.5, gpuBytes: 512 * MB, uploadBytes: 1 * MB, diskBytes: 2048 * MB,
    lit: true, split: 384, reach: { bases: 2048, city: 2048, trees: 1200, rocks: 600, bushes: 300 }, fade: 0.1, city: { levels: [boxes(400), lattice(900), mass(Infinity, 8)] }, nodes: { chunks: 3, band: [152, 184] }, shadows: { cascades: 2, size: 2048, distance: 64, taps: 4, blend: 0.8, everyOther: false }, touch: { shadows: { cascades: 2, size: 1024, distance: 64, taps: 1, blend: 0.8, everyOther: false } }, clouds: 2, water: "simple",
    details: { pool: 1536, share: 1, reach: 1, fill: 1 }, budget: { triangles: 2e6, draws: 1024 }, bodyError: 1,
  },
  {
    name: "high", texture: 2048, textureShare: 0.6, view: 1024, bones: 32768, threshold: 0.14, finest: 0, instanced: 384, pixelRatio: 2, gpuBytes: 1536 * MB, uploadBytes: 2 * MB, diskBytes: 8192 * MB,
    lit: true, split: 384, reach: { bases: 2048, city: 3072, trees: 2000, rocks: 900, bushes: 500 }, fade: 0.1, city: { levels: [boxes(500), lattice(1300), mass(2000, 4), mass(Infinity, 8)] }, nodes: { chunks: 4, band: [216, 248] }, shadows: { cascades: 3, size: 2048, distance: 128, taps: 9, blend: 0.85, everyOther: false }, touch: { shadows: { cascades: 3, size: 1024, distance: 128, taps: 1, blend: 0.85, everyOther: false }, gpuBytes: PHONE_HIGH_CARD }, clouds: 2, water: "simple",
    details: { pool: 3072, share: 1, reach: 1, fill: 1.5 }, budget: { triangles: 4e6, draws: 2048 }, bodyError: 1,
  },
  {
    name: "ultra", texture: 4096, textureShare: 0.6, view: 2048, bones: 65536, threshold: 0.08, finest: 0, instanced: 512, pixelRatio: 0, gpuBytes: 4096 * MB, uploadBytes: 4 * MB, diskBytes: 24576 * MB,
    lit: true, split: 384, reach: { bases: 2048, city: 4096, trees: 3000, rocks: 1200, bushes: 600 }, fade: 0.1, city: { levels: [boxes(600), lattice(1800), mass(2800, 4), mass(Infinity, 8)] }, nodes: { chunks: 5, band: [280, 312] }, shadows: { cascades: 4, size: 2048, distance: 192, taps: 9, blend: 0.9, everyOther: false }, touch: { offered: false }, clouds: 2, water: "simple",
    details: { pool: 6144, share: 1, reach: 1.25, fill: 2 }, budget: { triangles: 8e6, draws: 4096 }, bodyError: 1,
  },
];

/** What a new player gets. */
export const DEFAULT_TIER: Tier["name"] = "medium";

export function tierOf(name: string): Tier {
  for (const t of TIERS) if (t.name === name) return t;
  return tierOf(DEFAULT_TIER);
}

const touched = new Map<Tier, Tier>();

/** The rule for touch-first devices: a tier as one draws it, the same copy each time, since the renderer keeps programs by the tier. */
export function forTouch(tier: Tier, touchFirst: boolean): Tier {
  if (!touchFirst || !tier.touch) return tier;
  const had = touched.get(tier);
  if (had) return had;
  const { offered: _, ...values } = tier.touch;
  return touched.set(tier, { ...tier, ...values }).get(tier)!;
}

/** The tiers the settings offer: on a touch-first device, those whose touch rule does not leave them out. */
export const offeredTiers = (touchFirst: boolean): readonly Tier[] => TIERS.filter((t) => !touchFirst || t.touch?.offered !== false);
