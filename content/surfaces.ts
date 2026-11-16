// World surfaces, in atlas order. This is the owner's tuning desk. No map or texture rebuild is needed to change
// these numbers: rebuild the client, or run tools/surfaces/views.ts again. Values are shared by both renderers.
export const SURFACE_MATERIAL = "core:zz_world_surfaces/atlas";
export const SURFACE_NAMES = ["grass", "sand", "dirt", "mud", "rock", "gravel", "asphalt", "paving", "concrete", "brick", "clay", "rust", "steel", "plaster", "wood", "glass"] as const;
export type SurfaceName = typeof SURFACE_NAMES[number];
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
  /** Metres across the source tile. Brick and timber retain their direction. */
  metres: number;
  bump: number;
  rough: number;
  metal: number;
  /** How much of the palette colour is retained. 0 uses the source's colour. */
  palette: number;
  weather: number;
  directional?: boolean;
}
export const SURFACE_FINISHES: Record<SurfaceName, SurfaceFinish> = {
  grass: { group: "living", metres: 1.4, bump: 0.55, rough: 0.94, metal: 0, palette: 0.18, weather: 0.2 },
  sand: { group: "dry", metres: 2.4, bump: 0.28, rough: 0.92, metal: 0, palette: 0.12, weather: 0.12 },
  dirt: { group: "dry", metres: 2, bump: 0.48, rough: 0.96, metal: 0, palette: 0.2, weather: 0.24 },
  mud: { group: "wet", metres: 2, bump: 0.5, rough: 0.66, metal: 0, palette: 0.14, weather: 0.3 },
  rock: { group: "mineral", metres: 3, bump: 0.62, rough: 0.9, metal: 0, palette: 0.3, weather: 0.23 },
  gravel: { group: "dry", metres: 0.85, bump: 0.55, rough: 0.93, metal: 0, palette: 0.2, weather: 0.2 },
  asphalt: { group: "mineral", metres: 1.6, bump: 0.38, rough: 0.94, metal: 0, palette: 0.1, weather: 0.4 },
  paving: { group: "masonry", metres: 3, bump: 0.45, rough: 0.88, metal: 0, palette: 0.25, weather: 0.32, directional: true },
  concrete: { group: "masonry", metres: 1.8, bump: 0.18, rough: 0.9, metal: 0, palette: 0.46, weather: 0.45 },
  brick: { group: "masonry", metres: 0.8, bump: 0.6, rough: 0.93, metal: 0, palette: 0.14, weather: 0.4, directional: true },
  clay: { group: "masonry", metres: 1.2, bump: 0.5, rough: 0.84, metal: 0, palette: 0.2, weather: 0.28, directional: true },
  rust: { group: "metal", metres: 2.5, bump: 0.52, rough: 0.9, metal: 0.08, palette: 0.18, weather: 0.4 },
  steel: { group: "metal", metres: 3, bump: 0.18, rough: 0.5, metal: 0.7, palette: 0.4, weather: 0.28 },
  plaster: { group: "paint", metres: 3, bump: 0.28, rough: 0.9, metal: 0, palette: 0.7, weather: 0.35 },
  wood: { group: "timber", metres: 1.4, bump: 0.4, rough: 0.86, metal: 0, palette: 0.25, weather: 0.26, directional: true },
  glass: { group: "glass", metres: 4, bump: 0.06, rough: 0.28, metal: 0, palette: 0.35, weather: 0.2 },
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
