// World surfaces, in the order of their layers. This is the owner's tuning desk. No map or texture rebuild is needed to
// change these numbers: rebuild the client, or run tools/surfaces/views.ts again. Values are shared by both renderers.
export const SURFACE_NAMES = ["grass", "sand", "dirt", "mud", "rock", "gravel", "asphalt", "paving", "concrete", "brick", "clay", "rust", "steel", "plaster", "wood", "glass"] as const;
export type SurfaceName = typeof SURFACE_NAMES[number];
/** The material of a finish in the pack, whose textures are "<material>/<role>". */
export const SURFACE_PREFIX = "core:zz_world/";
export const surfaceMaterial = (name: SurfaceName): string => SURFACE_PREFIX + name;
export type SurfaceGroup = "living" | "dry" | "wet" | "mineral" | "masonry" | "metal" | "paint" | "timber" | "glass";

/** Multipliers except wetness and growth, which are added. Tint multiplies linear reflectance. */
export interface SurfaceDials { tint: readonly [number, number, number]; scale: number; bump: number; weather: number; wetness: number; growth: number }
const dials = (values: Partial<SurfaceDials> = {}): SurfaceDials => ({ tint: [1, 1, 1], scale: 1, bump: 1, weather: 1, wetness: 0, growth: 0, ...values });
export const SURFACE_GROUPS: Record<SurfaceGroup, SurfaceDials> = {
  living: dials({ tint: [0.86, 1.04, 0.78] }), dry: dials(), wet: dials({ wetness: 0.35 }),
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
  /** Millimetres from the lowest to the highest of the painted height, and where the lowest sits where two finishes of the ground meet: the higher shows. */
  height: number;
  lift: number;
}
const finish = (group: SurfaceGroup, metres: number, palette: number, weather: number, height: number, lift: number, module?: readonly [number, number]): SurfaceFinish =>
  ({ group, metres, bump: 1, rough: 1, metal: 1, palette, weather, height, lift, ...(module ? { module } : {}) });
export const SURFACE_FINISHES: Record<SurfaceName, SurfaceFinish> = {
  grass: finish("living", 2, 0.18, 0.2, 40, 6),
  sand: finish("dry", 2.5, 0.12, 0.12, 6, 6),
  dirt: finish("dry", 2, 0.2, 0.24, 12, 0),
  mud: finish("wet", 2, 0.14, 0.3, 15, -6),
  rock: finish("mineral", 3, 0.3, 0.23, 30, 0),
  gravel: finish("dry", 1.5, 0.2, 0.2, 30, 0),
  asphalt: finish("mineral", 2.5, 0.1, 0.4, 8, 0),
  paving: finish("masonry", 2, 0.25, 0.32, 20, 0, [0.25, 0.25]),
  concrete: finish("masonry", 2.5, 0.46, 0.45, 5, 2),
  brick: finish("masonry", 1.92, 0.14, 0.4, 12, 0, [0.125, 1 / 12]),
  clay: finish("masonry", 2, 0.2, 0.28, 60, 0, [0.25, 1 / 6]),
  rust: finish("metal", 2, 0.18, 0.4, 5, 0),
  steel: finish("metal", 2, 0.4, 0.28, 2, 0),
  plaster: finish("paint", 2.5, 0.7, 0.35, 3, 0),
  wood: finish("timber", 2, 0.25, 0.26, 10, 0, [0.5, 1 / 13]),
  glass: finish("glass", 2, 0.35, 0.2, 1, 0),
};

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
  dirt: [102, 103, 114, 158, 159], mud: [95, 96, 97, 117, 118, 127, 128, 129],
  rock: [10, 15], gravel: [100, 101, 167], asphalt: [4, 84, 85, 86], paving: [1, 2, 88, 89, 98, 99],
  concrete: [104, 112, 113], brick: [172, 180, 181], clay: [183, 205, 206], rust: [179],
};
export const FALLBACK_SURFACES: Partial<Record<SurfaceName, readonly number[]>> = {
  // Architectural limestone uses fine mineral grain, not the ground's fractured bedrock.
  rock: [15], asphalt: [4, 84, 85, 86], paving: [1, 98], concrete: [2, 10, 88, 99, 100, 101, 102],
  brick: [172, 180, 181], clay: [183, 205, 206], rust: [179], steel: [5, 89, 90, 91],
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
