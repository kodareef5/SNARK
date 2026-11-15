// The programs a renderer draws with, by name: for a tier and a texture variant, each one's texts, the defines put
// before them, and the texture unit each of its samplers reads. A WebGL2 shell compiles what is listed here, as given.

import type { TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { FLAT_FAR_FRAGMENT, FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, FLAT_TERRAIN_VERTEX, LIT_FAR_FRAGMENT, LIT_FRAGMENT, LIT_SPLIT_FRAGMENT } from "./glsl.ts";
import { SKY_GLSL } from "./sky.ts";
import { DOME_VERTEX, SURFACE_VERTEX, domeFragment, surfaceFragment } from "./surface.ts";

/**
 * Texture units. 0 to 3 hold the palette, the whole map's heights and tints, and the bones. A material's five maps go
 * on 4 to 8, base colour first, and so do the clouds' and the sea's, which are materials. 9 holds the shadow maps, 10
 * the sky table, and 11 and 12 the terrain window's heights and tints. 13 to 15 are free.
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

const MESH = { uPalette: UNIT.palette, uBones: UNIT.bones };

/**
 * The programs by name. A lit tier draws flat with LIT where low poly has FLAT, and draws the dome, "sky", where low
 * poly clears to its sky colour. The surface program is made the first time a frame draws with materials, which low
 * poly never does, so it is lit alone, and the see-through one the first time a frame with a split draws something
 * see-through, which low poly does not either.
 */
export const PROGRAMS: Readonly<Record<string, (tier: Tier, format: TextureFormat) => ProgramText>> = {
  flat: (tier) => ({ vertex: FLAT_MESH_VERTEX, fragment: tier.lit ? LIT_FRAGMENT : FLAT_FRAGMENT, defines: "", samplers: MESH }),
  terrain: (tier) => ({ vertex: FLAT_TERRAIN_VERTEX, fragment: tier.lit ? LIT_FRAGMENT : FLAT_FRAGMENT, defines: "", samplers: { uPalette: UNIT.palette, uHeight: UNIT.heights, uTint: UNIT.tint } }),
  // The same, for the tiles that read the window round the camera (terrain.ts).
  terrainWindow: (tier, format) => {
    const t = PROGRAMS.terrain!(tier, format);
    return { ...t, samplers: { ...t.samplers, uHeight: UNIT.windowHeights, uTint: UNIT.windowTint } };
  },
  // See-through flat draws where the view is split in two depth ranges. A program of their own keeps the discard out of
  // the opaque draws, which some GPUs would then test for depth only after shading.
  seeThrough: (tier) => ({ vertex: FLAT_MESH_VERTEX, fragment: tier.lit ? LIT_SPLIT_FRAGMENT : FLAT_SPLIT_FRAGMENT, defines: "", samplers: MESH }),
  // Far blocks (far.ts), which fade out over the last of their reach. A program of their own keeps the discard out of the rest.
  far: (tier) => ({ vertex: FLAT_MESH_VERTEX, fragment: tier.lit ? LIT_FAR_FRAGMENT : FLAT_FAR_FRAGMENT, defines: "", samplers: MESH }),
  surface: (_, format) => ({ vertex: SURFACE_VERTEX, fragment: surfaceFragment(format, SKY_GLSL), defines: "", samplers: { ...MESH, uBase: UNIT.maps, uNormal: UNIT.maps + 1, uMro: UNIT.maps + 2, uMask: UNIT.maps + 3, uMask2: UNIT.maps + 4, uSkyTable: UNIT.sky } }),
  sky: () => ({ vertex: DOME_VERTEX, fragment: domeFragment(SKY_GLSL), defines: "", samplers: { uSkyTable: UNIT.sky } }),
};
