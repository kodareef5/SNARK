// The programs a renderer draws with, by name: for a tier, a texture variant and whether the device's compared lookups
// come back hard, each one's texts, the defines put before them, and the texture unit each of its samplers reads. A
// WebGL2 shell compiles what is listed here, as given.

import type { PackMaterial } from "../../../shared/pack/pack.ts";
import type { TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { AIR, SKY_FRAGMENT, SKY_VERTEX } from "./atmosphere.ts";
import { tekPhaseFragment, tekPhaseVertex } from "./tek-phase.ts";
import { DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT, DETAIL_LIT_VERTEX, DETAIL_VERTEX } from "./detailtext.ts";
import { FACADE_GLSL, FACADE_TIERS, facadeFarVertex, facadeVertex } from "./facade.ts";
import { FIRE_FRAGMENT, FIRE_VERTEX } from "./fire-light.ts";
import { FAR_MESH_VERTEX, FLAT_FAR_FRAGMENT, FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, FLAT_TERRAIN_VERTEX, LIT_FAR_FRAGMENT, LIT_MESH_FRAGMENT, LIT_SPLIT_FRAGMENT, LIT_TERRAIN_FRAGMENT, LIT_TERRAIN_VERTEX, PULLED_VERTEX, finishVertex } from "./glsl.ts";
import { EYE_DOME_FRAGMENT, EYE_DOME_VERTEX, EYE_ENERGY_GLSL, EYE_STRIKE_GLSL } from "./tide-eye.ts";
import { DROP_GLSL } from "./supply-light.ts";
import { FACE_FRAGMENT, FACE_VERTEX } from "./screen-shade.ts";
import { DRAW_BLEND, DRAW_EMISSIVE, DRAW_FIRE, DRAW_ORB, DRAW_PRINTED, DRAW_SCREENS, DRAW_SKYLINE, FRAME_BLOCK, SKYLINE_MAX_FOG, DRAW_CUTOUT, DRAW_PULLED, DRAW_TEXTURED, DRAW_WATER, SOURCE_MAP, SOURCE_WINDOW, WATER_MARK_COUNT, type FramePacket } from "./packet.ts";
import { BLOOM_DOWN, BLOOM_UP, FINISH, POST_VERTEX, drawsLight } from "./post.ts";
import { DEPTH_CUTOUT_FRAGMENT, DEPTH_FRAGMENT, DEPTH_VERTEX, clampDepth, shadowDefines } from "./shadowtext.ts";
import { MAX_PRINT_LAYERS } from "./print-term.ts";
import { PIECE_SPALL_RIM, PIECE_SPALL_TEXT, SURFACE_ANY, surfaceFragment, surfaceVertex, type SurfaceVariant } from "./surface.ts";
import { CASTER_ROWS, CUTOUT_CASTER_ROWS, DETAIL_ROWS, FLAT_ROWS, FRAME_ROWS, LAYER_ROWS, MATERIAL_ROWS, MESH_ROWS, PRINT_ROWS, tileRows, type UniformRow } from "./uniforms.ts";
import { SPALL_GLSL, SPALL_RIM, ownVertex, worldVertex } from "./world-surfaces.ts";
import { WATER_FRAGMENT } from "./water.ts";

/**
 * Texture units. 0 to 3 hold the palette, the whole map's heights and tints, and the bones. A material's five maps go
 * on 4 to 8, base colour first, and so do the sky's (the moon on 4, the cloud layers on 7 and 8) and the sea's (its long
 * and short waves on 7 and 8), which are materials. 9 holds the shadow maps, 10 the sky table, and 11 and 12 the
 * terrain window's heights and tints, 13 the far nodes' meshes (packet.ts `atlas`), 14 a body's hurt and decay layer.
 * 15 holds the details atlas for the details draws alone, and is free outside them: a program that does not read it may
 * bind something else there. 16, the first past the sixteen a program may read at most, holds the sky's openness
 * (skyopen.ts); 17 to 21 a facade's atlases, 22 the terrain window's roads' frame, 23 the local reflection, 24 what stands
 * overhead (roof.ts), 25 and 26 the streets' distances and kinds round the camera (streets.ts), 27 the textures the
 * card makes (client/core/texgen), and 28 the states of the near chunks' pieces (pieces.ts), which only vertex texts
 * read; 29 an orb's screen picture (video/player.ts), 30 the pictures of the screens on props (screens.ts), and 31 the
 * prints on garments (prints.ts). WebGL2 has 32 units at the least, and no program's fragment text reads more than sixteen.
 */
export const UNIT = { palette: 0, heights: 1, tint: 2, bones: 3, maps: 4, shadow: 9, sky: 10, windowHeights: 11, windowTint: 12, atlas: 13, layer: 14, details: 15, open: 16, facade: 17, road: 22, street: 23, roof: 24, streets: 25, streetKinds: 26, texgen: 27, pieces: 28, screen: 29, faces: 30, prints: 31 } as const;

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

// Remove the unused sampler declaration as well as its lookup on programs with no local environment.
const streetText = (fragment: string, on: boolean): string => on ? fragment : fragment.replace("uniform highp sampler2DArray uStreetEnv;", "");
// The textures the card makes (texgen/layers.ts) are read only where a program weathers.
const texgenText = (fragment: string, on: boolean): string => on ? fragment : fragment.replace("uniform highp sampler2DArray uTexgen;", "");
const MESH = { uPalette: UNIT.palette, uBones: UNIT.bones, uPieces: UNIT.pieces };
const GROUND = { uPalette: UNIT.palette, uHeight: UNIT.heights, uTint: UNIT.tint };
const WINDOW = { uHeight: UNIT.windowHeights, uTint: UNIT.windowTint };

/**
 * What a lit program defines: on a tier with contact, the contact of bodies (contact.ts), on one with roofs, what stands
 * overhead (roof.ts), and where its frame is drawn into the light target (post.ts), that it shows light, which the
 * finish tones and grades.
 */
const out = (tier: Tier, light: boolean): string => (tier.contact ? "#define CONTACT\n" : "") + (tier.roofs ? "#define ROOF\n" : "") + (drawsLight(tier, light) ? "#define LIGHT_TARGET\n" : "");
/** And where the tier lights by an orb (orb-light.ts), for a program that lights by `lit`: the ground's by its own say. */
const lights = (tier: Tier, light: boolean, ground = false): string => ((ground ? tier.orb.ground : tier.orb.light) ? "#define ORB_LIGHT\n" : "") + out(tier, light);

/**
 * A program of FLAT's vertex text: FLAT's fragment on low poly, and on a lit tier `lit`, which reads the sky table for
 * the haze and looks the sun's shadow up. The ground has a vertex text of its own on a lit tier, `litVertex`. A near
 * static's program (`weather`) weathers its walls where the tier reads the finishes in full (world-surfaces.ts
 * `ownVertex`, `weathered`), and rounds its edges on high and ultra and draws their wear alone on medium (`edged`).
 */
function flatOr(tier: Tier, format: TextureFormat, hard: boolean, light: boolean, vertex: string, flat: string, lit: string, samplers: Record<string, number>, litVertex?: string, weather = false): ProgramText {
  if (!tier.lit) return { vertex, fragment: flat, defines: "", samplers };
  const weathers = weather && tier.finish === "full";
  // A static's facade parts and marks where it weathers and the tier draws them (facade.ts), on five units of their own.
  const facades = weathers ? FACADE_TIERS[tier.name] : null;
  const own = weathers ? ownVertex(worldVertex(vertex)) : worldVertex(vertex);
  const facadeUnits: Record<string, number> = facades ? { uFacadeBase: UNIT.facade, uFacadeNormal: UNIT.facade + 1, uFacadeOrm: UNIT.facade + 2, uFacadeRooms: UNIT.facade + 3, uFacadeMarks: UNIT.facade + 4 } : {};
  return { vertex: litVertex ?? (facades ? facadeVertex(own) : FACADE_TIERS[tier.name] && vertex === FAR_MESH_VERTEX ? facadeFarVertex(own) : own), fragment: texgenText(streetText((facades ? lit.replaceAll("FACADE_NORMAL", format === "astc" ? "ra" : "rg") : lit.replace(FACADE_GLSL, "")).replace("nn.rg", format === "astc" ? "nn.ra" : "nn.rg"), weather && tier.lit), weathers), defines: (weather ? "#define STREET_FINISH\n" : "") + (weather && tier.lit ? "#define STREET\n" : "") + (tier.finish === "light" ? "#define WORLD_LIGHT\n" : tier.relief ? "#define WORLD_RELIEF\n" : "") + `#define WORLD_TAPS ${Math.max(1, tier.anisotropy).toFixed(1)}\n` + (weathers ? `#define WORLD_WEATHER\n${tier.finishes >= 1024 ? "#define WORLD_EDGES\n" : "#define WORLD_EDGE_LINE\n"}` : "") + (facades ? `#define FACADE\n${facades.reflect ? "#define FACADE_ROOMS\n" : ""}` : "") + shadowDefines(tier.shadows, hard) + lights(tier, light, litVertex !== undefined), samplers: { ...samplers, uWorldBase: UNIT.maps, uWorldNormal: UNIT.maps + 1, uWorldOrm: UNIT.maps + 2, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uSkyOpen: UNIT.open, uRoof: UNIT.roof, ...(litVertex ? {} : { uGroundHeight: UNIT.heights }), ...facadeUnits, ...(weather && tier.lit ? { uStreetEnv: UNIT.street } : {}), ...(weathers ? { uTexgen: UNIT.texgen } : {}) } };
}

/** A SURFACE program of a variant: a material's maps on their units, and the masks and palette only where it is dyed. */
function surface(tier: Tier, format: TextureFormat, hard: boolean, light: boolean, variant: SurfaceVariant): ProgramText {
  const samplers: Record<string, number> = { uBones: UNIT.bones, uBase: UNIT.maps, uNormal: UNIT.maps + 1, uMro: UNIT.maps + 2, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uSkyOpen: UNIT.open, uRoof: UNIT.roof, uGroundHeight: UNIT.heights, uWindowHeight: UNIT.windowHeights };
  if (tier.lit) samplers.uStreetEnv = UNIT.street;
  if (variant.dyed) Object.assign(samplers, { uPalette: UNIT.palette, uMask: UNIT.maps + 3, uMask2: UNIT.maps + 4 });
  if (variant.layered) samplers.uLayer = UNIT.layer;
  if (variant.printed) samplers.uPrints = UNIT.prints;
  // A bent piece's wear (bend.ts), and a built piece's loss to its core past worn (surface.ts PIECE_SPALL), where the tier reads the finishes in full.
  const full = tier.lit && tier.finish === "full";
  const fragment = surfaceFragment(format, AIR, variant).replace(`${PIECE_SPALL_TEXT}\n`, full ? SPALL_GLSL : "").replace(PIECE_SPALL_RIM, String(SPALL_RIM));
  return { vertex: surfaceVertex(variant), fragment: streetText(fragment, tier.lit), defines: (tier.lit ? "#define STREET\n" : "") + (full ? "#define BENT_WEAR\n#define PIECE_SPALL\n" : "") + (variant.printed ? `#define PRINT_LAYERS ${Math.min(MAX_PRINT_LAYERS, Math.max(1, tier.prints.layers))}\n` : "") + shadowDefines(tier.shadows, hard) + lights(tier, light), samplers };
}

/** `tier`, the texture variant, whether compared lookups come back hard, and whether the device has a light target (post.ts). */
type Make = (tier: Tier, format: TextureFormat, hard?: boolean, light?: boolean) => ProgramText;

/** A pass of the finish (post.ts), its source on the details' unit, which is free outside their draws, and bloom's on the layer's. */
const post = (fragment: string, samplers: Record<string, number>): ProgramText => ({ vertex: POST_VERTEX, fragment, defines: "", samplers });

/** A flat mesh program, whose vertices on a lit tier take their landmark's finishes (glsl.ts `finishVertex`). */
const mesh = (tier: Tier, made: ProgramText): ProgramText => (tier.lit ? { ...made, vertex: finishVertex(made.vertex) } : made);

function phaseMesh(tier: Tier, text: ProgramText): ProgramText {
  const made = mesh(tier, text);
  return { ...made, vertex: tekPhaseVertex(made.vertex), fragment: tekPhaseFragment(made.fragment), defines: made.defines + (tier.lit ? "#define TEK_CELLS\n" : "") };
}

function water(tier: Tier, hard: boolean, light: boolean, wakes: boolean): ProgramText {
  return {
    vertex: FLAT_MESH_VERTEX,
    fragment: WATER_FRAGMENT,
    // The sea is lit by its own glint and not `lit`, so the street lamp's light is not looked up for it.
    defines: shadowDefines(tier.shadows, hard, false) + out(tier, light) + (wakes ? "#define LOCAL_WAKES\n" : ""),
    samplers: { ...MESH, uSkyTable: UNIT.sky, uShadow: UNIT.shadow, uMapHeight: UNIT.heights, uWindowHeight: UNIT.windowHeights, uWindowTint: UNIT.windowTint, uWaveLong: UNIT.maps + 3, uWaveShort: UNIT.maps + 4 },
  };
}

/**
 * Fragment texts that come after the first frame, each set by the late file that holds it: the orb's (orb-late.ts).
 * Until one has come its program is not among a tier's, and nothing is drawn with it. The programs that draw prints are
 * a tier's once the first print's array is made (prints.ts), so a world with none links none of them.
 */
export const LATE: { orb: string | null; prints: boolean } = { orb: null, prints: false };

const MAKE = {
  flat: (tier, format, hard = false, light = false) => phaseMesh(tier, flatOr(tier, format, hard, light, FLAT_MESH_VERTEX, FLAT_FRAGMENT, LIT_MESH_FRAGMENT, MESH, undefined, true)),
  // Where the tier reads the finishes in full, asphalt, sand and walks wear (world-surfaces.ts `roadWorn`, `walkWorn`).
  terrain: (tier, format, hard = false, light = false) => {
    const t = flatOr(tier, format, hard, light, FLAT_TERRAIN_VERTEX, FLAT_FRAGMENT, LIT_TERRAIN_FRAGMENT, tier.lit ? { ...GROUND, uRoad: UNIT.road, uStreets: UNIT.streets, uStreetKinds: UNIT.streetKinds } : GROUND, LIT_TERRAIN_VERTEX);
    return tier.lit && tier.finish === "full" ? { ...t, defines: `#define WORLD_ROAD\n${t.defines}` } : t;
  },
  // The same, for the tiles that read the window round the camera (terrain.ts), where asphalt wears along the roads' frame
  // and, near the camera, the streets' edges are drawn from their lines (streets.ts).
  terrainWindow: (tier, format, hard, light): ProgramText => {
    const t = MAKE.terrain(tier, format, hard, light), full = tier.lit && tier.finish === "full";
    return { ...t, defines: full ? `#define GROUND_ROAD\n#define GROUND_STREETS\n${t.defines}` : t.defines, samplers: { ...t.samplers, ...WINDOW } };
  },
  // See-through flat draws where the view is split in two depth ranges. A program of their own keeps the discard out of
  // the opaque draws, which some GPUs would then test for depth only after shading.
  seeThrough: (tier, format, hard = false, light = false) => phaseMesh(tier, flatOr(tier, format, hard, light, FLAT_MESH_VERTEX, FLAT_SPLIT_FRAGMENT, LIT_SPLIT_FRAGMENT, MESH, undefined, true)),
  // Far blocks (far.ts), which fade out over the last of their reach, and nodes in the hand-over between the near store
  // and the far one (hand.ts). A program of their own keeps the discard out of the rest.
  far: (tier, format, hard = false, light = false) => mesh(tier, flatOr(tier, format, hard, light, FAR_MESH_VERTEX, FLAT_FAR_FRAGMENT, LIT_FAR_FRAGMENT, MESH)),
  // Far nodes of every mesh in one draw (packet.ts DRAW_PULLED), their vertices read from the atlas.
  pulled: (tier, format, hard = false, light = false) => mesh(tier, flatOr(tier, format, hard, light, PULLED_VERTEX, FLAT_FAR_FRAGMENT, LIT_FAR_FRAGMENT, { uPalette: UNIT.palette, uAtlas: UNIT.atlas })),
  // A textured draw (surface.ts), dyed and able to drop fragments; and the same undyed, never dropping, or both, which
  // `drawProgram` takes where a draw allows (SurfaceVariant).
  surface: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, SURFACE_ANY),
  surfaceWhole: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, drops: false }),
  surfaceUndyed: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, dyed: false }),
  surfaceUndyedWhole: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, dyed: false, drops: false }),
  // The same for a body that is hurt or a corpse, which reads its layer too (packet.ts `drawLayer`). Only such a body is drawn with it.
  surfaceLayer: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, layered: true }),
  // The dome, and over it the sky material's pictures on its units as a material's: the moon as its base colour and the cloud layers as its two masks.
  sky: (tier, _, __, light = false): ProgramText => tier.lit
    ? { vertex: SKY_VERTEX, fragment: SKY_FRAGMENT, defines: out(tier, light), samplers: { uSkyTable: UNIT.sky, uMoon: UNIT.maps, uLow: UNIT.maps + 3, uHigh: UNIT.maps + 4 } }
    : { vertex: EYE_DOME_VERTEX, fragment: EYE_DOME_FRAGMENT, defines: "", samplers: {} },
  // The sea seen from above on a lit tier: the flat mesh's tiles, the waves as a material's two masks, the ground's heights to know how deep it is, the window's tints to know what its bank is, and the sun's shadow.
  water: (tier, _, hard = false, light = false) => water(tier, hard, light, false),
  waterWake: (tier, _, hard = false, light = false) => water(tier, hard, light, true),
  // Small details (packet.ts DRAW_DETAILS): on a lit tier their pictures, lit and in the sun's shadow; on low poly their flat shapes.
  details: (tier, _, hard = false, light = false): ProgramText =>
    tier.lit
      ? { vertex: DETAIL_LIT_VERTEX, fragment: DETAIL_LIT_FRAGMENT, defines: "#define STREET\n" + shadowDefines(tier.shadows, hard) + lights(tier, light), samplers: { uDetails: UNIT.details, uStreetEnv: UNIT.street, uSkyTable: UNIT.sky, uShadow: UNIT.shadow } }
      : { vertex: DETAIL_VERTEX, fragment: DETAIL_FLAT_FRAGMENT, defines: "", samplers: {} },
  // A caster, a cut-out caster, and the ground, each drawn from the sun into a cascade's layer.
  depth: () => ({ vertex: tekPhaseVertex(DEPTH_VERTEX), fragment: tekPhaseFragment(DEPTH_FRAGMENT, true), defines: "", samplers: { uBones: UNIT.bones, uPieces: UNIT.pieces } }),
  depthCutout: () => ({ vertex: tekPhaseVertex(DEPTH_VERTEX), fragment: tekPhaseFragment(DEPTH_CUTOUT_FRAGMENT, true), defines: "", samplers: { uBones: UNIT.bones, uBase: UNIT.maps, uPieces: UNIT.pieces } }),
  depthTerrain: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: GROUND }),
  skyline: () => ({ vertex: FLAT_MESH_VERTEX, fragment: FLAT_FRAGMENT.replace("fog * fog", `min(fog * fog, ${SKYLINE_MAX_FOG})`), defines: "", samplers: MESH }),
  // An instrument's own lights (packet.ts DRAW_EMISSIVE) where they are drawn flat: energy in a channel by the site's
  // clock (tide-eye.ts eyeEnergy), along the instrument by where the point is and hotter on the faces turned to the eye,
  // as light that blooms where the frame is drawn into the light target, and never fogged. A supply drop's lights
  // drawn flat are its own (supply-light.ts), which the draw's effect says: a tube of its tier's colour, hot along its middle.
  // Drawn see-through, as a map event's beam is, it shows its share of what is behind it (uAlpha).
  signal: (tier, _, __, light = false) => ({ vertex: FLAT_MESH_VERTEX, fragment: `#version 300 es
precision highp float;
in vec3 vRel;
flat in vec3 vColor;
uniform vec4 uEffect;
uniform float uAlpha;
out vec4 o;
${FRAME_BLOCK}${EYE_STRIKE_GLSL}${EYE_ENERGY_GLSL}${DROP_GLSL}
void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  float facing = abs(dot(n, normalize(vRel)));
  vec3 light = uEffect.y > 0. ? dropLight(0., sqrt(max(0., 1.-facing*facing)), uEffect)
    : fEyes[0].w > 0. ? eyeEnergy(vRel, -2.e9, .85*sqrt(max(0., 1.-facing*facing)), length(fwidth(vRel))) : vColor*vColor;
#ifdef LIGHT_TARGET
  o = vec4(light, uAlpha);
#else
  o = vec4(1.-exp(-light), uAlpha);
#endif
}`, defines: drawsLight(tier, light) ? "#define LIGHT_TARGET\n" : "", samplers: MESH }),
  depthTerrainWindow: () => ({ vertex: clampDepth(FLAT_TERRAIN_VERTEX), fragment: DEPTH_FRAGMENT, defines: "", samplers: { ...GROUND, ...WINDOW } }),
  // Fire (packet.ts DRAW_FIRE): a rocket's flame and a fireball's lobes, worked out with no texture read (fire-light.ts).
  // A lit tier lights the soot from the frame block, and a tier reads the octaves of value noise it pays for.
  fire: (tier, _, __, light = false) => ({ vertex: FIRE_VERTEX, fragment: FIRE_FRAGMENT, defines: (tier.lit ? "#define FIRE_LIT\n" : "") + (tier.bursts.noise > 0 ? "#define FIRE_NOISE\n" : "") + (tier.bursts.noise > 1 ? "#define FIRE_FINE\n" : "") + (drawsLight(tier, light) ? "#define LIGHT_TARGET\n" : ""), samplers: {} }),
  // An orb's screen (packet.ts DRAW_ORB, orb.ts): the tier's octaves of noise, its pucks or none, and its picture. Signal's text stands in until the late one has come.
  orb: (tier, format, hard, light = false): ProgramText => LATE.orb === null ? MAKE.signal(tier, format, hard, light) : { vertex: FLAT_MESH_VERTEX, fragment: LATE.orb, defines: `#define ORB_OCTAVES ${tier.orb.octaves}\n` + (tier.orb.pucks ? "#define ORB_PUCKS\n" : "") + (drawsLight(tier, light) ? "#define LIGHT_TARGET\n" : ""), samplers: { ...MESH, uScreen: UNIT.screen } },
  // The screens on props (packet.ts DRAW_SCREENS, screen-shade.ts): a quad on each face, its picture a layer of theirs.
  screens: (tier, _, __, light = false): ProgramText => ({ vertex: FACE_VERTEX, fragment: FACE_FRAGMENT, defines: drawsLight(tier, light) ? "#define LIGHT_TARGET\n" : "", samplers: { uFaces: UNIT.faces } }),
  // The finish (post.ts): bloom's chain down and up, and the pass into the canvas.
  bloomDown: () => post(BLOOM_DOWN, { uSource: UNIT.details }),
  bloomUp: () => post(BLOOM_UP, { uSource: UNIT.details }),
  finish: () => post(FINISH, { uScene: UNIT.details, uBloom: UNIT.layer }),
  // Last, so the programs before keep their numbers: a draw whose instances carry prints (packet.ts DRAW_PRINTED, print-term.ts): never dropping, able to, and with a layer.
  surfacePrinted: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, drops: false, printed: true }),
  surfacePrintedCut: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, printed: true }),
  surfacePrintedLayer: (tier, format, hard = false, light = false) => surface(tier, format, hard, light, { ...SURFACE_ANY, layered: true, printed: true }),
} satisfies Record<string, Make>;

/**
 * The programs by name. A lit tier draws flat with LIT where low poly has FLAT, and draws the dome, "sky", where low
 * poly clears to its sky colour. Low poly never draws with materials, so the surface programs are lit alone, nor
 * see-through with a split (`tierPrograms`). The depth programs draw the sun's shadow maps.
 */
export const PROGRAMS: Readonly<Record<string, Make>> = MAKE;
/** Each program's number, its place in PROGRAMS: how a frame's draws name the one they are drawn with, and how a shell keeps them. */
export const PROGRAM = Object.fromEntries(Object.keys(MAKE).map((name, n) => [name, n])) as Readonly<Record<keyof typeof MAKE, number>>;

const FLAT_DRAW = [...FRAME_ROWS, ...MESH_ROWS, ...FLAT_ROWS], SURFACE_DRAW = [...FRAME_ROWS, ...MESH_ROWS, ...MATERIAL_ROWS];
const GROUND_TILES = [...FRAME_ROWS, ...tileRows(SOURCE_MAP)], WINDOW_TILES = [...FRAME_ROWS, ...tileRows(SOURCE_WINDOW)];

/**
 * Each program's uniforms as rows (uniforms.ts), in the order a shell sets them. A row its texts do not declare costs
 * nothing: a shell looks for a row's place when the program links and walks those it found. So a uniform for a
 * program is a row in its list here, and a new program's uniforms are its list. The finish's passes take theirs from
 * the shell alone (uniforms.ts SHELL_UNIFORMS).
 */
const ROWS: Readonly<Record<keyof typeof MAKE, readonly UniformRow[]>> = {
  flat: FLAT_DRAW,
  terrain: GROUND_TILES,
  terrainWindow: WINDOW_TILES,
  seeThrough: FLAT_DRAW,
  far: FLAT_DRAW,
  pulled: FLAT_DRAW,
  surface: SURFACE_DRAW,
  surfaceWhole: SURFACE_DRAW,
  surfaceUndyed: SURFACE_DRAW,
  surfaceUndyedWhole: SURFACE_DRAW,
  surfaceLayer: [...SURFACE_DRAW, ...LAYER_ROWS],
  sky: FRAME_ROWS,
  water: [...FRAME_ROWS, ...MESH_ROWS],
  waterWake: [...FRAME_ROWS, ...MESH_ROWS],
  details: [...FRAME_ROWS, ...DETAIL_ROWS],
  depth: CASTER_ROWS,
  depthCutout: CUTOUT_CASTER_ROWS,
  depthTerrain: GROUND_TILES,
  skyline: FLAT_DRAW,
  signal: FLAT_DRAW,
  depthTerrainWindow: WINDOW_TILES,
  fire: [...FRAME_ROWS, ...MESH_ROWS],
  orb: FLAT_DRAW,
  screens: FRAME_ROWS,
  bloomDown: [],
  bloomUp: [],
  finish: [],
  surfacePrinted: [...SURFACE_DRAW, ...PRINT_ROWS],
  surfacePrintedCut: [...SURFACE_DRAW, ...PRINT_ROWS],
  surfacePrintedLayer: [...SURFACE_DRAW, ...LAYER_ROWS, ...PRINT_ROWS],
};
/** The same by a program's number. */
export const UNIFORMS: readonly (readonly UniformRow[])[] = Object.keys(MAKE).map((name) => ROWS[name as keyof typeof MAKE]);

/**
 * The program a draw is ordered by among a step's (draws.ts byState): a printed one's plain twin, so prints move no draw.
 * By their own numbers, which come last, a printed body went after what it covers, and the GPU shaded that in full.
 */
export function orderedAs(program: number): number {
  return program === PROGRAM.surfacePrinted ? PROGRAM.surfaceWhole : program === PROGRAM.surfacePrintedCut ? PROGRAM.surface : program === PROGRAM.surfacePrintedLayer ? PROGRAM.surfaceLayer : program;
}

/** The programs low poly draws with: no materials, dome, sea or shadows. */
const UNLIT = ["skyline", "signal", "sky", "flat", "terrain", "terrainWindow", "seeThrough", "far", "pulled", "details", "fire", "orb", "screens"];
const POST = ["bloomDown", "bloomUp", "finish"];
const PRINTED = ["surfacePrinted", "surfacePrintedCut", "surfacePrintedLayer"];

/** The programs a frame of `tier` may ask for, by number, which a shell may begin making before one does. */
export function tierPrograms(tier: Tier): number[] {
  return Object.keys(MAKE).flatMap((name, n) => ((tier.lit || UNLIT.includes(name)) && (name !== "seeThrough" || tier.split > 0) && (!name.startsWith("depth") || tier.shadows.size > 0) && (!POST.includes(name) || tier.post !== null) && (name !== "orb" || LATE.orb !== null) && (!PRINTED.includes(name) || (LATE.prints && tier.prints.layers > 0)) ? [n] : []));
}

/**
 * What picks a draw's program besides its DRAW_ flags, as bits over them (the flags stay under bit 24): it has a layer
 * (packet.ts drawLayer); its material is dyed, having a mask, or it has no material; it is in a node's hand-over; its
 * cell of trees is changing level (hand.ts swapKeeps); it fades out with distance; the frame has wakes on the water; the
 * frame's tier splits the view in two depth ranges.
 */
export const IS_LAYERED = 1 << 24, IS_DYED = 1 << 25, IS_HANDED = 1 << 26, IS_SWAPPING = 1 << 27, IS_FADED = 1 << 28, HAS_WAKES = 1 << 29, HAS_SPLIT = 1 << 30;

/** A row of the choice: a program, for a draw with every flag and fact of `all`, one of `any` where it names some, and none of `none`. */
export interface Choice {
  readonly program: number;
  readonly all: number;
  readonly any: number;
  readonly none: number;
}
const pick = (program: number, all = 0, any = 0, none = 0): Choice => ({ program, all, any, none });
/** A textured draw may drop fragments where it is cut out, in a hand-over, or of a cell changing level. */
const DROPS = DRAW_CUTOUT | IS_HANDED | IS_SWAPPING;

/**
 * The program a draw is drawn with: that of the first row it fits. A textured draw is drawn undyed where its material
 * has no masks, and by a program that never drops a fragment unless it may; a body with its layer by `surfaceLayer`. A
 * new kind of draw is a row here, before the first row that would take it otherwise.
 */
export const CHOICE: readonly Choice[] = [
  pick(PROGRAM.screens, DRAW_SCREENS),
  pick(PROGRAM.fire, DRAW_FIRE),
  pick(PROGRAM.orb, DRAW_ORB),
  // An instrument's light with its strip is a SURFACE draw, which its street material draws as a channel of energy.
  pick(PROGRAM.signal, DRAW_EMISSIVE, 0, DRAW_TEXTURED),
  pick(PROGRAM.skyline, DRAW_SKYLINE),
  // A print lies on dyed cloth only: an undyed material of a printed draw keeps its own, cheaper program.
  pick(PROGRAM.surfacePrintedLayer, DRAW_TEXTURED | DRAW_PRINTED | IS_DYED | IS_LAYERED),
  pick(PROGRAM.surfacePrintedCut, DRAW_TEXTURED | DRAW_PRINTED | IS_DYED, DROPS),
  pick(PROGRAM.surfacePrinted, DRAW_TEXTURED | DRAW_PRINTED | IS_DYED),
  pick(PROGRAM.surfaceLayer, DRAW_TEXTURED | IS_LAYERED),
  pick(PROGRAM.surface, DRAW_TEXTURED | IS_DYED, DROPS),
  pick(PROGRAM.surfaceWhole, DRAW_TEXTURED | IS_DYED),
  pick(PROGRAM.surfaceUndyed, DRAW_TEXTURED, DROPS),
  pick(PROGRAM.surfaceUndyedWhole, DRAW_TEXTURED),
  pick(PROGRAM.pulled, DRAW_PULLED),
  pick(PROGRAM.far, 0, IS_FADED | IS_HANDED),
  pick(PROGRAM.waterWake, DRAW_WATER | HAS_WAKES),
  pick(PROGRAM.water, DRAW_WATER),
  pick(PROGRAM.seeThrough, DRAW_BLEND | HAS_SPLIT),
  pick(PROGRAM.flat),
];
/** The rows as numbers, four a row, which the walk below reads. */
const PICKS = Int32Array.from(CHOICE.flatMap((c) => [c.all, c.any, c.none, c.program]));

/** The program draw `d` of a frame is drawn with (CHOICE), `material` its material where it has one. */
export function drawProgram(p: FramePacket, d: number, material: PackMaterial | undefined): number {
  const is = p.drawFlags[d]!
    | (p.drawLayer[d]! > 0 ? IS_LAYERED : 0)
    | (!material || material.mask >= 0 || material.mask2 >= 0 ? IS_DYED : 0)
    | (p.drawHand[d] !== 0 ? IS_HANDED : 0)
    | (p.drawSwap[d] !== 0 ? IS_SWAPPING : 0)
    | (p.drawFade[d] !== 0 ? IS_FADED : 0)
    | (p.frame[WATER_MARK_COUNT]! > 0 ? HAS_WAKES : 0)
    | (p.split > 0 ? HAS_SPLIT : 0);
  for (let k = 0; k < PICKS.length; k += 4) {
    const all = PICKS[k]!, any = PICKS[k + 1]!;
    if ((is & all) === all && (any === 0 || (is & any) !== 0) && (is & PICKS[k + 2]!) === 0) return PICKS[k + 3]!;
  }
  return PROGRAM.flat;
}
