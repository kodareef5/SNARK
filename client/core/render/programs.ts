// The programs a renderer draws with, by name: for a tier and a texture variant, each one's texts, the defines put
// before them, and the texture unit each of its samplers reads. A WebGL2 shell compiles what is listed here, as given.

import type { TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, FLAT_TERRAIN_VERTEX } from "./glsl.ts";
import { SURFACE_VERTEX, surfaceFragment } from "./surface.ts";

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
 * The programs by name. The surface program is made the first time a frame draws with materials, and the see-through
 * one the first time a frame with a split draws something see-through. Low poly does neither.
 */
export const PROGRAMS: Readonly<Record<string, (tier: Tier, format: TextureFormat) => ProgramText>> = {
  flat: () => ({ vertex: FLAT_MESH_VERTEX, fragment: FLAT_FRAGMENT, defines: "", samplers: MESH }),
  terrain: () => ({ vertex: FLAT_TERRAIN_VERTEX, fragment: FLAT_FRAGMENT, defines: "", samplers: { uPalette: UNIT.palette, uHeight: UNIT.heights, uTint: UNIT.tint } }),
  // The same, for the tiles that read the window round the camera (terrain.ts).
  terrainWindow: (tier, format) => {
    const t = PROGRAMS.terrain!(tier, format);
    return { ...t, samplers: { ...t.samplers, uHeight: UNIT.windowHeights, uTint: UNIT.windowTint } };
  },
  // See-through flat draws where the view is split in two depth ranges. A program of their own keeps the discard out of
  // the opaque draws, which some GPUs would then test for depth only after shading.
  seeThrough: () => ({ vertex: FLAT_MESH_VERTEX, fragment: FLAT_SPLIT_FRAGMENT, defines: "", samplers: MESH }),
  surface: (_, format) => ({ vertex: SURFACE_VERTEX, fragment: surfaceFragment(format), defines: "", samplers: { ...MESH, uBase: UNIT.maps, uNormal: UNIT.maps + 1, uMro: UNIT.maps + 2, uMask: UNIT.maps + 3, uMask2: UNIT.maps + 4 } }),
};
