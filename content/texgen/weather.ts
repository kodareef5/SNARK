/**
 * The walls' weathering as a recipe the card makes its masks from (client/core/texgen/weather.ts): a seed and the ranges
 * each feature is drawn from, in metres. A bay's layer is one 8 m bay by two storeys, two stamps one above the other:
 * below each slab line the runoff of rain, narrow drips from sills, rust bled from fixings, and the dirt splashed up at a
 * wall's foot. A field's layer is 16 m by 16 m of what does not keep to a bay: rising damp, the plaster's hold on the
 * wall, a broad patina, and salt. Every range is [least, most]; counts are whole and both ends may be drawn.
 */
export interface WeatherRecipe {
  version: number;
  seed: number;
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
  version: 2,
  seed: 1729,
  runs: {
    heads: [3, 7],
    margin: 0.35,
    strength: [0.5, 1],
    length: [0.7, 3.2],
    width: [0.035, 0.11],
    trails: [1, 3],
    wander: 0.1,
    threads: [10, 26],
    threadWidth: [0.005, 0.014],
    threadLength: [0.25, 3.4],
    threadStrength: [0.06, 0.28],
  },
  drips: { count: [0, 3], from: [0.9, 2.7], width: [0.008, 0.022], length: [0.35, 1.5], strength: [0.45, 1] },
  rust: { count: [0, 2], from: [0.3, 3.3], width: [0.012, 0.035], length: [0.15, 0.9], strength: [0.55, 1] },
  splash: { height: [0.15, 0.5], ragged: 0.05 },
};

/**
 * Each field's equalizing table for WEATHER_RECIPE's seed (`fieldLut`): its channels' values at 33 even shares, four to
 * a step. Pinned here so that no page sorts 4,096 of a field's values to find them; a test says when they are stale.
 */
export const WEATHER_LUTS: readonly (readonly number[])[] = [
  [
    0.106814, 0.0584392, 0.149069, 0.096791, 0.264139, 0.272128, 0.258502, 0.178654, 0.300953, 0.306587, 0.288948, 0.20654, 0.325938, 0.328036, 0.313446, 0.228107,
    0.347246, 0.3489, 0.333259, 0.244455, 0.363427, 0.363669, 0.348316, 0.259644, 0.381216, 0.376839, 0.364029, 0.27327, 0.398021, 0.389745, 0.380305, 0.285948,
    0.413178, 0.401284, 0.396463, 0.298651, 0.424737, 0.411567, 0.407676, 0.308984, 0.438715, 0.423452, 0.417553, 0.319352, 0.450151, 0.435237, 0.428429, 0.329359,
    0.461504, 0.446022, 0.437802, 0.339299, 0.474495, 0.455472, 0.447954, 0.350397, 0.48701, 0.466224, 0.456213, 0.361255, 0.499265, 0.47687, 0.467791, 0.370157,
    0.511709, 0.487846, 0.478395, 0.381795, 0.5223, 0.496906, 0.488476, 0.390997, 0.533868, 0.504719, 0.497378, 0.399809, 0.54477, 0.513718, 0.507548, 0.408483,
    0.554943, 0.523193, 0.521238, 0.419387, 0.565865, 0.534969, 0.533108, 0.430124, 0.577387, 0.545165, 0.545013, 0.441761, 0.587581, 0.55577, 0.556618, 0.4531,
    0.599492, 0.569652, 0.571353, 0.462682, 0.611145, 0.58372, 0.586959, 0.475823, 0.62408, 0.596128, 0.604583, 0.489523, 0.639308, 0.609568, 0.620608, 0.504806,
    0.657212, 0.625882, 0.639577, 0.520071, 0.675406, 0.644007, 0.662207, 0.5407, 0.695646, 0.668894, 0.680341, 0.563991, 0.734121, 0.699736, 0.70064, 0.601346,
    0.893145, 0.815035, 0.770191, 0.754697,
  ],
  [
    0.141628, 0.182257, 0.186867, 0.0609111, 0.2599, 0.329556, 0.266204, 0.171956, 0.30107, 0.360946, 0.290049, 0.204983, 0.323032, 0.385057, 0.307174, 0.225944,
    0.345688, 0.401865, 0.321177, 0.243119, 0.364006, 0.419383, 0.334063, 0.257569, 0.377913, 0.434369, 0.34751, 0.269657, 0.392243, 0.444843, 0.361358, 0.284113,
    0.407497, 0.454848, 0.375278, 0.2969, 0.421047, 0.466475, 0.389364, 0.30803, 0.433866, 0.477336, 0.403457, 0.318855, 0.447011, 0.487974, 0.416555, 0.329803,
    0.460616, 0.49804, 0.427876, 0.341376, 0.471048, 0.505914, 0.439137, 0.35183, 0.482641, 0.514801, 0.451376, 0.361284, 0.495046, 0.524314, 0.462868, 0.372074,
    0.506521, 0.5326, 0.474884, 0.380606, 0.518532, 0.541755, 0.486528, 0.390852, 0.529691, 0.551452, 0.49882, 0.400926, 0.540309, 0.560564, 0.513989, 0.412512,
    0.550004, 0.569436, 0.527268, 0.423278, 0.563176, 0.579414, 0.541375, 0.433224, 0.574941, 0.590889, 0.556386, 0.444083, 0.587654, 0.602742, 0.57111, 0.455572,
    0.599971, 0.612871, 0.586297, 0.466292, 0.611738, 0.626459, 0.605665, 0.479709, 0.626167, 0.638887, 0.623664, 0.491269, 0.641331, 0.654344, 0.645044, 0.506241,
    0.657658, 0.668887, 0.669303, 0.524582, 0.676005, 0.684995, 0.693499, 0.545578, 0.697355, 0.707206, 0.717458, 0.568902, 0.729826, 0.740026, 0.745133, 0.603002,
    0.869274, 0.904755, 0.874213, 0.735857,
  ],
];
