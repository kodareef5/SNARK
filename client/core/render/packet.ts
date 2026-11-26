// Everything a renderer needs to draw one frame, as data. client/core decides what is visible, and a renderer only executes.
// Uploads and drops persist across frames and must be applied in order. Draws and terrain tiles describe this frame only.

import { MASK_LAYER, MASK_MATERIALS, SURFACE_NAMES } from "../../../content/surfaces.ts";
import { MADE_FLOATS, MADE_READS } from "../texgen/layers.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { INSTANCE_BYTES, MATERIAL_CUTOUT, MATERIAL_BLEND, MATERIAL_EXHAUST, MATERIAL_LENS, MATERIAL_TWO_SIDED } from "../../../shared/pack/pack.ts";
import type { TextureFormat, TextureRole } from "../../../shared/pack/texture.ts";
import type { AssetUpload } from "../assets/residency.ts";
import type { FrameTable } from "./piece-fit.ts";
import { PIECE_KEYS, PIECE_ROWS } from "./pieces.ts";
import { DEFAULT_TIER, tierOf, type Tier } from "../assets/tiers.ts";
import { STREET_TILE_BYTES, STREET_TILES_FRAME } from "./streets.ts";
// What the shell puts the streets' tiles on the card by.
export { STREET_SIDE, STREET_TILE_BYTES, STREET_TILE_SIDE } from "./streets.ts";

/** Layers of the world finishes' arrays: a finish each, then the masks' (content/surfaces.ts MASK_MATERIALS). */
export const WORLD_LAYERS = MASK_LAYER + MASK_MATERIALS.length;
export const MAX_DRAWS = 4096;
export const MAX_TILES = 1024;
/** Quads per terrain tile side, at every level. */
export const TILE_QUADS = 32;
/** Buffer id for the per-frame instance data carried in the packet itself. */
export const TRANSIENT_BUFFER = 0xffffffff;
/**
 * Instances a frame may carry besides entities: water surface tiles, every one of the 17 by 17 kilometre tiles round the
 * camera that ultra's 8 km view reaches, sixteen marker beams, and a piece about to be built.
 */
export const MAX_WATER_TILES = 289;
/** Pieces set down and awaited a frame may show as built (passes/ghost.ts). */
export const MAX_PREDICTED = 32;
/** Pieces of a template or a plan a frame may show where they would stand (passes/holograms.ts). The nearest are shown. */
export const MAX_HOLOGRAMS = 256;
/** Structures a frame may show falling. The nearest to the camera are shown. */
export const MAX_FALLING = 1024;
/**
 * DRAW_ flags, a bit each of `drawFlags`, which holds 32. A blended draw is see-through. It comes after everything opaque,
 * shows both faces and writes no depth.
 */
export const DRAW_BLEND = 1;
/**
 * The mesh follows bones. Each vertex names a bone, and the instance carries the index of its first bone in `bones`
 * where a rigid instance has its yaw. A bone's rows take a vertex all the way to the camera-relative world. The
 * instance's position is added to each vertex first, which lets a held item hang on a bone of a rig it was not made on.
 */
export const DRAW_SKINNED = 2;
/** No checker pattern. A checker fixed to the world would crawl over a moving body. */
export const DRAW_PLAIN = 4;
/** The viewer's own body. Drawn last, over everything, with `nearViewProj`, whose near plane is close enough for arms and hands. */
export const DRAW_NEAR = 8;
/**
 * Bodies the frame had no bones left to pose, standing in a pose for what each is doing (characters.ts standIn): the x of
 * `drawOffset` is that pose's first bone, whose rows take a vertex about the body's origin. Each vertex follows its bone
 * there, and then the instance's first bone, which places the body.
 */
export const DRAW_ONE_BONE = 16;
/**
 * Drawn with a material: `drawMaterial` names it, and `drawFirstIndex` and `drawIndexCount` the run of the level's
 * indices it covers. A draw without this bit covers its whole level in palette colours.
 */
export const DRAW_TEXTURED = 32;
/** Both faces show. */
export const DRAW_TWO_SIDED = 64;
/** Nothing shows where the base colour's alpha is under the material's cutoff. */
export const DRAW_CUTOUT = 128;

export function texturedFlags(flags: number): number {
  return DRAW_TEXTURED | ((flags & MATERIAL_TWO_SIDED) ? DRAW_TWO_SIDED : 0)
    | ((flags & MATERIAL_CUTOUT) ? DRAW_CUTOUT : 0) | ((flags & (MATERIAL_LENS | MATERIAL_EXHAUST | MATERIAL_BLEND)) ? DRAW_BLEND : 0);
}

/**
 * A rigid draw whose instances carry their size in colour region SIZE_REGION, in SIZE_UNITS (shared/world/nodes.ts) of the
 * size the mesh was made: a resource node. Each is drawn that size about its origin, and the region gives no colour.
 */
export const DRAW_SIZED = 256;
export const SIZE_REGION = 5;
/**
 * Water seen from above on a lit tier (render/water.ts), a see-through draw of the flat mesh `core:water`, or of a lake
 * tile (render/lakes.ts), whose `drawMaterial` holds the waves' pictures. Where this bit is not understood it is the
 * see-through flat draw it always was.
 */
export const DRAW_WATER = 512;
/**
 * Far trees, rocks and bushes of every mesh in one draw (farnodes.ts): each instance names its mesh's row of `atlas` in
 * colour region ATLAS_REGION and is drawn as that row's vertices, sized and turned as DRAW_SIZED has it, to the row's
 * reach. The level the draw names is only a run of indices from 0, as many as the longest of its rows.
 */
export const DRAW_PULLED = 1024;
/**
 * Small details (client/core/details/): a draw of particles from the packet's `details`, `drawFirst` the first and
 * `drawInstances` how many, each a card of two triangles. With DRAW_CUTOUT it is drawn solid with the opaque, with
 * DRAW_BLEND see-through; it names no mesh, level or buffer.
 */
export const DRAW_DETAILS = 2048;
/** Particles a frame may carry, and the floats of each, as `details` lays them out (DETAIL_). */
export const MAX_DETAILS = 8192;
export const DETAIL_FLOATS = 13;
/**
 * Where each value of a particle is, in floats: its middle (camera-relative), the half axes of its card, along its length
 * and across it, the height of the ground under it (camera-relative), then three words of four bytes: its first colour
 * and its second (sRGB), and its atlas cell, its shape and flags (DETAIL_), how much of it shows of 255, and the grey of
 * its picture of 255.
 */
export const DETAIL = { middle: 0, along: 3, across: 6, floor: 9, colourA: 10, colourB: 11, misc: 12 } as const;
/** The flags of a particle, in its misc word's second byte over its shape (FLAT_SHAPES): lit, and lit as a puff of something. */
export const DETAIL_LIT = 8;
export const DETAIL_PUFF = 16;
/** Analytic rotor coverage instead of an atlas picture. Grey stores blade coverage at the tip; no extra asset or draw. */
export const DETAIL_ROTOR = 32;
/** Analytic emissive strip and halo of an active vehicle lens. */
export const DETAIL_LAMP = 64;
/** Analytic soft disc of a working street lamp's light: its pool on the ground, or its glow round the lens (street-lamps.ts). */
export const DETAIL_POOL = 128;
/** A length of wire hung between two poles (street-wires.ts): the pool's flag over shape 1, as a pool has no shape of its own. */
export const DETAIL_WIRE = DETAIL_POOL | 1;
export const DETAIL_GLASS = DETAIL_POOL | 2;
export const DETAIL_TIRE = DETAIL_POOL | 3;
/**
 * A street lamp's pool on the ground that takes the shadows of the bodies near it (lamp.ts poolShade): its second colour,
 * which a pool's shape does not use, holds where its lens is from its middle (lamp.ts lensWord).
 */
export const DETAIL_SHADED_POOL = DETAIL_POOL | 6;
/** A sunlit aerated streak at the stern. Its grey byte seeds the shape. */
export const DETAIL_WAKE = DETAIL_POOL | DETAIL_LIT | 4;
/**
 * A damage number (damage-numbers.ts): its glyphs drawn by their distance (digits.ts), filled with its first colour and
 * outlined in deep navy, the glyphs packed in its second colour's three bytes. Unlit and unfogged, as the HUD is.
 */
export const DETAIL_DIGITS = DETAIL_POOL | 5;
/**
 * Light with no surface (shared/pack/details.ts `glow`): a soft disc of its first colour, as many times as bright as
 * its grey byte is sixteenths, added over what is behind it and never hiding it.
 */
export const DETAIL_GLOW = DETAIL_POOL | 7;
/** A contact wave clipped to a Tek wall face. Its floor holds its radius in metres. */
export const DETAIL_TEK = DETAIL_POOL | 4;
/**
 * A thick puff of smoke worked out with no picture (shared/pack/details.ts `thick`), lit as a ball of smoke is, on the
 * side the sun is: its second colour's first byte is its seed and its second how far it is torn, and its grey byte is
 * how many times longer than wide its card is, in SMOKE_STEPS, past which it is a length of a rope of smoke.
 */
export const DETAIL_SMOKE = DETAIL_POOL | DETAIL_LIT | DETAIL_PUFF;
export const SMOKE_STEPS = 16;
/** A scorch (shared/pack/details.ts `stain`): an uneven patch of soot with rays, which takes light and gives none. Its second colour's first byte is its seed. */
export const DETAIL_SCORCH = DETAIL_POOL | DETAIL_LIT | 3;
/** The sixteenths of a DETAIL_GLOW particle's grey byte. */
export const GLOW_STEPS = 16;
/** A flat draw of `drawIndexCount` of its level's indices from `drawFirstIndex`, as a textured draw's run is: a run of a far city tile's chunks (farcity.ts). */
export const DRAW_RANGED = 4096;
/**
 * Paint on the ground (shared/content/defs.ts StructureDef `paint`): a rigid draw each of whose vertices stands its own
 * height over the ground under it, as the terrain window holds the ground's samples, and where the window does not reach,
 * where its instance stands (surface.ts `onGround`). A textured draw does this; a flat one is drawn as it stands.
 */
export const DRAW_GROUND = 8192;
/** A self-lit optical surface in its instance dye. */
export const DRAW_EMISSIVE = 16384;
/** An elevated navigational landmark whose flat silhouette remains visible through the city's distance fade. */
export const DRAW_SKYLINE = 32768;
/**
 * Bent along the street (render/bend.ts, shared/world/bends.ts): each instance's bend, its two attributes, is in the
 * buffer BEND_BUFFERS past its instances', at the same place, and the draw's vertices are bent by it before it is turned.
 */
export const DRAW_BENT = 65536;
/**
 * Two bits from DRAW_HEAT_SHIFT: how hot a body a draw is in a visor's heat view (D1081), 0 where the world's own heat is
 * shown, 1 a cold-blooded creature's, 2 a warm one's, 3 hot. The shell gives the code to `uHeat`.
 */
export const DRAW_HEAT_SHIFT = 17;
/**
 * Fire (render/fire-light.ts): a rocket's flame or a blast's fireball, a draw of the mesh `core:fire_cone` or
 * `core:fire_lobe` whose instances say where each is and how it burns. Its colour is light already weighed by how much
 * of it shows, so it is blended as such, front faces alone.
 */
export const DRAW_FIRE = 1 << 19;
/**
 * An orb's screen (render/orb.ts): a flat draw of its shell, each pixel worked out from where it is on the ball by the
 * frame block's fOrb. Drawn flat whatever materials the shell's mesh has.
 */
export const DRAW_ORB = 1 << 20;
/**
 * Built pieces and their trims (render/piece-fit.ts): each instance's last three regions are a recipe material, a state
 * and a fit, and where it is framed its yaw's place holds a slot of `frameTables` for the draw's buffer and a direction.
 */
export const DRAW_PIECE = 1 << 21;
export const HEAT_WORLD = 0;
export const HEAT_COLD = 1;
export const HEAT_WARM = 2;
export const HEAT_HOT = 3;
/** A chunk's buffer of its bent pieces' bends, beside its instances' buffer `id`, is `id` + BEND_BUFFERS, a bend BEND_BYTES. */
export const BEND_BUFFERS = 4 << 20;
export { BEND_BYTES } from "../../../shared/world/bends.ts";
export const SKYLINE_MAX_FOG = 0.56;
/** Faces of four corners that 16-bit indices reach. */
export const QUAD_FACES = 16384;

/** The bytes of an index of a level of quads (quadIndices) with `faces` faces. */
export function quadBytes(faces: number): 2 | 4 {
  return faces > QUAD_FACES ? 4 : 2;
}

/** How many quadIndices holds for at least `count` indices of `bytes` each. */
export function quadIndexCount(count: number, bytes: 2 | 4): number {
  const step = (QUAD_FACES / 4) * 6;
  return bytes === 2 ? QUAD_FACES * 6 : Math.ceil(count / step) * step;
}

/**
 * The indices of every level of quads, far blocks, far city tiles and lakes: face f is the triangles 4f, 4f+1, 4f+2 and
 * 4f, 4f+2, 4f+3. The card holds them once for all such levels, which send their vertices alone (AssetUpload `quads`):
 * at least `count`, `bytes` each, as many as 16-bit indices reach, or 32-bit ones in steps of 4,096 faces (96 KB).
 */
export function quadIndices(count: number, bytes: 2 | 4): Uint16Array | Uint32Array {
  const n = quadIndexCount(count, bytes);
  const out = bytes === 2 ? new Uint16Array(n) : new Uint32Array(n);
  for (let i = 0, v = 0; i < n; i += 6, v += 4) {
    out[i] = out[i + 3] = v;
    out[i + 1] = v + 1;
    out[i + 2] = out[i + 4] = v + 2;
    out[i + 5] = v + 3;
  }
  return out;
}
export const ATLAS_REGION = 4;
/**
 * The far nodes' meshes as a float texture ATLAS_WIDTH texels wide, a row a mesh: in its first texel its reach and its
 * vertices, and then each vertex of its last level, triangle by triangle, as x, y, z in metres and its palette colour.
 */
export const ATLAS_WIDTH = 193;
export const ATLAS_ROWS = 128;

/** Floats per bone: three rows of a 3 x 4 matrix, each row x, y, z, translation. */
export const BONE_FLOATS = 12;
/** Bones per row of the bone texture. A texel is four floats, so a bone is three texels. */
export const BONES_PER_ROW = 256;
/**
 * 65,536, which is as many as an instance's sixteen bits can name the first of. A graphics tier has fewer (assets/tiers.ts),
 * and its texture as many rows as those take (boneRows).
 */
export const MAX_BONES = BONES_PER_ROW * 256;

/** The rows of the bone texture a tier with `bones` bones has. */
export function boneRows(bones: number): number {
  return Math.ceil(Math.min(bones, MAX_BONES) / BONES_PER_ROW);
}
/** Skinned instances a frame may carry. Every body is several meshes. */
export const MAX_SKINNED = MAX_VIEW * 10;
/** Sun shadow cascades a tier may have, and shadow casters a frame may carry, in a list apart from its draws. */
export const MAX_CASCADES = 4;
export const MAX_CASTERS = 4096;
/** The depth range a draw is in (`drawPass`): the near one, which `split` ends, or the far one. */
export const PASS_NEAR = 0;
export const PASS_FAR = 1;
/**
 * The steps a frame is drawn in, in this order, which is the order of its draws: near opaque, far opaque, then the
 * dome (at `skyAt`), far see-through, near see-through, and the viewer's body over a depth clear. The opaque steps are
 * numbered as their ranges are. In an opaque step the draws with DRAW_CUTOUT come after the rest (scene.ts `cutouts`),
 * and the ground's tiles go where `groundAt` says.
 */
export const STEP_NEAR = PASS_NEAR;
export const STEP_FAR = PASS_FAR;
export const STEP_FAR_SEE = 2;
export const STEP_NEAR_SEE = 3;
export const STEP_BODY = 4;

/**
 * Whether the `n` numbers from `o` of `from` differ from those a renderer keeps at `at` of `last`, which are made the
 * same: a renderer sets a program's vector (a draw's offset, its effect) only when this says so. Nothing is made.
 */
export function moved(last: Float64Array, at: number, from: Float32Array, o: number, n: number): boolean {
  let same = true;
  for (let k = 0; k < n; k++) {
    if (last[at + k] !== from[o + k]) same = false;
    last[at + k] = from[o + k]!;
  }
  return !same;
}

/** The step draw `d` is drawn in. */
export function stepOf(p: FramePacket, d: number): number {
  const flags = p.drawFlags[d]!;
  if ((flags & DRAW_NEAR) !== 0) return STEP_BODY;
  return (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - p.drawPass[d]! : p.drawPass[d]!;
}

/**
 * Marks, once the draws are in their order, each draw of a run of indices that is the draw before it but for its run
 * (`drawJoined`), and each such caster that is the caster before it but for its run and its cascades (`casterJoined`):
 * the same level, instances, offset, flags and all a renderer sets for it. A renderer that can may send a draw so marked
 * in one call with those before it; drawn one by one they draw the same.
 */
export function markJoins(p: FramePacket): void {
  const same = (o: Float32Array, a: number, b: number): boolean => o[a * 3] === o[b * 3] && o[a * 3 + 1] === o[b * 3 + 1] && o[a * 3 + 2] === o[b * 3 + 2];
  for (let d = 0; d < p.drawCount; d++) {
    const e = d - 1, flags = p.drawFlags[d]!;
    const joined = d > 0 && (flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 && flags === p.drawFlags[e] && p.drawSlot[d] === p.drawSlot[e] && p.drawMesh[d] === p.drawMesh[e] && p.drawBuffer[d] === p.drawBuffer[e] && p.drawFirst[d] === p.drawFirst[e] && p.drawInstances[d] === p.drawInstances[e] && p.drawPass[d] === p.drawPass[e] && p.drawFade[d] === p.drawFade[e] && p.drawHand[d] === p.drawHand[e] && same(p.drawOffset, d, e) && p.drawSwap[d] === p.drawSwap[e];
    p.drawJoined[d] = joined && ((flags & DRAW_TEXTURED) === 0 || (p.drawMaterial[d] === p.drawMaterial[e] && p.drawLayer[d] === p.drawLayer[e] && p.drawWear[d] === p.drawWear[e])) ? 1 : 0;
  }
  // A caster's material is read only to cut it out.
  for (let c = 0; c < p.casterCount; c++) {
    const e = c - 1, flags = p.casterFlags[c]!;
    const joined = c > 0 && (flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 && flags === p.casterFlags[e] && p.casterSlot[c] === p.casterSlot[e] && p.casterMesh[c] === p.casterMesh[e] && p.casterBuffer[c] === p.casterBuffer[e] && p.casterFirst[c] === p.casterFirst[e] && p.casterInstances[c] === p.casterInstances[e] && same(p.casterOffset, c, e);
    p.casterJoined[c] = joined && ((flags & DRAW_CUTOUT) === 0 || p.casterMaterial[c] === p.casterMaterial[e]) ? 1 : 0;
  }
}
/** `tilePass` bits: 1 << PASS_NEAR for a tile drawn in the near range, 1 << PASS_FAR in the far, and TILE_CASTS << k casting into cascade k. */
export const TILE_CASTS = 4;
/** The pair of textures a tile reads its heights and tints from (`tileSource`): the whole map's, or the window's round the camera. */
export const SOURCE_MAP = 0;
export const SOURCE_WINDOW = 1;

/** Bodies the frame block holds for contact (contact.ts). */
export const MAX_CONTACTS = 12;
export const MAX_WATER_MARKS = 12;
export const MAX_TIRE_CONTACTS = 8;

/** The supply drops' streaks in the sky a frame holds, and the vec4 lanes of their section (`drops`). */
export const DROP_STREAKS = 4;
export const DROP_LANES = DROP_STREAKS * 2 + 3;
/** The vec4 lanes of the orb's section (`orb`): the scenes' eight, then the screen's eleven (orb.ts SCREEN_AT). */
export const ORB_LANES = 19;

/** A section of the frame block: its name, the first of FRAME_BLOCK's members it holds, and its floats, whole vec4s. */
export interface FrameSection {
  readonly name: string;
  readonly first: string;
  readonly floats: number;
}

/**
 * The frame block's sections, in the block's order, which is FRAME_BLOCK's. A section begins where the one before it
 * ends, so a feature adds a row here and its members to FRAME_BLOCK, and no other offset is written. `lanes` is the
 * part FRAME names lane by lane.
 */
export const FRAME_SECTIONS = [
  { name: "lanes", first: "fSun", floats: 164 },
  { name: "contact", first: "fContact", floats: MAX_CONTACTS * 8 },
  { name: "eyes", first: "fEyes", floats: 48 },
  { name: "reflection", first: "fReflection", floats: 4 },
  { name: "previousReflection", first: "fPreviousReflection", floats: 4 },
  { name: "streetLook", first: "fStreetLook", floats: 4 },
  { name: "tireContacts", first: "fTireContacts", floats: MAX_TIRE_CONTACTS * 4 },
  { name: "effects", first: "fEffects", floats: 4 },
  { name: "waterBounds", first: "fWaterBounds", floats: 4 },
  { name: "waterMarks", first: "fWaterMarks", floats: MAX_WATER_MARKS * 8 },
  { name: "waterPaths", first: "fWaterPaths", floats: MAX_WATER_MARKS * 4 },
  { name: "roof", first: "fRoof", floats: 4 },
  { name: "cast", first: "fCast", floats: 4 },
  { name: "lamp", first: "fLamp", floats: 28 },
  { name: "glass", first: "fGlass", floats: 4 },
  { name: "shore", first: "fShore", floats: 4 },
  { name: "drops", first: "fDrops", floats: DROP_LANES * 4 },
  { name: "optic", first: "fOptic", floats: 8 },
  { name: "made", first: "fMade", floats: MADE_READS.length * MADE_FLOATS },
  { name: "orb", first: "fOrb", floats: ORB_LANES * 4 },
] as const satisfies readonly FrameSection[];

/** Where each section of `rows` begins, in floats, by its name, and where the last ends, `end`. */
export function sectionStarts<const R extends readonly FrameSection[]>(rows: R): Readonly<Record<R[number]["name"] | "end", number>> {
  const at: Record<string, number> = {};
  let next = 0;
  for (const row of rows) {
    if (row.name in at || row.name === "end") throw new Error(`frame section ${row.name} is listed twice`);
    if (row.floats % 4 !== 0) throw new Error(`frame section ${row.name} is not whole vec4s`);
    at[row.name] = next;
    next += row.floats;
  }
  at.end = next;
  return at as Record<R[number]["name"] | "end", number>;
}

/** The sections' starts, read once here: every offset below is a number held in a const. */
const SECTION = sectionStarts(FRAME_SECTIONS);

/**
 * Where each value of the frame block (`FramePacket.frame`) is, in floats. The block is what every lit program reads,
 * one uniform block of vec4s that FRAME_BLOCK declares, each named after its slot there. Directions are in the world
 * and of length 1, colours are linear light, and lengths are metres.
 */
export const FRAME = {
  /**
   * fSun: the way the sun's light comes from, stepped every 0.05 degrees of its travel and held 2 degrees up through
   * twilight, when it carries the afterglow; and how strongly it casts, 0 to 1. Where the sun is, for its disc and for
   * the sky table, is fTrueSun (sky.ts `trueSun`), the moon's direction turned round.
   */
  sun: 0,
  casting: 3,
  /** fSunColor: the sun's light at the ground, and the exposure all light is multiplied by. */
  sunColor: 4,
  exposure: 7,
  /** fMoon and fMoonColor: the way to the moon and its light. */
  moon: 8,
  moonColor: 12,
  /** fSkyAbove and fSkyBelow: the sky's light on a surface facing up and on one facing down, the ground's sent back. */
  skyAbove: 16,
  /** fSkyScale, fSkyAbove's fourth: the light one unit of the sky table stands for (sky.ts). */
  skyScale: 19,
  skyBelow: 20,
  /**
   * fHaze: its density at sea level, per metre (0 for none), the height over which that thins by e, the camera's
   * height over the sea (over 0 with no sea, and never under 0 out of the water; under water, the sea's or a lake's,
   * its height under the surface over it), and 1 where the dome draws the sun, the moon, the stars and the clouds over
   * the table, 0 for the table alone, as the rasterizer draws it (atmosphere.ts).
   */
  haze: 24,
  hazeHeight: 25,
  eyeHeight: 26,
  skyDetail: 27,
  /** fView: where the end of the view begins to fade into the dome and where it is gone (none if not after), `split`, and the share of its reach a far draw fades over. */
  ends: 28,
  split: 30,
  fade: 31,
  /**
   * fClouds: where the camera is over each cloud layer's tile, wind and all, as a share of the tile, x and z: the low
   * layer's, then the high's. Core works them out in double precision, which a shader has not.
   */
  clouds: 32,
  /** fCloudSun: the sun's light as the low cloud layer sees it, from higher than the ground does. */
  cloudSun: 36,
  /** fWaves: where the camera is over each of the sea's two wave pictures, wind and all, as a share of a tile along its axes: the long waves', then the short (water.ts). */
  waves: 40,
  /** fGround: where the camera is in the samples of the terrain window drawn, from its corner (far outside while there is none), and in the whole map's pair's. */
  ground: 44,
  /**
   * fSea: in the heights' units over the lowest, the level fHaze's eye height is measured from, so that a surface's
   * height over the ground is known from its own (water.ts seaDepth); metres a unit, samples a metre in the window (a
   * COARSE-th of that in the whole map's pair), and how strong the waves are.
   */
  sea: 48,
  /** fSwell: where the camera is over the swell's tile (water.ts SWELL), wind and all, as a share of it along its axes. */
  swell: 52,
  /** fSpheres: each cascade's sphere round its slice of the view, its camera-relative centre and radius. A pixel takes the finest that holds it. */
  spheres: 56,
  /** fCascades: each cascade's matrix, from camera-relative space to its clip space, as `viewProj` is for the view. */
  cascades: 72,
  /**
   * fSkySide, fSkySun and fSkyAlong: the sky's light on a face turned sideways beyond what fSkyAbove and fSkyBelow mixed
   * give it, and on a face turned round from the sun's side, as the cosine of that way round and as its square
   * (surface.ts `skyLight`).
   */
  skySide: 136,
  skySun: 140,
  skyAlong: 144,
  /** fHandFrom and fHandTo, in the fourth lanes of fSkySide and fSkySun: the tier's band over which near nodes hand over to far ones (hand.ts). */
  handFrom: 139,
  handTo: 143,
  /** fLook: what every lookup of the sky table shares this frame (sky.ts SKY_GLSL): fTrueSun's way on the ground, x and z of length 1, and its slice of the table as a texture coordinate. */
  look: 148,
  /**
   * fFarAt, fFarScale and fFarDepth, in lanes the rest leave free (fSwell.zw, fLook.w, fSkyAlong.w): where the camera
   * is on the far shadow's map (farshadow.ts) in its texels, x and z; its texels a metre, negative while its map is not
   * to be looked up, when the grid is still the sky's openness's (skyopen.ts), and 0 on a frame with neither; and the
   * camera's depth in it.
   */
  farAt: 54,
  farScale: 151,
  farDepth: 147,
  /**
   * fNearFrom and fNearTo, in the fourth lanes of fMoon, fMoonColor, fSkyBelow and fCloudSun: the box the chunks the
   * near store holds whole lie in, camera-relative x and z, from its least corner to its most. Their pieces cast into
   * the cascades, so within them the far map is looked up past it. A box far off for none.
   */
  nearFromX: 11,
  nearFromZ: 15,
  nearToX: 23,
  nearToZ: 39,
  /** fFacade: the height in the world of the city's flood line (facade.ts FACADE_FLOOD), and 1 where every facade atlas the tier reads has come. */
  facade: 152,
  /** fFacade's third lane: 1 on a frame drawn without the walls' worn edges (`?off=edges`, world-surfaces.ts `edged`), 2 more without their weathering (`?off=weather`, `weathered`). */
  edgesOff: 154,
  /** Its fourth: 1 more on a frame drawn without the ground's wear on asphalt and sand (`?off=road`, world-surfaces.ts `roadWorn`), 2 more without a walk's (`?off=walks`, `walkWorn`), and 4 more without a bent kerb's (`?off=kerbs`, bend.ts `bentWear`). */
  roadOff: 155,
  /**
   * fGrade and fFinish, the frame's finish (post.ts): what light is multiplied by before the tone curve, red, green and
   * blue, and the saturation after it; then the power the toned light is raised to, bloom's share, the sharpen's
   * strength, and bloom's levels. A frame with a gamma of 0, as an unlit one, is not graded, and one with no light
   * target has no bloom or sharpen.
   */
  grade: 156,
  saturation: 159,
  gamma: 160,
  bloom: 161,
  sharpen: 162,
  levels: 163,
  /** fContact: the bodies whose contact takes the sky's light down, two slots each (contact.ts). */
  contact: SECTION.contact,
  /** Three camera-relative sky lenses follow the contact bodies, four vectors each (tide-eye.ts EYE_FLOATS): where the figure's centre is and its phase and kind; its tint and power; its clock, bloom, seed and storm; its beam's foot, its heading and how lit it is. */
  eyes: SECTION.eyes,
  reflection: SECTION.reflection,
  previousReflection: SECTION.previousReflection,
  /** Finish gloss offset, current capture layer, dry asphalt share, shadow fill reduction. */
  streetLook: SECTION.streetLook,
  /** For each supported wheel, the ground normal X/Z, its camera-relative plane offset, and the global bone index plus one. */
  tireContacts: SECTION.tireContacts,
  /** fEffects.x: periodic exhaust phase in radians. */
  exhaustPhase: SECTION.effects,
} as const;
export const WATER_PHASE = SECTION.effects + 1;
export const WATER_MARK_COUNT = SECTION.effects + 3;
export const WATER_BOUNDS = SECTION.waterBounds;
export const WATER_MARKS = SECTION.waterMarks;
/** Per segment: duration, incoming and outgoing cross-track slopes, and wake family. */
export const WATER_PATHS = SECTION.waterPaths;
/**
 * fRoof: the map of what stands overhead round the camera (roof.ts), its corner camera-relative, x and z, its side in
 * metres, and 1 while it is on the card, else 0.
 */
export const ROOF_AT = SECTION.roof;
/**
 * fCast: the unit vector toward the light the shadow cascades are cast from this frame, and how strongly it casts, 0 to
 * 1 (sky.ts `castLight`): the true sun by day, when its strength is fSun.w, and the moon by night. One light owns the
 * cascades at a time, and whichever owns them takes their shade (surface.ts `keyShade`).
 */
export const CAST_AT = SECTION.cast;
/**
 * fLamp, fLampColor, fLampShadow and fLampWay: the street lamp that lights as a light this frame (lamp.ts), its lens
 * camera-relative and the range of its light (0 for no lamp), its light a metre off and the layer of the shadow array
 * its map is in (-1 for none), the matrix from camera-relative space to its map's clip space, and the way its head
 * faces out over the road along the ground, x and z.
 */
export const LAMP_AT = SECTION.lamp;
/**
 * fGlass: 1 where the frame's opaque pass has samples for a vehicle's glass to cover a share of (vehicle-glass.ts), 0
 * where it is drawn without, as a supersampled light target is.
 * fShore: 1 where the frame has a sea and the camera is out of the water, so the lit ground knows its height over the
 * sea from its own and is wet just over it (bank.ts shoreWet), else 0. Its other lanes are free.
 */
export const GLASS_AT = SECTION.glass;
export const SHORE_AT = SECTION.shore;
/**
 * fDrops: the supply drops' casts in the sky (supply-sky.ts). Two lanes a streak, four streaks: the unit way to its
 * head from the eye and its strength, then the unit way to where its tail ends and its tier's colour as 0xRRGGBB. Then
 * a lane for each obelisk's place in fEyes: the way its cast's bolt runs from the knot along the ground (x and z, a
 * unit), how strongly it flashes, 0 to 1, and which strike it is.
 */
export const DROPS_AT = SECTION.drops;
/**
 * fOptic and fPhosphor, what a visor does to the picture (D1080): fOptic's mode (OPTIC_NONE, OPTIC_NIGHT), the grain the
 * finish adds where it draws (0 for none), a seed that moves it each frame, and a drone's feed (OPTIC_FEED_AT); fPhosphor
 * the colour night vision shows its grey in, and the feed's burst of interference. All zero for none.
 */
export const OPTIC_AT = SECTION.optic;
/** fOptic.w: 0 with no drone feed, else 1 plus its signal, 0 to 1 (air-feed.ts). fPhosphor.a: its burst, 0 to 1. */
export const OPTIC_FEED_AT = SECTION.optic + 3;
export const OPTIC_BURST_AT = SECTION.optic + 7;
/**
 * fMade: for each material made from a recipe (content/texgen/materials.ts), two lanes: its slot's first layer of the
 * made array (-1 for none) and how far it has come up, 0 to 1; then where the eye is in its tiles (texgen/slots.ts).
 */
export const MADE_AT = SECTION.made;
/**
 * fOrb: the screen of the orb nearest the eye (orb.ts writeOrb). One orb is enough: a map has one, and with more only
 * the nearest shows a picture. Its centre from the eye and its radius (0 for none); its heading's cosine and sine, the
 * scene's clock and the clock of the scene before; the scene, the one before, how far the change has crossed and the
 * screen's level; where it looks and the blue eye's power; the way to the sun and how full the tide is; where a change
 * starts and how hard lightning strikes; which strike it is, and the colour of the light it casts by night
 * (orb-light.ts); what a mirror shows of it (ORB_SEEN); then the screen's picture, where it stands and its edges'
 * colours (orb.ts SCREEN_AT). Directions but the centre are in the orb's own frame.
 */
export const ORB_AT = SECTION.orb;
export const OPTIC_NONE = 0;
export const OPTIC_NIGHT = 1;
export const OPTIC_HEAT = 2;
/** A drone's camera feed (air-feed.ts): its own view, a cool grade over plain light; night and heat go inside it. */
export const OPTIC_FEED = 3;
export const FRAME_FLOATS = SECTION.end;
/** The frame block as GLSL declares it, for any program that reads it. */
export const FRAME_BLOCK = `layout(std140) uniform Frame {
  highp vec4 fSun, fSunColor, fMoon, fMoonColor, fSkyAbove, fSkyBelow, fHaze, fView, fClouds, fCloudSun, fWaves, fGround, fSea, fSwell;
  highp vec4 fSpheres[${MAX_CASCADES}];
  highp mat4 fCascades[${MAX_CASCADES}];
  highp vec4 fSkySide, fSkySun, fSkyAlong, fLook, fFacade, fGrade, fFinish;
  highp vec4 fContact[${MAX_CONTACTS * 2}];
  highp vec4 fEyes[12];
  highp vec4 fReflection, fPreviousReflection, fStreetLook;
  highp vec4 fTireContacts[${MAX_TIRE_CONTACTS}];
  highp vec4 fEffects, fWaterBounds, fWaterMarks[${MAX_WATER_MARKS * 2}], fWaterPaths[${MAX_WATER_MARKS}];
  highp vec4 fRoof, fCast, fLamp, fLampColor;
  highp mat4 fLampShadow;
  highp vec4 fLampWay, fGlass;
  highp vec4 fShore;
  highp vec4 fDrops[${4 * 2 + 3}];
  highp vec4 fOptic, fPhosphor;
  highp vec4 fMade[${(MADE_READS.length * MADE_FLOATS) / 4}];
  highp vec4 fOrb[${ORB_LANES}];
};
#define fSkyScale fSkyAbove.w
#define fTrueSun (-fMoon.xyz)
#define fHandFrom fSkySide.w
#define fHandTo fSkySun.w
`;

export interface BufferUpload {
  /** Chunk index the instances belong to. */
  buffer: number;
  /** INSTANCE_BYTES per instance. The scene owns it, so copy or upload it before the next build. */
  data: Uint8Array;
  /** Structure slot of each instance, for picking. */
  slots: Uint16Array;
  /**
   * Given where only some of a buffer the card holds has changed: the first byte and how many. `data` is still the
   * whole buffer, so a renderer that will not write part of one sends it all.
   */
  from?: number;
  bytes?: number;
}

/**
 * Rows of one picture of a texture to put on the graphics card. A texture grows by being made again one step larger:
 * its pictures arrive smallest first, a few rows a frame, and the one marked `last` completes it, after which it is
 * what its slot draws with.
 */
export interface TextureUpload {
  /** The texture's slot, as `texDrops` and the materials' draws name it. */
  slot: number;
  role: TextureRole;
  format: TextureFormat;
  /** Pixels a block holds on a side in bc and astc: 4 in bc, and in astc the texture's own (shared/pack/texture.ts). */
  block?: number;
  /** The side of the texture being made, and of the picture these rows belong to. */
  top: number;
  size: number;
  /** The first row of pixels and how many, whole rows of blocks, the last of them cut at the picture's edge. */
  row: number;
  rows: number;
  /** The scene owns it, so upload it before the next build. */
  data: Uint8Array;
  last: boolean;
}

const NO_ROWS = new Uint16Array(0);
const NO_OPEN = new Uint8Array(0);

export class FramePacket {
  previousStreet: import("./street-finish.ts").StreetImage | null = null;
  street: import("./street-finish.ts").StreetImage | null = null;
  readonly viewProj = new Float32Array(16);
  readonly nearViewProj = new Float32Array(16);
  camX = 0;
  camY = 0;
  camZ = 0;
  /** World-surface city dials: tint/scale, weather/wetness/growth/desert. */
  readonly surfaceCity = Float32Array.from([1, 1, 1, 1, 1, 0, 0.08, 0, 1, 0, 0, 0]);
  /**
   * The world finishes' maps (world-surfaces.ts `WorldFinishes`), by role, base colour, normal and packed: the side of
   * the array the card keeps each in, a layer a finish, 0 for none; the finest level of it any layer holds, which the
   * card reads from, -1 until every layer holds one; and where the eye is in each finish's tiles, less whole tiles.
   */
  readonly worldSide = new Int32Array(3);
  readonly worldLevel = new Int32Array(3).fill(-1);
  /**
   * Per layer of the arrays (WORLD_LAYERS), for base colour, normal and packed map in turn: how many levels over
   * `worldLevel` the finest of it the card may read lies, which it holds; fractional while the layer eases down to a finer.
   */
  readonly worldLeast = new Float32Array(WORLD_LAYERS * 3);
  /** 1 while the finishes are drawn from their base colours alone, falling to 0 as their every map comes in (world-surfaces.ts WorldFinishes). */
  worldEarly = 1;
  /** Whether the finishes' base colours can come, which they are drawn as their means until they do; false where nothing can bring them. */
  worldComing = false;
  readonly worldPhase = new Float32Array(SURFACE_NAMES.length * 3);
  /** The side of the layers of the textures the card makes and keeps (texgen/layers.ts texgenSide), 0 where the tier makes none. */
  texgenSide = 0;
  /** The version wanted of each of their layers (texgen/slots.ts MadeSlots `want`; none until it has come), and what the card holds of each, which the shell says from the engine. */
  texgenWant: Int32Array | null = null;
  texgenHolds: Int32Array | null = null;
  /** The textures the facades read, by their index in the manifest, -1 for none: the elements' base colour, normal and packed map, the rooms', the marks' (facade.ts FacadeAtlases). */
  readonly facadeSlots = new Int32Array(5).fill(-1);
  /** Linear 0..1 RGB. */
  readonly sky = new Float32Array(3);
  /** The sky's colour as a frame drawn with no light target shows its fog (surface.ts skyShown): graded where the frame is. */
  readonly skyShown = new Float32Array(3);
  /** Unit vector toward the sun. */
  readonly sun = new Float32Array(3);
  /** Daylight brightness, 0..1. Every lit colour is multiplied by it. */
  light = 1;
  fogStart = 0;
  fogEnd = 1;
  /** The tier the frame is built for. A renderer draws it with that tier's programs (programs.ts). */
  tier: Tier = tierOf(DEFAULT_TIER);
  /** Drawn with the lit programs, which read `frame`, or as low poly draws. */
  lit = false;
  /** The view-projection of the far depth range, from 98% of `split` to the end of the view. */
  readonly farViewProj = new Float32Array(16);
  /** The frame block. FRAME says where each value is. */
  readonly frame = new Float32Array(FRAME_FLOATS);
  /** Sun shadow cascades this frame: the tier's, or 0 while the sun casts nothing. */
  cascadeCount = 0;
  /** Their spheres and matrices, which are in `frame`. */
  readonly spheres = this.frame.subarray(FRAME.spheres, FRAME.spheres + MAX_CASCADES * 4);
  readonly cascades = this.frame.subarray(FRAME.cascades, FRAME.cascades + MAX_CASCADES * 16);
  /**
   * Which cascades' maps are drawn this frame, a bit each, and the street lamp's (lamp.ts LAMP_BIT). Any other keeps the
   * map it has, and its matrix stays the one that map was drawn with, moved with the camera.
   */
  cascadesDrawn = 0;
  /** The matrices the maps are drawn with, 16 floats each by their bits in `cascadesDrawn`: each cascade's, then the lamp's. */
  readonly maps = new Float32Array((MAX_CASCADES + 1) * 16);
  /**
   * Rows of the far shadow's map (farshadow.ts) to put in the shadow array's layer after the cascades' before they are
   * drawn: `farRows` of its layer's side from row `farRow`, none while it is empty. The scene owns the map.
   */
  farMap: Uint16Array = NO_ROWS;
  farRow = 0;
  farRows = 0;
  /**
   * The sky's openness over the far map's grid (skyopen.ts), on its own unit: its cells across and down, none while
   * there is none for the grid the frame looks up on, in which case a renderer lets its texture go; and `openRows` of
   * its rows from `openRow` to put on it, four bytes a cell. The scene owns the rows.
   */
  openWidth = 0;
  openHeight = 0;
  openMap: Uint8Array = NO_OPEN;
  openRow = 0;
  openRows = 0;
  /**
   * What stands overhead round the camera (roof.ts), on its own unit: its cells a side while one is on the card, 0 for
   * none, and the whole map to put on it the frame it is made, else empty. The scene owns the map.
   */
  roofSide = 0;
  roofMap: Uint8Array = NO_OPEN;
  /**
   * The picture an orb's screen shows (video/player.ts), which the shell puts on UNIT.screen: a video or an image the
   * shell knows how to upload, its size, whether it has a new frame this frame, and whether its mip levels are made after.
   */
  screenSource: unknown = null;
  screenWidth = 0;
  screenHeight = 0;
  screenFresh = false;
  screenMips = false;
  /** The draw before which the dome goes, on a lit frame. */
  skyAt = 0;
  /** The samples the light target is drawn with (post.ts lightSamples), on a frame drawn into one. */
  lightSamples = 0;
  /**
   * On a frame drawn into the light target, the share of the canvas a side the target is made for (post.ts sceneShare),
   * and the share its scene is drawn at, the governor's steps taken: no more, so that a step makes nothing again.
   */
  room = 1;
  share = 1;
  /**
   * A sight's window (Camera.window), as shares of the scene drawn (x0, y0, x1, y1, y up), outside which the shell's
   * scissor shades nothing; all zero for the whole view (D1077).
   */
  readonly window = new Float32Array(4);
  /**
   * Whether the frame is drawn with the page's other effects off (`?ab=`, passes.ts), every other frame for a before
   * and after: the shell keeps what the frames between need, and the card's reservations stand as they set them.
   */
  alternate = false;
  /**
   * Per opaque step, near then far: its terrain tiles are drawn before the first of its draws numbered this or more, or
   * after its last where it has none such. 0, before its first, where nothing says otherwise.
   */
  readonly groundAt = new Int32Array(STEP_FAR + 1);

  readonly uploads: BufferUpload[] = [];
  readonly drops: number[] = [];
  /** The bases the pieces of a buffer stand in, by the buffer: what a DRAW_PIECE draw of it gives `uFrames`. Kept by who fills the buffer. */
  readonly frameTables = new Map<number, FrameTable>();
  /** Levels of meshes to put on the graphics card, and slots to take off it, before this frame's draws. */
  readonly assetUploads: AssetUpload[] = [];
  readonly assetDrops: number[] = [];
  /** The same for textures. */
  readonly texUploads: TextureUpload[] = [];
  readonly texDrops: number[] = [];
  /** Draws left out because no level of their mesh was to be had. */
  skipped = 0;
  /** Things left out because the frame was full: draws, terrain and water tiles, beams, bodies and loose things. */
  dropped = 0;

  drawCount = 0;
  /** Pack mesh index. */
  readonly drawMesh = new Uint16Array(MAX_DRAWS);
  /** The level of detail to draw. It is one the mesh has and the graphics card holds. */
  readonly drawLod = new Uint8Array(MAX_DRAWS);
  /** The slot of that level, as `assetUploads` and `assetDrops` name it. */
  readonly drawSlot = new Uint32Array(MAX_DRAWS);
  readonly drawBuffer = new Uint32Array(MAX_DRAWS);
  readonly drawFirst = new Uint32Array(MAX_DRAWS);
  readonly drawInstances = new Uint32Array(MAX_DRAWS);
  /** Camera-relative origin of the buffer's coordinates: x, y, z per draw. */
  readonly drawOffset = new Float32Array(MAX_DRAWS * 3);
  /** DRAW_ bits. Draws with DRAW_BLEND come last. */
  readonly drawFlags = new Uint32Array(MAX_DRAWS);
  /** Optical finish and wheel data for textured draws. Flat draws use their declared fixture, or -1 for a packed vertex label. */
  readonly drawStreetMaterial = new Float32Array(MAX_DRAWS);
  readonly drawWheelBones = new Uint32Array(MAX_DRAWS);
  /** 1 for a wheel's crowned spokes, plus twice its material's glass set, and OPTICS_CUT where cut out for it alone (vehicle-glass.ts). */
  readonly drawOptics = new Uint8Array(MAX_DRAWS);
  readonly drawFixture = new Int8Array(MAX_DRAWS);
  /** For a DRAW_TEXTURED draw: the manifest's material, and the run of indices it covers. */
  readonly drawMaterial = new Uint16Array(MAX_DRAWS);
  readonly drawFirstIndex = new Uint32Array(MAX_DRAWS);
  readonly drawIndexCount = new Uint32Array(MAX_DRAWS);
  /** The depth range each draw is in, PASS_NEAR or PASS_FAR. A draw across `split` is listed in each. */
  readonly drawPass = new Uint8Array(MAX_DRAWS);
  /** Where a draw that fades out with distance is gone, in metres, having faded over the tier's `fade` share of that. 0 for any other. */
  readonly drawFade = new Float32Array(MAX_DRAWS);
  /** How a draw of nodes takes part in their hand-over from the near store to the far one: hand.ts HAND_NEAR, HAND_FAR, or 0. */
  readonly drawHand = new Int8Array(MAX_DRAWS);
  /** How far a draw of a cell of trees that is changing level has come (hand.ts `swapKeeps`): t for the new level, -t for the old, 0 for any other. */
  readonly drawSwap = new Float32Array(MAX_DRAWS);
  /**
   * Four numbers a draw for a light that is worked out and not painted (supply-light.ts): a supply drop's seconds since
   * it landed, its tier's colour as 0xRRGGBB, its power, and its count, ringed bit, standing bit and look, packed. All
   * 0 for any other draw, which is how a program knows it is no drop's.
   */
  readonly drawEffect = new Float32Array(MAX_DRAWS * 4);
  /**
   * Two numbers a flat draw: a palette colour plus 1 that every vertex takes in place of its own, 0 for none; and the
   * share of a see-through draw's alpha it has lost, 0 for none. A piece about to be built, fine or refused (passes/ghost.ts).
   */
  readonly drawTint = new Float32Array(MAX_DRAWS * 2);
  /**
   * For a DRAW_TEXTURED draw of bodies that are hurt or dead, whose material has a layer on the card: the level its layer
   * is drawn at, in LAYER_LEVELS of the whole (surface.ts `wounded`). 0 for any other, which reads no layer.
   */
  readonly drawLayer = new Uint8Array(MAX_DRAWS);
  /** With a layer: the wear story its bodies take (wear.ts), 0 for none. */
  readonly drawWear = new Uint8Array(MAX_DRAWS);
  /** 1 where a draw is the one before it but for its run of indices (markJoins), else 0. */
  readonly drawJoined = new Uint8Array(MAX_DRAWS);

  tileCount = 0;
  /** Per tile: camera-relative x and z of its corner, metres per quad, sample stride. */
  readonly tiles = new Float32Array(MAX_TILES * 4);
  /** Per tile: heightfield sample (i, j) of its corner. */
  readonly tileOrigin = new Int32Array(MAX_TILES * 2);
  /** Per tile: the ranges it is drawn in and the cascades it casts into, a bit each (TILE_CASTS). One only shadows need is in no range. */
  readonly tilePass = new Uint8Array(MAX_TILES);
  /** Per tile: the sample (i, j) of its corner and its stride, in the samples of the pair it reads, and that pair, SOURCE_MAP or SOURCE_WINDOW. */
  readonly tileSource = new Int32Array(MAX_TILES * 4);
  /**
   * The terrain window (terrain.ts): the copy of it SOURCE_WINDOW tiles read, 0 or 1 or -1 for none, and the map sample
   * of its corner; then the copy rows go into this frame, or -1, the corner it is filled round, and the first of those
   * rows and how many. A renderer copies them from the heightfield before it draws.
   */
  readonly groundWindow = Int32Array.of(-1, 0, 0, -1, 0, 0, 0, 0);
  /**
   * Chunk tiles of the streets' pictures round the camera to put on the card before this frame's draws (streets.ts
   * StreetRegion): `streetTiles` of them, each its corner in the pictures' texels (x, y) in `streetAt`, and its bytes of
   * the distances' picture and of the kinds' one after another in `streetDist` and `streetKinds`. The card keeps them.
   */
  streetTiles = 0;
  readonly streetAt = new Int32Array(STREET_TILES_FRAME * 2);
  readonly streetDist = new Uint8Array(STREET_TILES_FRAME * STREET_TILE_BYTES);
  readonly streetKinds = new Uint8Array(STREET_TILES_FRAME * STREET_TILE_BYTES);

  transientCount = 0;
  readonly transient = new Uint8Array((MAX_VIEW + MAX_WATER_TILES + 17 + MAX_PREDICTED + MAX_HOLOGRAMS + MAX_FALLING + MAX_SKINNED) * INSTANCE_BYTES);
  /** Entity slot index of each transient instance, for picking. */
  readonly transientIds = new Uint32Array(MAX_VIEW + MAX_WATER_TILES + 17 + MAX_PREDICTED + MAX_HOLOGRAMS + MAX_FALLING + MAX_SKINNED);

  /** Bones of every body drawn this frame, BONE_FLOATS each. */
  boneCount = 0;
  readonly bones = new Float32Array(MAX_BONES * BONE_FLOATS);

  /**
   * Sun shadow casters, apart from the draws. Each is a mesh at a level in a buffer, as a draw is, with DRAW_ flags and
   * the cascades it is drawn into, a bit each. Of the flags, DRAW_SKINNED, DRAW_ONE_BONE and DRAW_SIZED place its
   * vertices as they place a draw's. A level with a cut-out or two-sided section is a caster for each section,
   * DRAW_TEXTURED with its material and run of indices as a draw has them, DRAW_TWO_SIDED as its material is, and
   * DRAW_CUTOUT once the card holds the level's surface and the material's base colour, whose alpha cuts it; any other
   * caster is its whole level. The card holds every level a caster names.
   */
  casterCount = 0;
  /** Casters left out because the list was full. */
  casterDropped = 0;
  readonly casterMesh = new Uint16Array(MAX_CASTERS);
  readonly casterLod = new Uint8Array(MAX_CASTERS);
  readonly casterSlot = new Uint32Array(MAX_CASTERS);
  readonly casterBuffer = new Uint32Array(MAX_CASTERS);
  readonly casterFirst = new Uint32Array(MAX_CASTERS);
  readonly casterInstances = new Uint32Array(MAX_CASTERS);
  readonly casterOffset = new Float32Array(MAX_CASTERS * 3);
  readonly casterFlags = new Uint32Array(MAX_CASTERS);
  readonly casterMaterial = new Uint16Array(MAX_CASTERS);
  readonly casterFirstIndex = new Uint32Array(MAX_CASTERS);
  readonly casterIndexCount = new Uint32Array(MAX_CASTERS);
  readonly casterCascades = new Uint8Array(MAX_CASTERS);
  /** 1 where a caster is the one before it but for its run of indices and its cascades (markJoins), else 0. */
  readonly casterJoined = new Uint8Array(MAX_CASTERS);
  /** What the sun's maps take this frame, the ground's tiles among it, and which `triangles` leaves out: a caster's triangles once for each cascade it is drawn into, and its draws. */
  castTriangles = 0;
  castDraws = 0;

  triangles = 0;

  /** Small details this frame, DETAIL_FLOATS each, as DETAIL lays them out; the words are the same memory. */
  detailCount = 0;
  readonly details = new Float32Array(MAX_DETAILS * DETAIL_FLOATS);
  readonly detailWords = new Uint32Array(this.details.buffer);
  /** The share of the screen the blended details cover, counted once a quad. */
  detailFill = 0;
  /**
   * What a page leaves out to price what burns (passes.ts "bursts"): the particles the details wrote themselves, the
   * first `detailOwn`, each tagged 1 where a blast threw it up; and the run of cards that is the rockets' smoke and glows.
   */
  detailOwn = 0;
  readonly detailTag = new Uint8Array(MAX_DETAILS);
  burstFirst = 0;
  burstCount = 0;

  /**
   * The states of the near chunks' pieces (pieces.ts), PIECE_KEYS texels a row and four bytes a texel, which the card
   * keeps: `pieceUploads` runs of texels to put on it before this frame's draws, each a row, its first texel and how many.
   */
  readonly pieces = new Uint8Array(PIECE_KEYS * PIECE_ROWS * 4);
  pieceUploads = 0;
  readonly pieceRuns = new Int32Array(PIECE_ROWS * 2 * 3);
  /** The row of each chunk whose mesh is drawn by its pieces' states, by its number, which is its draws' buffer. */
  readonly pieceRowOf = new Map<number, number>();
  /** Per row, the nine rows a mesh of its chunk is drawn with: those of the chunks round it, a row of three then the next, its own the fifth. */
  readonly pieceRows = new Float32Array(PIECE_ROWS * 9);
  readonly pieceRowsOf: readonly Float32Array[] = Array.from({ length: PIECE_ROWS }, (_, r) => this.pieceRows.subarray(r * 9, r * 9 + 9));
  /** Per row, a count of the changes to its nine. */
  readonly pieceStamp = new Uint32Array(PIECE_ROWS);

  /** Rows of `atlas` to put on the card before this frame's draws, from the first; 0 for none. The card keeps them. */
  atlasRows = 0;
  readonly atlas = new Float32Array(ATLAS_WIDTH * ATLAS_ROWS * 4);

  /** Metres from the camera at which the far depth range begins, 0 for one range. It is kept in `frame`. */
  get split(): number {
    return this.frame[FRAME.split]!;
  }

  set split(metres: number) {
    this.frame[FRAME.split] = metres;
  }

  beginFrame(): void {
    this.street = this.previousStreet = null;
    this.frame.fill(0, FRAME.tireContacts, FRAME.exhaustPhase);
    this.frame[WATER_MARK_COUNT] = 0;
    this.frame[FRAME.previousReflection + 3] = 0;
    this.frame[FRAME.reflection + 3] = 0;
    this.uploads.length = 0;
    this.drops.length = 0;
    this.assetUploads.length = 0;
    this.assetDrops.length = 0;
    this.texUploads.length = 0;
    this.texDrops.length = 0;
    this.skipped = 0;
    this.dropped = 0;
    // Draws that leave these alone take 0. Every row is cleared, not the last count's: a picture tool cuts the count of a
    // frame it does not keep, and a row past it kept a far draw's fade for a near draw to take in the next frame.
    this.drawFade.fill(0);
    this.drawHand.fill(0);
    this.drawSwap.fill(0);
    this.drawEffect.fill(0);
    this.drawTint.fill(0);
    this.drawLayer.fill(0);
    this.drawWear.fill(0);
    this.drawCount = 0;
    this.groundAt.fill(0);
    this.atlasRows = 0;
    this.pieceUploads = 0;
    this.tileCount = 0;
    this.groundWindow[3] = -1;
    this.streetTiles = 0;
    this.transientCount = 0;
    this.boneCount = 0;
    this.casterCount = 0;
    this.casterDropped = 0;
    this.castTriangles = 0;
    this.castDraws = 0;
    this.cascadeCount = 0;
    this.cascadesDrawn = 0;
    this.farMap = NO_ROWS;
    this.farRows = 0;
    this.openMap = NO_OPEN;
    this.openRows = this.openWidth = this.openHeight = 0;
    this.roofMap = NO_OPEN;
    this.roofSide = 0;
    this.screenSource = null;
    this.screenFresh = this.screenMips = false;
    this.triangles = 0;
    this.detailCount = 0;
    this.detailFill = 0;
    this.detailOwn = this.burstCount = 0;
  }
}

/** Typed views over instance bytes: float position, u16 yaw, six region colours. */
export class InstanceWriter {
  readonly bytes: Uint8Array;
  private readonly f32: Float32Array;
  private readonly u16: Uint16Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
    this.u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  }

  set(i: number, x: number, y: number, z: number, yaw: number, region0: number): void {
    this.f32[i * 5] = x;
    this.f32[i * 5 + 1] = y;
    this.f32[i * 5 + 2] = z;
    this.u16[i * 10 + 6] = yaw;
    const at = i * INSTANCE_BYTES + 14;
    this.bytes[at] = region0;
    this.bytes.fill(0, at + 1, at + 6);
  }

  /** The first bone goes where a rigid instance has its yaw. `x, y, z` is the offset DRAW_SKINNED describes. */
  setSkinned(i: number, firstBone: number, region0: number, x = 0, y = 0, z = 0): void {
    this.set(i, x, y, z, firstBone, region0);
  }

  /** For a DRAW_SIZED draw, in SIZE_UNITS. */
  size(i: number, units: number): void {
    this.bytes[i * INSTANCE_BYTES + 14 + SIZE_REGION] = units;
  }

  /** A zero leaves that region as `set` wrote it. */
  regions(i: number, colors: Uint8Array, from: number): void {
    const at = i * INSTANCE_BYTES + 14;
    for (let q = 0; q < 6; q++) if (colors[from + q] !== 0) this.bytes[at + q] = colors[from + q]!;
  }
}
