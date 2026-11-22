/**
 * Materials the page makes from recipes (client/core/texgen/finishes.ts) and a building's pieces wear by their
 * `recipe` (shared/content/defs.ts StructureDef), in place of their colour's painted finish: each a tile of `metres`
 * a side, its relief, light, roughness and how much its colour dyes it. A piece keeps its colour, which dyes the
 * material, and its painted finish's weathering. Each is two layers of the card's made array, its base colour and its
 * relief; a new one is a few lines here and its look in the generator. At most MOST_RECIPES (the city's face key keeps
 * five bits for it, shared/world/city.ts).
 */
export interface FinishRecipe {
  /** The name a piece's `recipe` gives. */
  name: string;
  /** Metres a side of its tile. */
  metres: number;
  /**
   * The middle of its light, linear, from 0 to 1, about which it is drawn as light as the painted finish it stands for
   * (its piece's colour's), and how much its colour dyes it.
   */
  light: number;
  dye: number;
  /** Roughness, from 0 to 1, and how deep its relief is, in millimetres from lowest to highest. */
  rough: number;
  relief: number;
  /** A seed of its own grain. */
  seed: number;
  /** What its pieces' faces that look up wear, a flat roof: another recipe's name, or its own where none is given. */
  roof?: string;
}

export const MOST_RECIPES = 31;

export const FINISH_RECIPES: readonly FinishRecipe[] = [
  // A rough dash coat: grit thrown on, in small hard peaks, as Miami's low-rise walls are.
  { name: "stucco", metres: 2, light: 0.62, dye: 1, rough: 0.92, relief: 6, seed: 11, roof: "gravel" },
  // Sand-float render: fine and even, the float's sweeps in it.
  { name: "render", metres: 2.5, light: 0.66, dye: 1, rough: 0.82, relief: 2.5, seed: 23, roof: "gravel" },
  // Painted concrete block, 400 by 200 mm in running bond, its joints struck back.
  { name: "block", metres: 1.6, light: 0.64, dye: 1, rough: 0.86, relief: 9, seed: 37, roof: "gravel" },
  // Corrugated sheet, its waves 76 mm apart, painted.
  { name: "corrugated", metres: 0.762, light: 0.58, dye: 1, rough: 0.55, relief: 18, seed: 41 },
  // Standing-seam sheet, its seams 500 mm apart and 25 mm proud.
  { name: "seam", metres: 2, light: 0.6, dye: 1, rough: 0.5, relief: 25, seed: 53 },
  // A flat roof's tar and gravel: grey stones in black, which a colour dyes a little.
  { name: "gravel", metres: 2, light: 0.42, dye: 0.25, rough: 0.95, relief: 12, seed: 67 },
];

/** A recipe's number on the card and in a piece's face key: its place in FINISH_RECIPES and one; 0 for none. */
export const recipeIndex = (name: string | undefined): number => (name ? FINISH_RECIPES.findIndex((r) => r.name === name) + 1 : 0);
/** What recipe `k`'s faces that look up wear (FinishRecipe `roof`), by number. */
export const roofOf = (k: number): number => (k > 0 ? recipeIndex(FINISH_RECIPES[k - 1]!.roof) || k : 0);
