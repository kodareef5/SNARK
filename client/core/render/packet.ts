// Everything a renderer needs to draw one frame, as data. client/core decides what is visible, and a renderer only executes.
// Uploads and drops persist across frames and must be applied in order. Draws and terrain tiles describe this frame only.

import { MAX_VIEW } from "../../../shared/net/view.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import type { TextureFormat, TextureRole } from "../../../shared/pack/texture.ts";
import type { AssetUpload } from "../assets/residency.ts";
import { DEFAULT_TIER, tierOf, type Tier } from "../assets/tiers.ts";

export const MAX_DRAWS = 4096;
export const MAX_TILES = 1024;
/** Quads per terrain tile side, at every level. */
export const TILE_QUADS = 32;
/** Buffer id for the per-frame instance data carried in the packet itself. */
export const TRANSIENT_BUFFER = 0xffffffff;
/** Instances a frame may carry besides entities: water surface tiles, sixteen marker beams, and a piece about to be built. */
export const MAX_WATER_TILES = 256;
/** Structures a frame may show falling. The nearest to the camera are shown. */
export const MAX_FALLING = 1024;
/**
 * DRAW_ flags, a bit each of `drawFlags`, which holds 16. Bits 1 to 256 are taken; the next flag takes 512, then 1024, up to
 * 32768. A blended draw is see-through. It comes after everything opaque, shows both faces and writes no depth.
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
/** A body the frame had no bones left to pose: every vertex follows the instance's first bone, so it is drawn rigid in its rest pose. */
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
/**
 * A rigid draw whose instances carry their size in colour region SIZE_REGION, in SIZE_UNITS (shared/world/nodes.ts) of the
 * size the mesh was made: a resource node. Each is drawn that size about its origin, and the region gives no colour.
 */
export const DRAW_SIZED = 256;
export const SIZE_REGION = 5;

/** Floats per bone: three rows of a 3 x 4 matrix, each row x, y, z, translation. */
export const BONE_FLOATS = 12;
/** Bones per row of the bone texture. A texel is four floats, so a bone is three texels. */
export const BONES_PER_ROW = 256;
export const BONE_ROWS = 256;
/** 65,536, which is as many as an instance's sixteen bits can name the first of. A graphics tier poses fewer (assets/tiers.ts). */
export const MAX_BONES = BONES_PER_ROW * BONE_ROWS;
/** Bones the bodies leave for loose things: arrows where they landed and shots in the air. */
export const LOOSE_BONES = 256;
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
 * numbered as their ranges are.
 */
export const STEP_NEAR = PASS_NEAR;
export const STEP_FAR = PASS_FAR;
export const STEP_FAR_SEE = 2;
export const STEP_NEAR_SEE = 3;
export const STEP_BODY = 4;

/** The step draw `d` is drawn in. */
export function stepOf(p: FramePacket, d: number): number {
  const flags = p.drawFlags[d]!;
  if ((flags & DRAW_NEAR) !== 0) return STEP_BODY;
  return (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - p.drawPass[d]! : p.drawPass[d]!;
}
/** `tilePass` bits: 1 << PASS_NEAR for a tile drawn in the near range, 1 << PASS_FAR in the far, and TILE_CASTS << k casting into cascade k. */
export const TILE_CASTS = 4;
/** The pair of textures a tile reads its heights and tints from (`tileSource`): the whole map's, or the window's round the camera. */
export const SOURCE_MAP = 0;
export const SOURCE_WINDOW = 1;

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
  /** fSkyAbove and fSkyBelow: the sky's light on a surface facing up and on one facing down. */
  skyAbove: 16,
  /** fSkyScale, fSkyAbove's fourth: the light one unit of the sky table stands for (sky.ts). */
  skyScale: 19,
  skyBelow: 20,
  /**
   * fHaze: its density at sea level, per metre (0 for none), the height over which that thins by e, the camera's
   * height over the sea, and 1 where the dome draws the sun, the moon, the stars and the clouds over the table, 0 for
   * the table alone, as the rasterizer draws it (atmosphere.ts).
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
  /** fSpheres: each cascade's sphere round its slice of the view, its camera-relative centre and radius. A pixel takes the finest that holds it. */
  spheres: 40,
  /** fCascades: each cascade's matrix, from camera-relative space to its clip space, as `viewProj` is for the view. */
  cascades: 56,
} as const;
export const FRAME_FLOATS = FRAME.cascades + MAX_CASCADES * 16;
/** The frame block as GLSL declares it, for any program that reads it. */
export const FRAME_BLOCK = `layout(std140) uniform Frame {
  highp vec4 fSun, fSunColor, fMoon, fMoonColor, fSkyAbove, fSkyBelow, fHaze, fView, fClouds, fCloudSun;
  highp vec4 fSpheres[${MAX_CASCADES}];
  highp mat4 fCascades[${MAX_CASCADES}];
};
#define fSkyScale fSkyAbove.w
#define fTrueSun (-fMoon.xyz)
`;

export interface BufferUpload {
  /** Chunk index the instances belong to. */
  buffer: number;
  /** INSTANCE_BYTES per instance. The scene owns it, so copy or upload it before the next build. */
  data: Uint8Array;
  /** Structure slot of each instance, for picking. */
  slots: Uint16Array;
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
  /** The side of the texture being made, and of the picture these rows belong to. */
  top: number;
  size: number;
  /** The first row and how many: pixels in the rgba variant, blocks of four in the others. */
  row: number;
  rows: number;
  /** The scene owns it, so upload it before the next build. */
  data: Uint8Array;
  last: boolean;
}

export class FramePacket {
  readonly viewProj = new Float32Array(16);
  readonly nearViewProj = new Float32Array(16);
  camX = 0;
  camY = 0;
  camZ = 0;
  /** Linear 0..1 RGB. */
  readonly sky = new Float32Array(3);
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
   * Which cascades' maps are drawn this frame, a bit each. Any other keeps the map it has, and its matrix stays the one
   * that map was drawn with, moved with the camera.
   */
  cascadesDrawn = 0;
  /** The draw before which the dome goes, on a lit frame. */
  skyAt = 0;

  readonly uploads: BufferUpload[] = [];
  readonly drops: number[] = [];
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
  readonly drawFlags = new Uint16Array(MAX_DRAWS);
  /** For a DRAW_TEXTURED draw: the manifest's material, and the run of indices it covers. */
  readonly drawMaterial = new Uint16Array(MAX_DRAWS);
  readonly drawFirstIndex = new Uint32Array(MAX_DRAWS);
  readonly drawIndexCount = new Uint32Array(MAX_DRAWS);
  /** The depth range each draw is in, PASS_NEAR or PASS_FAR. A draw across `split` is listed in each. */
  readonly drawPass = new Uint8Array(MAX_DRAWS);
  /** Where a draw that fades out with distance is gone, in metres, having faded over the tier's `fade` share of that. 0 for any other. */
  readonly drawFade = new Float32Array(MAX_DRAWS);

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

  transientCount = 0;
  readonly transient = new Uint8Array((MAX_VIEW + MAX_WATER_TILES + 17 + MAX_FALLING + MAX_SKINNED) * INSTANCE_BYTES);
  /** Entity slot index of each transient instance, for picking. */
  readonly transientIds = new Uint32Array(MAX_VIEW + MAX_WATER_TILES + 17 + MAX_FALLING + MAX_SKINNED);

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
  readonly casterFlags = new Uint16Array(MAX_CASTERS);
  readonly casterMaterial = new Uint16Array(MAX_CASTERS);
  readonly casterFirstIndex = new Uint32Array(MAX_CASTERS);
  readonly casterIndexCount = new Uint32Array(MAX_CASTERS);
  readonly casterCascades = new Uint8Array(MAX_CASTERS);

  triangles = 0;

  /** Metres from the camera at which the far depth range begins, 0 for one range. It is kept in `frame`. */
  get split(): number {
    return this.frame[FRAME.split]!;
  }

  set split(metres: number) {
    this.frame[FRAME.split] = metres;
  }

  beginFrame(): void {
    this.uploads.length = 0;
    this.drops.length = 0;
    this.assetUploads.length = 0;
    this.assetDrops.length = 0;
    this.texUploads.length = 0;
    this.texDrops.length = 0;
    this.skipped = 0;
    this.dropped = 0;
    this.drawFade.fill(0, 0, this.drawCount);
    this.drawCount = 0;
    this.tileCount = 0;
    this.groundWindow[3] = -1;
    this.transientCount = 0;
    this.boneCount = 0;
    this.casterCount = 0;
    this.casterDropped = 0;
    this.cascadeCount = 0;
    this.cascadesDrawn = 0;
    this.triangles = 0;
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
