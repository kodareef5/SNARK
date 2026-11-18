// The programs a renderer draws with, by name: for a tier, a texture variant and whether the device's compared lookups
// come back hard, each one's texts, the defines put before them, and the texture unit each of its samplers reads. A
// WebGL2 shell compiles what is listed here, as given.

import type { PackMaterial } from "../../../shared/pack/pack.ts";
import type { TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { AIR, SKY_FRAGMENT, SKY_VERTEX } from "./atmosphere.ts";
import { DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT, DETAIL_VERTEX } from "./detailtext.ts";
import { FAR_MESH_VERTEX, FLAT_FAR_FRAGMENT, FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, FLAT_TERRAIN_VERTEX, LIT_FAR_FRAGMENT, LIT_MESH_FRAGMENT, LIT_SPLIT_FRAGMENT, LIT_TERRAIN_FRAGMENT, LIT_TERRAIN_VERTEX, PULLED_VERTEX, finishVertex } from "./glsl.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_PULLED, DRAW_TEXTURED, DRAW_WATER, type FramePacket } from "./packet.ts";
import { DEPTH_CUTOUT_FRAGMENT, DEPTH_FRAGMENT, DEPTH_VERTEX, clampDepth, shadowDefines } from "./shadowtext.ts";
import { SURFACE_ANY, surfaceFragment, surfaceVertex, type SurfaceVariant } from "./surface.ts";
import { ownVertex, worldVertex } from "./world-surfaces.ts";
import { WATER_FRAGMENT } from "./water.ts";

/**
 * Texture units. 0 to 3 hold the palette, the whole map's heights and tints, and the bones. A material's five maps go
 * on 4 to 8, base colour first, and so do the sky's (the moon on 4, the cloud layers on 7 and 8) and the sea's (its long
 * and short waves on 7 and 8), which are materials. 9 holds the shadow maps, 10 the sky table, and 11 and 12 the
 * terrain window's heights and tints, 13 the far nodes' meshes (packet.ts `atlas`), 14 a body's hurt and decay layer.
 * 15 holds the details atlas for the details draws alone, and is free outside them: a program that does not read it may
 * bind something else there. 16, the first past the sixteen a program may read at most, holds the sky's openness
 * (skyopen.ts); WebGL2 has 32 units at the least, and no program reads more than twelve.
 */
export const UNIT = { palette: 0, heights: 1, tint: 2, bones: 3, maps: 4, shadow: 9, sky: 10, windowHeights: 11, windowTint: 12, atlas: 13, layer: 14, details: 15, open: 16 } as const;

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
 * the haze and looks the sun's shadow up. The ground has a vertex text of its own on a lit tier, `litVertex`. A near
 * static's program (`weather`) weathers its walls where the tier reads the finishes in full (world-surfaces.ts
 * `ownVertex`, `weathered`), and rounds its edges on high and draws their wear alone on medium (`edged`); ultra's
 * street does not yet afford them beside its wider finishes.
 */
function flatOr(tier: Tier, format: TextureFormat, hard: boolean, vertex: string, flat: string, lit: string, samplers: Record<string, number>, litVertex?: string, weather = false): ProgramText {
  if (!tier.lit) return { vertex, fragment: flat, defines: "", samplers };
  const weathers = weather && tier.finish === "full";
  return { vertex: litVertex ?? (weathers ? ownVertex(worldVertex(vertex)) : worldVertex(vertex)), fragment: lit.replace("nn.rg", format === "astc" ? "nn.ra" : "nn.rg"), defines: (tier.finish === "light" ? "#define WORLD_LIGHT\n" : tier.relief ? "#define WORLD_RELIEF\n" : "") + (weathers ? `#define WORLD_WEATHER\n${tier.finishes > 1024 ? "" : tier.finishes === 1024 ? "#define WORLD_EDGES\n" : "#define WORLD_EDGE_LINE\n"}` : "") + shadowDefines(tier.shadows, hard), samplers: { ...samplers, uWorldBase: UNIT.maps, uWorldNormal: UNIT.maps + 1, uWorldOrm: UNIT.maps + 2, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uSkyOpen: UNIT.open, ...(litVertex ? {} : { uGroundHeight: UNIT.heights }) } };
}

/** A SURFACE program of a variant: a material's maps on their units, and the masks and palette only where it is dyed. */
function surface(tier: Tier, format: TextureFormat, hard: boolean, variant: SurfaceVariant): ProgramText {
  const samplers: Record<string, number> = { uBones: UNIT.bones, uBase: UNIT.maps, uNormal: UNIT.maps + 1, uMro: UNIT.maps + 2, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uSkyOpen: UNIT.open, uGroundHeight: UNIT.heights };
  if (variant.dyed) Object.assign(samplers, { uPalette: UNIT.palette, uMask: UNIT.maps + 3, uMask2: UNIT.maps + 4 });
  if (variant.layered) samplers.uLayer = UNIT.layer;
  return { vertex: surfaceVertex(variant), fragment: surfaceFragment(format, AIR, variant), defines: shadowDefines(tier.shadows, hard), samplers };
}

type Make = (tier: Tier, format: TextureFormat, hard?: boolean) => ProgramText;

/** A flat mesh program, whose vertices on a lit tier take their landmark's finishes (glsl.ts `finishVertex`). */
const mesh = (tier: Tier, made: ProgramText): ProgramText => (tier.lit ? { ...made, vertex: finishVertex(made.vertex) } : made);

const MAKE = {
  flat: (tier, format, hard = false) => mesh(tier, flatOr(tier, format, hard, FLAT_MESH_VERTEX, FLAT_FRAGMENT, LIT_MESH_FRAGMENT, MESH, undefined, true)),
  terrain: (tier, format, hard = false) => flatOr(tier, format, hard, FLAT_TERRAIN_VERTEX, FLAT_FRAGMENT, LIT_TERRAIN_FRAGMENT, GROUND, LIT_TERRAIN_VERTEX),
  // The same, for the tiles that read the window round the camera (terrain.ts).
  terrainWindow: (tier, format, hard): ProgramText => {
    const t = MAKE.terrain(tier, format, hard);
    return { ...t, samplers: { ...t.samplers, ...WINDOW } };
  },
  // See-through flat draws where the view is split in two depth ranges. A program of their own keeps the discard out of
  // the opaque draws, which some GPUs would then test for depth only after shading.
  seeThrough: (tier, format, hard = false) => mesh(tier, flatOr(tier, format, hard, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, LIT_SPLIT_FRAGMENT, MESH, undefined, true)),
  // Far blocks (far.ts), which fade out over the last of their reach, and nodes in the hand-over between the near store
  // and the far one (hand.ts). A program of their own keeps the discard out of the rest.
  far: (tier, format, hard = false) => mesh(tier, flatOr(tier, format, hard, FAR_MESH_VERTEX, FLAT_FAR_FRAGMENT, LIT_FAR_FRAGMENT, MESH)),
  // Far nodes of every mesh in one draw (packet.ts DRAW_PULLED), their vertices read from the atlas.
  pulled: (tier, format, hard = false) => mesh(tier, flatOr(tier, format, hard, PULLED_VERTEX, FLAT_FAR_FRAGMENT, LIT_FAR_FRAGMENT, { uPalette: UNIT.palette, uAtlas: UNIT.atlas })),
  // A textured draw (surface.ts), dyed and able to drop fragments; and the same undyed, never dropping, or both, which
  // `drawProgram` takes where a draw allows (SurfaceVariant).
  surface: (tier, format, hard = false) => surface(tier, format, hard, SURFACE_ANY),
  surfaceWhole: (tier, format, hard = false) => surface(tier, format, hard, { ...SURFACE_ANY, drops: false }),
  surfaceUndyed: (tier, format, hard = false) => surface(tier, format, hard, { ...SURFACE_ANY, dyed: false }),
  surfaceUndyedWhole: (tier, format, hard = false) => surface(tier, format, hard, { ...SURFACE_ANY, dyed: false, drops: false }),
  // The same for a body that is hurt or a corpse, which reads its layer too (packet.ts `drawLayer`). Only such a body is drawn with it.
  surfaceLayer: (tier, format, hard = false) => surface(tier, format, hard, { ...SURFACE_ANY, layered: true }),
  // The dome, and over it the sky material's pictures on its units as a material's: the moon as its base colour and the cloud layers as its two masks.
  sky: () => ({ vertex: SKY_VERTEX, fragment: SKY_FRAGMENT, defines: "", samplers: { uSkyTable: UNIT.sky, uMoon: UNIT.maps, uLow: UNIT.maps + 3, uHigh: UNIT.maps + 4 } }),
  // The sea seen from above on a lit tier: the flat mesh's tiles, the waves as a material's two masks, the ground's heights to know how deep it is, and the sun's shadow.
  water: (tier, _, hard = false) => ({
    vertex: FLAT_MESH_VERTEX,
    fragment: WATER_FRAGMENT,
    defines: shadowDefines(tier.shadows, hard),
    samplers: { ...MESH, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uMapHeight: UNIT.heights, uWindowHeight: UNIT.windowHeights, uWaveLong: UNIT.maps + 3, uWaveShort: UNIT.maps + 4 },
  }),
  // Small details (packet.ts DRAW_DETAILS): on a lit tier their pictures, lit and in the sun's shadow; on low poly their flat shapes.
  details: (tier, _, hard = false): ProgramText =>
    tier.lit
      ? { vertex: DETAIL_VERTEX, fragment: DETAIL_LIT_FRAGMENT, defines: shadowDefines(tier.shadows, hard), samplers: { uDetails: UNIT.details, uSkyTable: UNIT.sky, uShadow: UNIT.shadow } }
      : { vertex: DETAIL_VERTEX, fragment: DETAIL_FLAT_FRAGMENT, defines: "", samplers: {} },
  // A caster, a cut-out caster, and the ground, each drawn from the sun into a cascade's layer.
  depth: () => ({ vertex: DEPTH_VERTEX, fragment: DEPTH_FRAGMENT, defines: "", samplers: { uBones: UNIT.bones } }),
  depthCutout: () => ({ vertex: DEPTH_VERTEX, fragment: DEPTH_CUTOUT_FRAGMENT, defines: "", samplers: { uBones: UNIT.bones, uBase: UNIT.maps } }),
  depthTerrain: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: GROUND }),
  depthTerrainWindow: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: { ...GROUND, ...WINDOW } }),
} satisfies Record<string, Make>;

/**
 * The programs by name. A lit tier draws flat with LIT where low poly has FLAT, and draws the dome, "sky", where low
 * poly clears to its sky colour. Low poly never draws with materials, so the surface programs are lit alone, nor
 * see-through with a split (`tierPrograms`). The depth programs draw the sun's shadow maps.
 */
export const PROGRAMS: Readonly<Record<string, Make>> = MAKE;
/** Each program's number, its place in PROGRAMS: how a frame's draws name the one they are drawn with, and how a shell keeps them. */
export const PROGRAM = Object.fromEntries(Object.keys(MAKE).map((name, n) => [name, n])) as Readonly<Record<keyof typeof MAKE, number>>;

/** The programs low poly draws with: no materials, dome, sea or shadows. */
const UNLIT = ["flat", "terrain", "terrainWindow", "seeThrough", "far", "pulled", "details"];

/** The programs a frame of `tier` may ask for, by number, which a shell may begin making before one does. */
export function tierPrograms(tier: Tier): number[] {
  return Object.keys(MAKE).flatMap((name, n) => ((tier.lit || UNLIT.includes(name)) && (name !== "seeThrough" || tier.split > 0) && (!name.startsWith("depth") || tier.shadows.size > 0) ? [n] : []));
}

/** The SURFACE programs by whether a draw is dyed, twice, and may drop fragments, once. */
const SURFACES = [PROGRAM.surfaceUndyedWhole, PROGRAM.surfaceUndyed, PROGRAM.surfaceWhole, PROGRAM.surface] as const;

/**
 * The program draw `d` of a frame is drawn with, `material` its material where it has one. A textured draw is drawn
 * undyed where its material has no masks, and by a program that never drops a fragment unless it is cut out or in a
 * node's hand-over; a body with its layer by `surfaceLayer`.
 */
export function drawProgram(p: FramePacket, d: number, material: PackMaterial | undefined): number {
  const flags = p.drawFlags[d]!;
  const hand = p.drawHand[d]!;
  if ((flags & DRAW_TEXTURED) !== 0) {
    if (p.drawLayer[d]! > 0) return PROGRAM.surfaceLayer;
    const dyed = !material || material.mask >= 0 || material.mask2 >= 0;
    return SURFACES[(dyed ? 2 : 0) + (hand !== 0 || (flags & DRAW_CUTOUT) !== 0 ? 1 : 0)]!;
  }
  if ((flags & DRAW_PULLED) !== 0) return PROGRAM.pulled;
  if (p.drawFade[d] !== 0 || hand !== 0) return PROGRAM.far;
  if ((flags & DRAW_WATER) !== 0) return PROGRAM.water;
  return (flags & DRAW_BLEND) !== 0 && p.split > 0 ? PROGRAM.seeThrough : PROGRAM.flat;
}
