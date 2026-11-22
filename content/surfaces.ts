// World surfaces, in the order of their layers. This is the owner's tuning desk. No map or texture rebuild is needed to
// change these numbers: rebuild the client, or run tools/surfaces/views.ts again. Values are shared by both renderers.
export const SURFACE_NAMES = ["grass", "sand", "dirt", "mud", "rock", "gravel", "asphalt", "paving", "concrete", "brick", "clay", "rust", "steel", "plaster", "wood", "glass", "sidewalk"] as const;
export type SurfaceName = typeof SURFACE_NAMES[number];
/** The material of a finish in the pack, whose textures are "<material>/<role>". */
export const SURFACE_PREFIX = "core:zz_world/";
export const surfaceMaterial = (name: SurfaceName): string => SURFACE_PREFIX + name;
/**
 * The packed array's layers after the finishes', for masks the ground reads. The walls' weathering is not among them:
 * the page makes its masks from a recipe (content/texgen/weather.ts) on an array of its own.
 */
export const MASK_LAYER = SURFACE_NAMES.length;
/**
 * The ground's macros (assets/source/core/world/road/): a used carriageway's light and roughness from above over 32 m,
 * and a beach's; and a road's repairs over 8 m: saw-cut patches, the sealant over their seams, sealed cracks and open
 * ones. The packed array's first mask layers.
 */
export const ROAD_MATERIAL = SURFACE_PREFIX + "road";
export const ROAD_LAYER = MASK_LAYER;
export const REPAIRS_MATERIAL = SURFACE_PREFIX + "repairs";
export const REPAIRS_LAYER = MASK_LAYER + 1;
/** The masks' materials in the order of their layers after the finishes'. */
export const MASK_MATERIALS = [ROAD_MATERIAL, REPAIRS_MATERIAL] as const;
export type SurfaceGroup = "living" | "dry" | "wet" | "mineral" | "masonry" | "metal" | "paint" | "timber" | "glass";

/** Multipliers except wetness and growth, which are added. Tint multiplies linear reflectance. */
export interface SurfaceDials { tint: readonly [number, number, number]; scale: number; bump: number; weather: number; wetness: number; growth: number }
const dials = (values: Partial<SurfaceDials> = {}): SurfaceDials => ({ tint: [1, 1, 1], scale: 1, bump: 1, weather: 1, wetness: 0, growth: 0, ...values });
export const SURFACE_GROUPS: Record<SurfaceGroup, SurfaceDials> = {
  living: dials({ tint: [0.86, 1.04, 0.78] }), dry: dials(), wet: dials(),
  mineral: dials(), masonry: dials(), metal: dials(), paint: dials(), timber: dials(), glass: dials(),
};

export interface SurfaceFinish {
  group: SurfaceGroup;
  /** Metres across the painted tile, as its material.json says. */
  metres: number;
  /** Multipliers of the painted relief, roughness and metal. */
  bump: number;
  rough: number;
  metal: number;
  /** How much of the palette colour dyes the painted tint mask. 0 keeps the painted colour everywhere. */
  palette: number;
  weather: number;
  /**
   * A laid pattern's module, as its material.json says: the shift in tiles across and down that maps its joints onto
   * themselves. A second copy that hides the repeat is shifted by it and keeps its direction; without one, it is turned.
   */
  module?: readonly [number, number];
  /**
   * How much lighter the patches where a finish's second copy shows are than those of its first, as a share: a
   * resurfaced stretch, a repainted bay, a lusher or drier patch, every few metres. Half of it darkens the first.
   */
  patch: number;
  /** Millimetres from the lowest to the highest of the painted height, and where the lowest sits where two finishes of the ground meet: the higher shows. */
  height: number;
  lift: number;
}
const finish = (group: SurfaceGroup, metres: number, palette: number, weather: number, patch: number, height: number, lift: number, module?: readonly [number, number]): SurfaceFinish =>
  ({ group, metres, bump: 1, rough: 1, metal: 1, palette, weather, patch, height, lift, ...(module ? { module } : {}) });
export const SURFACE_FINISHES: Record<SurfaceName, SurfaceFinish> = {
  grass: finish("living", 2, 0.18, 0.2, 0.12, 40, 6),
  sand: finish("dry", 2.5, 0.12, 0.12, 0.05, 6, 6),
  dirt: finish("dry", 2, 0.2, 0.24, 0.1, 12, 0),
  mud: { ...finish("wet", 2, 0.14, 0.3, 0.08, 15, -6), rough: 1.15 },
  rock: finish("mineral", 3, 0.3, 0.23, 0.08, 30, 0),
  gravel: finish("dry", 1.5, 0.2, 0.2, 0.08, 30, 0),
  asphalt: finish("mineral", 2.5, 0.1, 0.4, 0.1, 8, 0),
  paving: finish("masonry", 3, 0.25, 0.32, 0.06, 25, 0, [1 / 3, 1 / 3]),
  concrete: finish("masonry", 2.5, 0.46, 0.45, 0.06, 5, 2),
  brick: finish("masonry", 1.92, 0.14, 0.4, 0.06, 12, 0, [0.125, 1 / 12]),
  clay: finish("masonry", 2.9, 0.2, 0.28, 0.08, 60, 0, [1 / 19, 1 / 11]),
  rust: finish("metal", 2, 0.18, 0.4, 0.08, 5, 0),
  steel: finish("metal", 2, 0.4, 0.28, 0.04, 2, 0),
  plaster: finish("paint", 2.5, 0.7, 0.35, 0.05, 3, 0),
  wood: finish("timber", 2, 0.25, 0.26, 0.08, 10, 0, [0.5, 1 / 13]),
  glass: finish("glass", 2, 0.35, 0.2, 0.02, 1, 0),
  // Poured concrete broomed across x, in 1.5 m panels whose tooled joints run both ways: a walk's, raised or on the ground.
  sidewalk: finish("masonry", 3, 0.1, 0.35, 0.05, 8, 3, [0.5, 0.5]),
};

/**
 * How each finish weathers on a wall (world-surfaces.ts `weathered`), each a share of the most: runoff below each slab
 * edge, a damp foot, paint letting go to the concrete under it, the formwork's joints, and its value from bay to bay
 * and across 5 to 30 m, which roofs keep too; and what its runoff leaves, and a leaky bay's grime. Then drips from sills
 * and rust bled from fixings, the dirt splashed up its foot, sun bleaching where it faces the afternoon sun under an
 * open sky, a green film where it faces away in the shade, and salt blooming out of it where it is wet.
 */
export interface SurfaceWeathering { runs: number; damp: number; peel: number; joints: number; value: number; left: "grime" | "rust" | "salt"; drips: number; splash: number; bleach: number; algae: number; salt: number }
type More = readonly [drips: number, splash: number, bleach: number, algae: number, salt: number];
const weathers = (runs: number, damp: number, peel: number, joints: number, value: number, more: More, left: SurfaceWeathering["left"] = "grime"): SurfaceWeathering =>
  ({ runs, damp, peel, joints, value, left, drips: more[0], splash: more[1], bleach: more[2], algae: more[3], salt: more[4] });
export const SURFACE_WEATHERING: Record<SurfaceName, SurfaceWeathering> = {
  grass: weathers(0, 0, 0, 0, 0.3, [0, 0, 0, 0, 0]), sand: weathers(0.3, 0.4, 0, 0, 0.4, [0.2, 0.3, 0.2, 0, 0]), dirt: weathers(0.4, 0.5, 0, 0, 0.5, [0.3, 0.5, 0.1, 0.2, 0]),
  mud: weathers(0.3, 0.3, 0, 0, 0.4, [0.2, 0.3, 0, 0.3, 0]), rock: weathers(0.8, 0.8, 0, 0, 0.8, [0.5, 0.6, 0.4, 0.8, 0.3]), gravel: weathers(0.4, 0.5, 0, 0, 0.5, [0.3, 0.5, 0.2, 0.4, 0]),
  asphalt: weathers(0.5, 0.5, 0, 0, 0.6, [0.3, 0.5, 0.3, 0.3, 0]), paving: weathers(0.6, 0.7, 0, 0, 0.7, [0.5, 0.8, 0.4, 0.7, 0.5]), concrete: weathers(1, 1, 0, 1, 1, [1, 1, 0.5, 1, 0.6]),
  brick: weathers(0.8, 1, 0, 0, 0.8, [0.7, 1, 0.4, 0.8, 1], "salt"), clay: weathers(0.6, 0.6, 0, 0, 0.7, [0.6, 0.9, 0.5, 0.7, 0.5]), rust: weathers(0.8, 0.3, 0, 0, 0.7, [0.8, 0.5, 0.3, 0, 0], "rust"),
  steel: weathers(0.8, 0.3, 0, 0, 0.6, [0.8, 0.5, 0.5, 0, 0], "rust"), plaster: weathers(1, 1, 1, 0, 0.9, [1, 1, 1, 0.8, 0.3]), wood: weathers(0.7, 0.8, 0, 0, 0.8, [0.6, 0.9, 1, 0.9, 0]),
  glass: weathers(0.4, 0, 0, 0, 0.2, [0.3, 0.4, 0, 0.2, 0]), sidewalk: weathers(0.6, 0.7, 0, 0, 0.7, [0.5, 0.8, 0.4, 0.6, 0.4]),
};

/**
 * How asphalt wears (world-surfaces.ts `roadWorn`), each a share of the most: its macro's light and roughness; along a
 * carriageway's frame, a darker, smoother wheel path under each pair of wheels of a lane and a stripe of oil between
 * them, the more the more worn its class, the share of the joints between its lanes sealed and the dirt of its gutters;
 * and of each repair's cell, a lane by 8 m along a road and an 8 m square elsewhere, the share patched and the share
 * whose cracks are sealed. The beach's macro is its light alone.
 */
export const ROAD_LOOK = { macro: 0.7, macroRough: 0.6, wheels: 0.07, oil: 0.22, joint: 0.75, gutter: 0.2, patched: 0.18, sealed: 0.3, beach: 0.8 };
/** The optional dry road look. Albedo is in linear light. Shade is a reduction of daylight fill on shaded asphalt. */
export const DRY_ASPHALT = { surface: SURFACE_NAMES.indexOf("asphalt"), albedo: 0.36, roughnessFloor: 0.87, roughnessShare: 0.75, shade: 0.28 };
/**
 * How a poured walk wears (world-surfaces.ts `walkWorn`) by its 1.5 m panels and the joints between them, each panel
 * and each joint's piece by a hash of where it is: a panel's tone either way, the shares of panels stained, cracked and
 * sunk and how far a sunk one leans; and of the joints' pieces, the shares holding grass and, of the rest, dirt.
 */
export const WALK_LOOK = { tone: 0.09, stained: 0.3, cracked: 0.2, sunk: 0.15, lean: 0.035, grass: 0.22, dirt: 0.55 };

/** City-wide art direction. The key is the map id's last component; unknown maps use default. */
export const SURFACE_CITIES: Record<string, SurfaceDials> = {
  default: dials({ growth: 0.08 }),
  miami: dials({ tint: [1.04, 1.02, 0.96], weather: 1.2, wetness: 0.12, growth: 0.28 }),
  tampa: dials({ tint: [1.01, 1.03, 0.95], weather: 1.15, wetness: 0.15, growth: 0.3 }),
  "san-francisco": dials({ tint: [0.96, 1, 1.04], weather: 1.12, wetness: 0.06, growth: 0.14 }),
  "los-angeles": dials({ tint: [1.05, 1.01, 0.94], weather: 1.1, growth: 0.08 }),
  "las-vegas": dials({ tint: [1.08, 1.02, 0.9], weather: 0.8, growth: 0.01 }),
};

// Ground and solids deliberately have separate tables: e.g. 89 is a bridge deck on the ground, steel on a static.
// The terrain's D253 byte carries colour, not an unambiguous land-cover enum. Keep these aliases together with the
// land-cover palette in tools/mapworld/tint.ts. Unknown colours get dirt on the ground and concrete on solids.
export const GROUND_SURFACES: Partial<Record<SurfaceName, readonly number[]>> = {
  grass: [7, 12, 16, 17, 18, 19, 20, 21, 130, 131, 137, 138, 139, 147, 148, 150, 151, 195, 196, 197],
  sand: [121, 122, 123, 124, 125, 133, 160, 168, 169],
  // 96 was a highway's third colour and is otherwise a channel's bed, under the water.
  dirt: [102, 103, 114, 158, 159], mud: [95, 97, 117, 118, 127, 128, 129],
  rock: [10, 15], gravel: [100, 101, 167], asphalt: [4, 84, 85, 86, 96], paving: [2, 88, 89, 98, 99],
  concrete: [104, 112, 113], brick: [172, 180, 181], clay: [183, 205, 206], rust: [179], sidewalk: [1, 231],
};
export const FALLBACK_SURFACES: Partial<Record<SurfaceName, readonly number[]>> = {
  // Architectural limestone uses fine mineral grain, not the ground's fractured bedrock.
  rock: [15], asphalt: [4, 84, 85, 86], paving: [98], sidewalk: [1], concrete: [2, 10, 88, 99, 100, 101, 102],
  brick: [172, 180, 181, 183], clay: [205, 206], rust: [96, 179], steel: [5, 6, 89, 90, 91],
  plaster: [75, 81, 103, 104, 112, 113, 114, 135], wood: [115, 116, 120], glass: [9, 92],
  grass: [137, 138, 139, 150, 151, 195, 196, 197],
};

export function surfaceIndex(palette: number, ground: boolean, city = "default"): number {
  const names = ground ? GROUND_SURFACES : FALLBACK_SURFACES;
  // The desert's sand-coloured open land is gravel; beaches on the coastal maps remain sand.
  if (ground && city === "las-vegas" && [100, 101, 122, 123, 124, 158, 167].includes(palette)) return 5;
  for (let i = 0; i < SURFACE_NAMES.length; i++) if (names[SURFACE_NAMES[i]!] ?.includes(palette)) return i;
  return ground ? 2 : 8;
}
