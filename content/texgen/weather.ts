/**
 * The walls' weathering, as a recipe the page makes its masks from (client/core/texgen/weather.ts), in place of painted
 * pictures: a seed and the ranges each feature is drawn from, in metres. Its layers are square and as wide as the tier's
 * finishes allow. A bay's layer is one 8 m bay by two storeys, two bays' worth of variants, one above the other: below
 * each slab line the runoff of rain, narrow drips from sills, rust bled from fixings, and the dirt splashed up at a
 * wall's foot. A field's layer is 16 m by 16 m of what does not keep to a bay: rising damp, the plaster's hold on the
 * wall, a broad patina, and salt. Every range is [least, most]; counts are whole and both ends may be drawn.
 *
 * A new look is a new seed or a new range here: a few hundred bytes, made on the card as the page loads.
 */
export interface WeatherRecipe {
  version: number;
  seed: number;
  /** Layers of bays, each two variants, and of fields. */
  bays: number;
  fields: number;
  /** Runoff below a slab's edge: heads along the bay, each a main track and up to two more, then fine threads. */
  runs: {
    heads: readonly [number, number];
    /** No head starts nearer a bay's side than this. */
    margin: number;
    strength: readonly [number, number];
    /** Metres down over which a track's stain falls to a third. */
    length: readonly [number, number];
    width: readonly [number, number];
    trails: readonly [number, number];
    /** Metres a track wanders either way as it falls. */
    wander: number;
    threads: readonly [number, number];
    threadWidth: readonly [number, number];
    threadLength: readonly [number, number];
    threadStrength: readonly [number, number];
  };
  /** Drips from a sill or a fitting part way down the storey: a spot and a narrow streak under it. */
  drips: { count: readonly [number, number]; from: readonly [number, number]; width: readonly [number, number]; length: readonly [number, number]; strength: readonly [number, number] };
  /** Rust bled from a fixing: a spot and a short widening streak. */
  rust: { count: readonly [number, number]; from: readonly [number, number]; width: readonly [number, number]; length: readonly [number, number]; strength: readonly [number, number] };
  /** Dirt splashed up a wall's foot: a band this high, its edge ragged by this much either way. */
  splash: { height: readonly [number, number]; ragged: number };
}

export const WEATHER_RECIPE: WeatherRecipe = {
  version: 1,
  seed: 1729,
  bays: 6,
  fields: 2,
  runs: {
    heads: [2, 6],
    margin: 0.35,
    strength: [0.4, 1],
    length: [0.7, 3.2],
    width: [0.035, 0.11],
    trails: [1, 3],
    wander: 0.1,
    threads: [6, 20],
    threadWidth: [0.005, 0.014],
    threadLength: [0.25, 3.4],
    threadStrength: [0.06, 0.28],
  },
  drips: { count: [0, 3], from: [0.9, 2.7], width: [0.008, 0.022], length: [0.35, 1.5], strength: [0.45, 1] },
  rust: { count: [0, 2], from: [0.3, 3.3], width: [0.012, 0.035], length: [0.15, 0.9], strength: [0.55, 1] },
  splash: { height: [0.15, 0.5], ragged: 0.05 },
};
