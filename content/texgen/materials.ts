/**
 * Materials the card makes from recipes (client/core/texgen/materials.ts) and a building's pieces wear by their `made`
 * (shared/content/kinds/structures.ts) in place of their colour's painted finish. A recipe is numbers alone: a square
 * tile, and on it up to four noises, grains scattered one to a cell, courses of laid units and ribs up the tile, each
 * with what it adds to the height and to the light. One program reads them all, so a new material is one entry here and
 * a finish that names it (content/ruins.ts); nothing else is written. Lengths are metres. A material's mean is its
 * piece's painted finish's, which it is far off, in the far city and on a phone; keep a tile's own light even, and
 * give what varies over metres to `mottle`, since what a tile holds comes round again every tile.
 */
export interface MaterialRecipe {
  /** The name a piece's `made` gives. */
  readonly name: string;
  /** A side of its tile. Every cell, grain, course and rib below fits it a whole number of times, so it meets itself. */
  readonly metres: number;
  readonly seed: number;
  /** Its height before anything is laid on it, 0 to 1, and the millimetres from its lowest to its highest. */
  readonly level: number;
  readonly relief: number;
  /** Roughness at its middle height, and how much rougher its hollows are than its heights (less than 0: smoother). */
  readonly rough: number;
  readonly hollow: number;
  /** How much its piece's colour dyes it, and how much lighter its heights are than its hollows. */
  readonly dye: number;
  readonly shade: number;
  /** How much the world's own noise, which no tile repeats, moves its light either way from place to place. */
  readonly mottle: number;
  /**
   * Noises, four at most: cells across and up, what each adds to the height and to the light either way, and how far
   * the one before it pushes it across (a float's sweep, a streak's wander).
   */
  readonly noise: readonly { readonly cell: readonly [number, number]; readonly height: number; readonly light: number; readonly warp?: number }[];
  /**
   * Grains, one to a cell `size` across: each full within `core` of its middle and gone by `radius` (shares of a cell),
   * `height` high, its light its own by `tone` and its hue by `warm`; between grains the light is `gap` and the dye `bare`.
   */
  readonly grain?: { readonly size: number; readonly core: number; readonly radius: number; readonly height: number; readonly tone: number; readonly gap: number; readonly bare: number; readonly warm: number };
  /**
   * Courses of units `size` across and up, each course moved `bond` of a unit from the one under it; joints `joint`
   * wide either side of a unit's edge, struck back by `depth` and darker by `dark`; each unit's light its own by `tone`.
   */
  readonly course?: { readonly size: readonly [number, number]; readonly bond: number; readonly joint: number; readonly depth: number; readonly tone: number; readonly dark: number };
  /** Ribs up the tile every `pitch`, `height` of the relief: a wave where `width` is 0, else a seam that wide either side. */
  readonly rib?: { readonly pitch: number; readonly width: number; readonly height: number };
  /** It lies on faces that look up alone, a roof's: its piece's other faces are their painted finish. */
  readonly lies?: true;
  /** It is a coat over its wall: where the weathering finds the plaster lost, its relief lies down with it. A block's joints stay. */
  readonly coat?: true;
  /** The means over a tile of its light, its dye and its roughness, pinned: the read draws them far off, and a test says when they are stale. */
  readonly means: readonly [number, number, number];
}

/** The most there may be: a face's key and a look's bits keep room for these (shared/world/city.ts, render/finish-near.ts). */
export const MOST_MATERIALS = 12;

export const MATERIAL_RECIPES: readonly MaterialRecipe[] = [
  // Knockdown stucco: the coat thrown on in lumps and trowelled flat, so flat islands a hand across stand over rough hollows.
  {
    name: "stucco", metres: 2, seed: 11, level: 1.05, relief: 7, rough: 0.92, hollow: 0.1, dye: 1, shade: 0.5, mottle: 0.05, coat: true, means: [1.16, 1, 0.89],
    // The lumps' noise is three times the relief, so the trowel's flat is where it passes the top; the grit shows in the hollows alone.
    noise: [{ cell: [0.25, 0.25], height: 0.25, light: 0.03 }, { cell: [0.05, 0.05], height: 3, light: 0.02, warp: 0.1 }, { cell: [0.02, 0.02], height: 0.5, light: 0.02 }, { cell: [0.008, 0.008], height: 0.25, light: 0.03 }],
  },
  // Sand-float render: flat and even, a sand's tooth on it and the wall's slow lie under it.
  {
    name: "render", metres: 2, seed: 23, level: 0.5, relief: 3, rough: 0.8, hollow: 0.08, dye: 1, shade: 0.3, mottle: 0.04, coat: true, means: [1, 1, 0.8],
    noise: [{ cell: [0.5, 0.5], height: 0.25, light: 0.03 }, { cell: [0.125, 0.125], height: 0.15, light: 0.05, warp: 0.2 }, { cell: [0.008, 0.008], height: 0.45, light: 0.1 }, { cell: [0.025, 0.025], height: 0.2, light: 0.04 }],
  },
  // Painted concrete block, 400 by 200 mm in running bond, its joints tooled back and its faces open-pored under the paint.
  {
    name: "block", metres: 1.6, seed: 37, level: 0.85, relief: 9, rough: 0.86, hollow: 0.1, dye: 1, shade: 0.3, mottle: 0.05, means: [1.09, 1, 0.83],
    noise: [{ cell: [0.008, 0.008], height: 0.2, light: 0.03 }, { cell: [0.2, 0.1], height: 0.15, light: 0.04 }, { cell: [0.02, 0.02], height: 0.3, light: 0.02 }],
    // The pores are grains let into the face.
    grain: { size: 0.016, core: 0.05, radius: 0.35, height: -0.5, tone: 0, gap: 1, bare: 1, warm: 0 },
    course: { size: [0.4, 0.2], bond: 0.5, joint: 0.007, depth: 0.9, tone: 0.14, dark: 0.35 },
  },
  // Corrugated sheet, its waves 76 mm apart, the paint streaked down them.
  {
    name: "corrugated", metres: 1.524, seed: 41, level: 0.5, relief: 18, rough: 0.5, hollow: 0.1, dye: 1, shade: 0.1, mottle: 0.05, means: [1, 1, 0.5],
    noise: [{ cell: [0.0381, 0.381], height: 0, light: 0.08 }, { cell: [0.1524, 0.1524], height: 0.06, light: 0.04 }],
    rib: { pitch: 0.0762, width: 0, height: 0.92 },
  },
  // Standing-seam sheet: seams 500 mm apart and 25 mm proud, the pans between them oil-canned a little.
  {
    name: "seam", metres: 2, seed: 53, level: 0.12, relief: 25, rough: 0.45, hollow: 0.05, dye: 1, shade: 0.06, mottle: 0.04, means: [0.97, 1, 0.47],
    noise: [{ cell: [0.25, 0.25], height: 0.06, light: 0.04 }, { cell: [0.05, 0.5], height: 0, light: 0.06 }],
    rib: { pitch: 0.5, width: 0.011, height: 0.88 },
  },
  // A flat roof's tar and gravel: stones about 16 mm, each its own grey, in black tar, about asphalt's mean, which its finish's colour is.
  {
    name: "gravel", metres: 2, seed: 67, level: 0.05, relief: 12, rough: 0.75, hollow: -0.4, dye: 0.25, shade: 0, mottle: 0.1, lies: true, means: [0.7, 0.16, 0.73],
    noise: [{ cell: [0.25, 0.25], height: 0.1, light: 0.04 }],
    grain: { size: 0.016, core: 0.42, radius: 0.6, height: 0.8, tone: 0.5, gap: 0.12, bare: 0, warm: 0.15 },
  },
];

/** A material's number in a face's key and on the card: its place in MATERIAL_RECIPES and one; 0 for none. */
export const materialIndex = (name: string | undefined): number => (name ? MATERIAL_RECIPES.findIndex((r) => r.name === name) + 1 : 0);
