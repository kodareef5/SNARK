// The programs a renderer draws with, by name: for a tier, a texture variant and whether the device's compared lookups
// come back hard, each one's texts, the defines put before them, and the texture unit each of its samplers reads. A
// WebGL2 shell compiles what is listed here, as given.

import type { TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { AIR, SKY_FRAGMENT, SKY_VERTEX } from "./atmosphere.ts";
import { FLAT_FAR_FRAGMENT, FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, FLAT_TERRAIN_VERTEX, LIT_FAR_FRAGMENT, LIT_FRAGMENT, LIT_SPLIT_FRAGMENT } from "./glsl.ts";
import { DEPTH_CUTOUT_FRAGMENT, DEPTH_FRAGMENT, DEPTH_VERTEX, clampDepth, shadowDefines } from "./shadowtext.ts";
import { SURFACE_VERTEX, surfaceFragment } from "./surface.ts";

/**
 * Texture units. 0 to 3 hold the palette, the whole map's heights and tints, and the bones. A material's five maps go
 * on 4 to 8, base colour first, and so do the sky's (the moon on 4, the cloud layers on 7 and 8) and the sea's, which
 * are materials. 9 holds the shadow maps, 10 the sky table, and 11 and 12 the terrain window's heights and tints. 13
 * to 15 are free.
 */
export const UNIT = { palette: 0, heights: 1, tint: 2, bones: 3, maps: 4, shadow: 9, sky: 10, windowHeights: 11, windowTint: 12 } as const;

export interface ProgramText {
  readonly vertex: string;
  readonly fragment: string;
  /** Lines put after the #version line of both texts. */
  readonly defines: string;
  /** The unit each sampler reads, by its name in the texts. */
  readonly samplers: Readonly<Record<string, number>>;
}

/** A text as a shell compiles it: with the defines after its first line, the #version line. */
export const withDefines = (source: string, defines: string): string => source.replace("\n", "\n" + defines);

const MESH = { uPalette: UNIT.palette, uBones: UNIT.bones };
const GROUND = { uPalette: UNIT.palette, uHeight: UNIT.heights, uTint: UNIT.tint };
const WINDOW = { uHeight: UNIT.windowHeights, uTint: UNIT.windowTint };

/**
 * A program of FLAT's vertex text: FLAT's fragment on low poly, and on a lit tier `lit`, which reads the sky table for
 * the haze and looks the sun's shadow up.
 */
function flatOr(tier: Tier, hard: boolean, vertex: string, flat: string, lit: string, samplers: Record<string, number>): ProgramText {
  if (!tier.lit) return { vertex, fragment: flat, defines: "", samplers };
  return { vertex, fragment: lit, defines: shadowDefines(tier.shadows, hard), samplers: { ...samplers, uSkyTable: UNIT.sky, uShadow: UNIT.shadow } };
}

/**
 * The programs by name. A lit tier draws flat with LIT where low poly has FLAT, and draws the dome, "sky", where low
 * poly clears to its sky colour. The surface program is made the first time a frame draws with materials, which low
 * poly never does, so it is lit alone, and the see-through one the first time a frame with a split draws something
 * see-through, which low poly does not either. The depth programs draw the sun's shadow maps.
 */
export const PROGRAMS: Readonly<Record<string, (tier: Tier, format: TextureFormat, hard?: boolean) => ProgramText>> = {
  flat: (tier, _, hard = false) => flatOr(tier, hard, FLAT_MESH_VERTEX, FLAT_FRAGMENT, LIT_FRAGMENT, MESH),
  terrain: (tier, _, hard = false) => flatOr(tier, hard, FLAT_TERRAIN_VERTEX, FLAT_FRAGMENT, LIT_FRAGMENT, GROUND),
  // The same, for the tiles that read the window round the camera (terrain.ts).
  terrainWindow: (tier, format, hard) => {
    const t = PROGRAMS.terrain!(tier, format, hard);
    return { ...t, samplers: { ...t.samplers, ...WINDOW } };
  },
  // See-through flat draws where the view is split in two depth ranges. A program of their own keeps the discard out of
  // the opaque draws, which some GPUs would then test for depth only after shading.
  seeThrough: (tier, _, hard = false) => flatOr(tier, hard, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, LIT_SPLIT_FRAGMENT, MESH),
  // Far blocks (far.ts), which fade out over the last of their reach. A program of their own keeps the discard out of the rest.
  far: (tier, _, hard = false) => flatOr(tier, hard, FLAT_MESH_VERTEX, FLAT_FAR_FRAGMENT, LIT_FAR_FRAGMENT, MESH),
  surface: (tier, format, hard = false) => ({
    vertex: SURFACE_VERTEX,
    fragment: surfaceFragment(format, AIR),
    defines: shadowDefines(tier.shadows, hard),
    samplers: { ...MESH, uBase: UNIT.maps, uNormal: UNIT.maps + 1, uMro: UNIT.maps + 2, uMask: UNIT.maps + 3, uMask2: UNIT.maps + 4, uSkyTable: UNIT.sky, uShadow: UNIT.shadow },
  }),
  // The dome, and over it the sky material's pictures on its units as a material's: the moon as its base colour and the cloud layers as its two masks.
  sky: () => ({ vertex: SKY_VERTEX, fragment: SKY_FRAGMENT, defines: "", samplers: { uSkyTable: UNIT.sky, uMoon: UNIT.maps, uLow: UNIT.maps + 3, uHigh: UNIT.maps + 4 } }),
  // A caster, a cut-out caster, and the ground, each drawn from the sun into a cascade's layer.
  depth: () => ({ vertex: DEPTH_VERTEX, fragment: DEPTH_FRAGMENT, defines: "", samplers: { uBones: UNIT.bones } }),
  depthCutout: () => ({ vertex: DEPTH_VERTEX, fragment: DEPTH_CUTOUT_FRAGMENT, defines: "", samplers: { uBones: UNIT.bones, uBase: UNIT.maps } }),
  depthTerrain: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: GROUND }),
  depthTerrainWindow: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: { ...GROUND, ...WINDOW } }),
};
