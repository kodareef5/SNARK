// Everything a renderer needs to draw one frame, as data. client/core decides what is visible, and a renderer only executes.
// Uploads and drops persist across frames and must be applied in order. Draws and terrain tiles describe this frame only.

import { MAX_VIEW } from "../../../shared/net/view.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import type { AssetUpload } from "../assets/residency.ts";

export const MAX_DRAWS = 4096;
export const MAX_TILES = 1024;
/** Quads per terrain tile side, at every level. */
export const TILE_QUADS = 32;
/** Buffer id for the per-frame instance data carried in the packet itself. */
export const TRANSIENT_BUFFER = 0xffffffff;
/** Instances a frame may carry besides entities: water surface tiles, sixteen marker beams, and a piece about to be built. */
export const MAX_WATER_TILES = 64;
/** Structures a frame may show falling. The nearest to the camera are shown. */
export const MAX_FALLING = 256;
/** DRAW_ flags. A blended draw is see-through. It comes after everything opaque, shows both faces and writes no depth. */
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

/** Floats per bone: three rows of a 3 x 4 matrix, each row x, y, z, translation. */
export const BONE_FLOATS = 12;
/** Bones per row of the bone texture. A texel is four floats, so a bone is three texels. */
export const BONES_PER_ROW = 256;
export const BONE_ROWS = 64;
export const MAX_BONES = BONES_PER_ROW * BONE_ROWS;
/** Skinned instances a frame may carry. Every body is several meshes. */
export const MAX_SKINNED = MAX_VIEW * 10;

export interface BufferUpload {
  /** Chunk index the instances belong to. */
  buffer: number;
  /** INSTANCE_BYTES per instance. The scene owns it, so copy or upload it before the next build. */
  data: Uint8Array;
  /** Structure slot of each instance, for picking. */
  slots: Uint16Array;
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

  readonly uploads: BufferUpload[] = [];
  readonly drops: number[] = [];
  /** Levels of meshes to put on the graphics card, and slots to take off it, before this frame's draws. */
  readonly assetUploads: AssetUpload[] = [];
  readonly assetDrops: number[] = [];
  /** Draws left out because no level of their mesh was to be had. */
  skipped = 0;

  drawCount = 0;
  /** Pack mesh index. */
  readonly drawMesh = new Uint16Array(MAX_DRAWS);
  /** The level of detail to draw. It is one the mesh has and the graphics card holds. */
  readonly drawLod = new Uint8Array(MAX_DRAWS);
  readonly drawBuffer = new Uint32Array(MAX_DRAWS);
  readonly drawFirst = new Uint32Array(MAX_DRAWS);
  readonly drawInstances = new Uint32Array(MAX_DRAWS);
  /** Camera-relative origin of the buffer's coordinates: x, y, z per draw. */
  readonly drawOffset = new Float32Array(MAX_DRAWS * 3);
  /** DRAW_ bits. Draws with DRAW_BLEND come last. */
  readonly drawFlags = new Uint8Array(MAX_DRAWS);

  tileCount = 0;
  /** Per tile: camera-relative x and z of its corner, metres per quad, sample stride. */
  readonly tiles = new Float32Array(MAX_TILES * 4);
  /** Per tile: heightfield sample (i, j) of its corner. */
  readonly tileOrigin = new Int32Array(MAX_TILES * 2);

  transientCount = 0;
  readonly transient = new Uint8Array((MAX_VIEW + MAX_WATER_TILES + 17 + MAX_FALLING + MAX_SKINNED) * INSTANCE_BYTES);
  /** Entity slot index of each transient instance, for picking. */
  readonly transientIds = new Uint32Array(MAX_VIEW + MAX_WATER_TILES + 17 + MAX_FALLING + MAX_SKINNED);

  /** Bones of every body drawn this frame, BONE_FLOATS each. */
  boneCount = 0;
  readonly bones = new Float32Array(MAX_BONES * BONE_FLOATS);

  triangles = 0;

  beginFrame(): void {
    this.uploads.length = 0;
    this.drops.length = 0;
    this.assetUploads.length = 0;
    this.assetDrops.length = 0;
    this.skipped = 0;
    this.drawCount = 0;
    this.tileCount = 0;
    this.transientCount = 0;
    this.boneCount = 0;
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

  /** A zero leaves that region as `set` wrote it. */
  regions(i: number, colors: Uint8Array, from: number): void {
    const at = i * INSTANCE_BYTES + 14;
    for (let q = 0; q < 6; q++) if (colors[from + q] !== 0) this.bytes[at + q] = colors[from + q]!;
  }
}
