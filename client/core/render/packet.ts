// The frame packet: everything a renderer needs to draw one frame, as data.
//
// client/core decides what is visible, at which level of detail, in which
// batches. A renderer only executes: the WebGL2 shell turns the packet into
// draw calls, the software rasterizer in tools/snap turns it into a PNG. Any
// logic that would need a browser to test belongs on this side of the packet.
//
// A packet has two parts. Resource changes (instance buffers to upload or drop)
// persist across frames and must be applied in order. Draws and terrain tiles
// describe this frame only.

import { MAX_VIEW } from "../../../shared/net/view.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";

export const MAX_DRAWS = 4096;
export const MAX_TILES = 1024;
/** Quads per terrain tile side, at every level. */
export const TILE_QUADS = 32;
/** Buffer id for the per-frame instance data carried in the packet itself. */
export const TRANSIENT_BUFFER = 0xffffffff;
/** Instances a frame may carry besides entities: water surface tiles and marker beams. */
export const MAX_WATER_TILES = 64;
/** Draw flag: see-through. Drawn after everything opaque, blended, both faces, without writing depth. */
export const DRAW_BLEND = 1;

export interface BufferUpload {
  /** Chunk index the instances belong to. */
  buffer: number;
  /** INSTANCE_BYTES per instance. Owned by the scene; copy or upload before the next build. */
  data: Uint8Array;
  /** Structure slot of each instance, for picking. */
  slots: Uint16Array;
}

export class FramePacket {
  readonly viewProj = new Float32Array(16);
  camX = 0;
  camY = 0;
  camZ = 0;
  /** Linear 0..1 RGB. */
  readonly sky = new Float32Array(3);
  /** Unit vector toward the sun. */
  readonly sun = new Float32Array(3);
  fogStart = 0;
  fogEnd = 1;

  readonly uploads: BufferUpload[] = [];
  readonly drops: number[] = [];

  drawCount = 0;
  /** Pack mesh index. */
  readonly drawMesh = new Uint16Array(MAX_DRAWS);
  /** Requested level of detail; renderers clamp to what the mesh has. */
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
  readonly transient = new Uint8Array((MAX_VIEW + MAX_WATER_TILES + 17) * INSTANCE_BYTES);
  /** Entity slot index of each transient instance, for picking. */
  readonly transientIds = new Uint32Array(MAX_VIEW + MAX_WATER_TILES + 17);

  /** Triangles submitted, for budgets and benchmarks. */
  triangles = 0;

  beginFrame(): void {
    this.uploads.length = 0;
    this.drops.length = 0;
    this.drawCount = 0;
    this.tileCount = 0;
    this.transientCount = 0;
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

  /** Give instance `i` its own colour regions. A zero leaves that region as `set` wrote it. */
  regions(i: number, colors: Uint8Array, from: number): void {
    const at = i * INSTANCE_BYTES + 14;
    for (let q = 0; q < 6; q++) if (colors[from + q] !== 0) this.bytes[at + q] = colors[from + q]!;
  }
}
