// The graphics tiers a player chooses between. A tier sets how much detail is asked for and how much memory it may take,
// how far it sees and how far the far layer reaches, and whether light, sky, shadows and the sea are drawn as on the lit tiers (medium and
// up) or as low poly has always drawn them. Nothing reads `water` yet, since the sea is drawn as `lit` says, nor
// `instanced`, which waits for stand-ins.

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
  /**
   * The fewest canvas pixels a side drawn for one CSS pixel, reached by drawing a whole number of the screen's own for
   * each, which the browser scales down, as far as `canvas` pixels in all (canvasRatio). 0 for the screen's own.
   */
  readonly fewest: number;
  readonly canvas: number;
  /**
   * How long a pixel's footprint on a material's texture may be against its width and still be read at its width, where
   * the texture is seen at a glancing angle, as far as the card offers (EXT_texture_filter_anisotropic): 1 for read at
   * its length, as if seen head on.
   */
  readonly anisotropy: number;
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
   * Metres to the end of the view: the ground, the sea, lakes and the city past the far city (as blocks of its tops,
   * render/cityblocks.ts) are drawn to it, the haze gives way to the dome over its last fifth, and the camera's far plane
   * is set from it (camera.ts farPlane).
   */
  readonly viewDistance: number;
  /**
   * How far off far things are drawn, in metres: bases as blocks, the map's own buildings (render/farcity.ts), and trees,
   * rocks and bushes at their coarsest level, and the moving parts of statics that move when used (render/motion.ts), as far as
   * trees. 0 for none.
   */
  readonly reach: { readonly bases: number; readonly city: number; readonly trees: number; readonly rocks: number; readonly bushes: number; readonly parts: number };
  /** The map's own buildings far off: each form a tile takes, finest first, to how far from the camera (render/farcity.ts). */
  readonly city: { readonly levels: readonly CityLevel[] };
  /** The share of a reach over which a far thing fades out. */
  readonly fade: number;
  /**
   * Trees, rocks and bushes near: the chunks round the body's the near node field holds, and the band, in metres from the
   * camera to a node's foot, over which the near store's draw of a node hands over to the far store's (render/hand.ts).
   * A chunk changes hands no nearer the body than `chunks` chunks, and the camera stands at most 3.5 m from the eye, so
   * the band ends before that and a chunk is drawn alike on both sides of the change. With `levels`, a tree's own levels
   * pass one to the next by the same pattern, over that many ms, where a cell of trees changes level (hand.ts swapKeeps);
   * without, a cell of trees changes level at once.
   */
  readonly nodes: { readonly chunks: number; readonly band: readonly [number, number]; readonly levels?: number };
  /**
   * Sun shadows: how many cascades, each map's side in texels, how far from the camera they reach in metres, how many
   * compared taps a lookup takes, how much of the splits is logarithmic rather than even, and whether the farthest
   * cascade is drawn only every other frame. No cascades for none.
   */
  readonly shadows: { readonly cascades: number; readonly size: number; readonly distance: number; readonly taps: number; readonly blend: number; readonly everyOther: boolean };
  /**
   * What a touch-first device draws on this tier in place of the tier's own values, or null for the same (forTouch), and
   * whether its settings offer the tier at all. Each value is a phone's report's (planning/decisions.md, M2's rows), but
   * for what no phone has measured yet, which a phone draws as it did: materials read as if seen head on.
   */
  readonly touch: { readonly shadows?: Tier["shadows"]; readonly budget?: Tier["budget"]; readonly nodes?: Tier["nodes"]; readonly gpuBytes?: number; readonly finish?: Tier["finish"]; readonly city?: Tier["city"]; readonly fewest?: number; readonly anisotropy?: number; readonly viewDistance?: number; readonly offered?: boolean } | null;
  /**
   * The lit tiers' world finish (render/world-surfaces.ts): "full", three hashed cells of a tile with its normal and
   * packed maps and two noises; or "light", one cell, its base map and the large noise alone, which costs about two fifths as much over plain lighting.
   */
  readonly finish: "full" | "light";
  /**
   * The side each world finish's base colour and normal are kept at, a layer of an array a role, and its packed map at
   * half that (render/world-surfaces.ts `WorldFinishes`). 0 for none.
   */
  readonly finishes: number;
  /**
   * Whether a finish near the eye is read where the view's ray meets its painted height, a few steps into it
   * (render/world-surfaces.ts `relief`). No tier does: on ultra's street it cost more than the whole budget the finishes have there.
   */
  readonly relief: boolean;
  /**
   * What a frame may spend (render/budget.ts): triangles, which crowns near give up for what stands above them in the
   * frame's order, and draws, which are counted and told. From the iPhone's tree order (D423) on medium: the young wood
   * held 60 a second at 2.1 M triangles and the elder oaks took 6.5 ms more for each million past it. `spend`: how many
   * whole steps the squeeze may fall below none while the frame is under, each drawing nodes' levels twice as far; none
   * where left out. `spendTo`: the triangles a frame spending them may come to, short of the budget: on an M5 at 1080 px a
   * frame took about 10 ms and 1.6 ms more for each million triangles on the tree route (planning/workstreams/trees.md).
   */
  readonly budget: { readonly triangles: number; readonly draws: number; readonly spend?: number; readonly spendTo?: number };
  /** How many times the tier's threshold a body's level may err by: 1, and more at the governor's bodies step. */
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
  /**
   * The frame's finish (render/post.ts): drawn as light into a target of the shell's and finished in one pass, with
   * `bloom` the share of bloom's levels kept, the narrowest first (0 for no bloom); or null, each shader toning its own
   * light onto the canvas as medium has always drawn.
   */
  readonly post: { readonly bloom: number } | null;
  /** Whether bodies that move take the sky's light from what is under them (render/contact.ts). */
  readonly contact: boolean;
}

const MB = 1024 * 1024;
// The far city's levels, each drawn to `to` metres (render/farcity.ts): every box, touching boxes merged, which is the
// near drawing; the lattice, boxes merged across half a metre and those of 2.1 m or less left out, which changes 1% of
// pixels or less; on high and ultra the lattice bare of what is under 1.3 m across (beams, fins, sills, piers, half the
// lattice's faces), which from 800 m at 1080p and 900 m at 1440p is a pixel across or less and crawls, and changes 0.1 to
// 1.1% of the pixels of the views from the air; a building's mass in cells `size` metres wide and 4 m tall.
const boxes = (to: number): CityLevel => ({ to, gap: 0.01, least: 0, cell: 0, tall: 0 });
const lattice = (to: number): CityLevel => ({ to, gap: 0.5, least: 2.1, cell: 0, tall: 0 });
const bare = (to: number): CityLevel => ({ to, gap: 0.5, least: 2.1, cell: 0, tall: 0, thin: 1.3 });
const mass = (to: number, size: number): CityLevel => ({ to, gap: -1, least: 0, cell: size, tall: 4 });
/** `levels` each drawn `share` as far: the same forms, so nothing made of them is made again (render/farcity.ts). */
export const nearer = (levels: readonly CityLevel[], share: number): CityLevel[] => levels.map((l) => ({ ...l, to: l.to * share }));
const MEDIUM_CITY = [boxes(700), lattice(1100), bare(1500), mass(2000, 4), mass(Infinity, 8)];
const HIGH_CITY = [boxes(900), lattice(1300), bare(1700), mass(2300, 4), mass(Infinity, 8)];

// The touch rule, from the iPhone's kept reports (planning/reference/device-reports, D349): a depth pass into a 1,024
// map costs 0.18 ms per 100,000 triangles against 0.38 into a 2,048 one, and a lookup of 1 compared tap 0.06 ms a
// megapixel against 0.19 for 4 and 0.49 for 9 (the quick look of 07-35-24). Ultra draws at the phone's own three pixels
// a side and broke the ladder at 256 to 512 draws and 64 to 128 near rocks where high held 1,024 and 128 (the ladders of
// 07-43-00 and 08-19-25), and its textures may take 2.4 GB where the phone's tab was dropped at 2 GB, so a phone is not
// offered it. iOS ends a tab short of memory without the card saying so (D123 never hears of it): the device page's
// memory step lost the iPhone's tab between 1.5 and 2 GB of textures, where high's card may hold 1.9 GB with its
// overflow. High's card on a phone is a first guess, 1.25 GB with the overflow, for the phone to confirm. A phone is
// bound by triangles (D423), and downtown the far city is most of a frame and gives nothing: on a phone its levels are
// drawn PHONE_CITY as far, which takes 26 to 29% of its triangles on medium and 18 to 29% on high at the iPhone's view
// in the census's views of downtown Miami (tools/bench/census.ts).
const PHONE_HIGH_CARD = 1024 * MB;
const PHONE_CITY = 0.7;
// The view's end: 4 km as every tier saw before, and farther on high and ultra, where from the air the city then runs to
// the haze as blocks of its tops. A phone is bound by triangles and has not been shown to hold the blocks and the ground
// of a wider view, so on a phone high sees as far as medium.
const VIEW = 4000;
// Ultra draws the screen's own pixels: drawn twice a side, a light target of its size cost 10 ms more than ultra's whole
// frame on an M5 (planning/architecture/rendering.md), and its multisampling is the light target's.

export const TIERS: readonly Tier[] = [
  {
    name: "lowpoly", texture: 0, textureShare: 0, view: 256, bones: 8192, threshold: 0.44, finest: 1, instanced: 160, pixelRatio: 1, fewest: 0, canvas: 0, anisotropy: 1, gpuBytes: 96 * MB, uploadBytes: 0.5 * MB, diskBytes: 256 * MB,
    lit: false, split: 0, viewDistance: VIEW, reach: { bases: 1024, city: 2048, trees: 500, rocks: 0, bushes: 0, parts: 500 }, fade: 0.1, city: { levels: [boxes(340), lattice(600), mass(Infinity, 8)] }, nodes: { chunks: 3, band: [152, 184] }, shadows: { cascades: 0, size: 0, distance: 0, taps: 0, blend: 0, everyOther: false }, touch: null, finish: "full", finishes: 0, relief: false, clouds: 0, water: "flat",
    details: { pool: 384, share: 0.5, reach: 0.6, fill: 0.5 }, budget: { triangles: 2e6, draws: 2048 }, bodyError: 1,
    post: null,
    contact: false,
  },
  {
    name: "medium", texture: 1024, textureShare: 0.6, view: 512, bones: 16384, threshold: 0.22, finest: 0, instanced: 256, pixelRatio: 1.5, fewest: 0, canvas: 0, anisotropy: 1, gpuBytes: 512 * MB, uploadBytes: 1 * MB, diskBytes: 2048 * MB,
    lit: true, split: 384, viewDistance: VIEW, reach: { bases: 2048, city: 2500, trees: 1500, rocks: 700, bushes: 400, parts: 1500 }, fade: 0.25, city: { levels: MEDIUM_CITY }, nodes: { chunks: 3, band: [152, 184], levels: 400 }, shadows: { cascades: 2, size: 2048, distance: 64, taps: 4, blend: 0.8, everyOther: false }, touch: { shadows: { cascades: 2, size: 1024, distance: 64, taps: 1, blend: 0.8, everyOther: false }, finish: "light", city: { levels: nearer(MEDIUM_CITY, PHONE_CITY) }, budget: { triangles: 2e6, draws: 1024 }, nodes: { chunks: 3, band: [152, 184] } }, finish: "full", finishes: 512, relief: false, clouds: 2, water: "simple",
    details: { pool: 1536, share: 1, reach: 1, fill: 1 }, budget: { triangles: 4e6, draws: 1024, spend: 1, spendTo: 2.5e6 }, bodyError: 1,
    post: null,
    contact: false,
  },
  {
    name: "high", texture: 2048, textureShare: 0.6, view: 1024, bones: 32768, threshold: 0.14, finest: 0, instanced: 384, pixelRatio: 2, fewest: 0, canvas: 0, anisotropy: 16, gpuBytes: 1536 * MB, uploadBytes: 2 * MB, diskBytes: 8192 * MB,
    lit: true, split: 384, viewDistance: 6000, reach: { bases: 2048, city: 3000, trees: 1500, rocks: 900, bushes: 500, parts: 2000 }, fade: 0.25, city: { levels: HIGH_CITY }, nodes: { chunks: 4, band: [216, 248], levels: 400 }, shadows: { cascades: 3, size: 2048, distance: 128, taps: 9, blend: 0.85, everyOther: false }, touch: { shadows: { cascades: 3, size: 1024, distance: 128, taps: 1, blend: 0.85, everyOther: false }, gpuBytes: PHONE_HIGH_CARD, finish: "light", city: { levels: nearer(HIGH_CITY, PHONE_CITY) }, anisotropy: 1, viewDistance: VIEW, budget: { triangles: 4e6, draws: 2048 }, nodes: { chunks: 4, band: [216, 248] } }, finish: "full", finishes: 1024, relief: false, clouds: 2, water: "simple",
    details: { pool: 3072, share: 1, reach: 1, fill: 1.5 }, budget: { triangles: 6e6, draws: 2048, spend: 2, spendTo: 3.5e6 }, bodyError: 1,
    post: { bloom: 1 },
    contact: true,
  },
  {
    name: "ultra", texture: 4096, textureShare: 0.6, view: 2048, bones: 65536, threshold: 0.08, finest: 0, instanced: 512, pixelRatio: 0, fewest: 0, canvas: 0, anisotropy: 16, gpuBytes: 4096 * MB, uploadBytes: 4 * MB, diskBytes: 24576 * MB,
    lit: true, split: 384, viewDistance: 8000, reach: { bases: 2048, city: 3000, trees: 2000, rocks: 1200, bushes: 600, parts: 3000 }, fade: 0.25, city: { levels: [boxes(1100), lattice(1500), bare(2000), mass(2500, 4), mass(Infinity, 8)] }, nodes: { chunks: 5, band: [280, 312], levels: 400 }, shadows: { cascades: 4, size: 2048, distance: 192, taps: 9, blend: 0.9, everyOther: false }, touch: { offered: false, fewest: 0, anisotropy: 1 }, finish: "full", finishes: 2048, relief: false, clouds: 2, water: "simple",
    details: { pool: 6144, share: 1, reach: 1.25, fill: 2 }, budget: { triangles: 8e6, draws: 4096, spend: 2, spendTo: 5e6 }, bodyError: 1,
    post: { bloom: 1 },
    contact: true,
  },
];

/**
 * Canvas pixels a side for one CSS pixel on a screen of `dpr` device pixels to one, the canvas `width` by `height` CSS
 * pixels: the screen's own as far as the tier's `pixelRatio`, then the fewest whole number of those that reaches its
 * `fewest`, fewer where that passes its `canvas` pixels, and never under the screen's own.
 */
export function canvasRatio(tier: Tier, dpr: number, width: number, height: number): number {
  const own = ownRatio(tier, dpr);
  if (tier.fewest <= own) return own;
  return Math.max(own, Math.min(own * Math.ceil(tier.fewest / own), Math.sqrt(tier.canvas / Math.max(1, width * height))));
}

/** The screen's own canvas pixels a side for one CSS pixel, as far as the tier's `pixelRatio`: what a canvas drawn past them supersamples. */
export const ownRatio = (tier: Tier, dpr: number): number => (tier.pixelRatio > 0 ? Math.min(dpr, tier.pixelRatio) : dpr);

/** What a new player gets where nothing is known of the device, and on any device `startingTier` does not start on high. */
export const DEFAULT_TIER: Tier["name"] = "medium";

/**
 * What a device says of itself before its first frame: whether it is touch-first, its GPU's name as the browser gives
 * it, whether it can draw high's light target (render/post.ts), and its memory in GB where the browser says.
 */
export interface Start {
  readonly touchFirst: boolean;
  readonly renderer: string;
  readonly light: boolean;
  readonly memory?: number;
}

/** A GPU that is the CPU drawing, which holds a frame of high's at a few a second. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
/** The least memory, in GB, a device may say it has and start on high, whose card takes up to 1.5 GB. */
const HIGH_MEMORY = 4;

/**
 * The tier a player who has chosen none starts on: high on a device that is not touch-first, draws with a GPU and not
 * the CPU, can draw high's light target, and has HIGH_MEMORY or more where the browser says; DEFAULT_TIER on any other.
 * The governor still steps a device down that cannot hold the frame.
 */
export function startingTier(d: Start): Tier["name"] {
  return !d.touchFirst && d.light && !SOFTWARE.test(d.renderer) && (d.memory === undefined || d.memory >= HIGH_MEMORY) ? "high" : DEFAULT_TIER;
}

export function tierOf(name: string): Tier {
  for (const t of TIERS) if (t.name === name) return t;
  return tierOf(DEFAULT_TIER);
}

const touched = new Map<Tier, Tier>();

/**
 * The rule for touch-first devices: a tier as one draws it, the same copy each time, since the renderer keeps programs
 * by the tier. It draws no light target (render/post.ts): the finish is for a desktop's spare frame, not a phone's.
 */
export function forTouch(tier: Tier, touchFirst: boolean): Tier {
  if (!touchFirst || !tier.touch) return tier;
  const had = touched.get(tier);
  if (had) return had;
  const { offered: _, ...values } = tier.touch;
  return touched.set(tier, { ...tier, ...values, post: null, contact: false }).get(tier)!;
}

/** The tiers the settings offer: on a touch-first device, those whose touch rule does not leave them out. */
export const offeredTiers = (touchFirst: boolean): readonly Tier[] => TIERS.filter((t) => !touchFirst || t.touch?.offered !== false);
