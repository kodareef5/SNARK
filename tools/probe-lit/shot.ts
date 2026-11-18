// What a check of the lit probe (tools/probe-lit.ts) makes and is given back: shots of frames as core built them, and
// the pixels the page read of them.

import { ATLAS_WIDTH, BONE_FLOATS, DETAIL_FLOATS, MAX_CASTERS, MAX_DRAWS, MAX_TILES, type FramePacket } from "../../client/core/render/packet.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

/** What the page says of the device and its context. */
export interface Device {
  renderer: string;
  /** Bits of the canvas's depth buffer, as DEPTH_BITS and as its attachment says. */
  depthBits: number;
  depthSize: number;
  antialias: boolean;
  samples: number;
  /** What compared lookups in a 16-bit depth array give: "filtered" or "hard" (client/core/render/shadowfilter.ts). */
  shadowLookup: string;
}

/** What a check gets back: the pixels of a frame of a shot that was read, top row first, and the device. */
export interface Readback {
  pixels(key: string, frame: number): Uint8Array | null;
  device: Device;
}

export interface LitCheck {
  readonly name: string;
  /** Builds the shots in Bun. Called once, before the page asks for any. */
  shots(): Shot[] | Promise<Shot[]>;
  /** Programs of its own the page draws once each, after every shot (RawShot). */
  raws?(): RawShot[] | Promise<RawShot[]>;
  /** Whether what came back passes, and lines for the report. */
  judge(back: Readback): { ok: boolean; lines: string[] };
}

/** Bytes sent to the page in one piece. Each run starts on a multiple of 4, so the page can view it as an array of any type. */
class Bytes {
  private readonly parts: Uint8Array[] = [];
  length = 0;

  add(view: ArrayBufferView): number {
    const at = this.length;
    this.parts.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice());
    this.length += view.byteLength;
    const pad = (4 - (this.length & 3)) & 3;
    this.parts.push(new Uint8Array(pad));
    this.length += pad;
    return at;
  }

  join(): Uint8Array {
    return Buffer.concat(this.parts);
  }
}

/** A frame as the page rebuilds it: its numbers and tier, each array as far as it is used, and its uploads, with where their bytes are. */
export interface Frame {
  scalars: Record<string, number | boolean | string>;
  arrays: [string, number, number][];
  uploads: number[][];
  drops: number[];
  assetUploads: unknown[];
  assetDrops: number[];
  texUploads: unknown[];
  texDrops: number[];
}

/** How much of a packet's array of this name a frame uses. */
function used(p: FramePacket, name: string, length: number): number {
  if (name.startsWith("draw")) return p.drawCount * (length / MAX_DRAWS);
  if (name.startsWith("tile")) return p.tileCount * (length / MAX_TILES);
  if (name.startsWith("caster")) return p.casterCount * (length / MAX_CASTERS);
  if (name === "transient") return p.transientCount * INSTANCE_BYTES;
  if (name === "transientIds") return p.transientCount;
  if (name === "bones") return p.boneCount * BONE_FLOATS;
  if (name === "atlas") return p.atlasRows * ATLAS_WIDTH * 4;
  if (name === "details" || name === "detailWords") return p.detailCount * DETAIL_FLOATS;
  return length;
}

/**
 * Frames drawn one after another by one renderer on a canvas `width` by `height`, over `ground` and from the pack in
 * `pack`. A frame is taken as core builds it, since a packet is made again for the next.
 */
export class Shot {
  readonly frames: Frame[] = [];
  /** The frames read back. */
  readonly read: number[] = [];
  /** The frame before which the page loses its context and has it back, or -1. */
  loseAt = -1;
  /** Frames are drawn with the sun's shadows, which only the GPU draws (D203), else with none, as the rasterizer has them. */
  shadows = false;
  /** What the renderer takes compared lookups to give, in place of what the device answers: "hard" or "" for the device's. */
  lookup = "";
  /** The manifest the pack was split with, for a shot drawn with materials; else the page describes the pack itself. */
  manifest: Manifest | null = null;
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly ground: Heightfield;
  readonly pack: Uint8Array;
  private readonly out = new Bytes();

  constructor(key: string, width: number, height: number, ground: Heightfield, pack: Uint8Array) {
    [this.key, this.width, this.height, this.ground, this.pack] = [key, width, height, ground, pack];
  }

  /** Takes a frame: every number and array of it a renderer reads. With `read` the page reads it back. */
  add(p: FramePacket, read = false): void {
    const out = this.out;
    const ref = (data: Uint8Array): [number, number] => [out.add(data), data.length];
    const scalars: Frame["scalars"] = { tier: p.tier.name };
    const arrays: Frame["arrays"] = [];
    for (const [name, value] of Object.entries(p)) {
      if (typeof value === "number" || typeof value === "boolean") scalars[name] = value;
      // The cascades' arrays are views of the frame block, which goes whole.
      else if (ArrayBuffer.isView(value) && (value.buffer !== p.frame.buffer || value === p.frame)) {
        const a = value as Uint8Array;
        const n = used(p, name, a.length);
        arrays.push([name, out.add(a.subarray(0, n)), n]);
      }
    }
    if (!this.shadows) scalars.cascadeCount = 0;
    if (read) this.read.push(this.frames.length);
    this.frames.push({
      scalars,
      arrays,
      uploads: p.uploads.map((u) => [u.buffer, ...ref(u.data)]),
      drops: [...p.drops],
      assetUploads: p.assetUploads.map(({ data, ...u }) => ({ ...u, data: ref(data) })),
      assetDrops: [...p.assetDrops],
      texUploads: p.texUploads.map(({ data, ...u }) => ({ ...u, data: ref(data) })),
      texDrops: [...p.texDrops],
    });
  }

  bytes(): Uint8Array {
    return this.out.join();
  }
}

/** The GPU's rows, bottom first, as the rasterizer has them, top first. */
export function topFirst(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

/** A texture of a RawShot: its sampler's name, its side, its levels from the finest down, RGBA or, with 2 channels, RG bytes; sRGB colour where `srgb`. */
export interface RawTexture { name: string; size: number; channels: 2 | 4; srgb: boolean; levels: Uint8Array[] }

/**
 * A program a check draws by itself (tools/probe-lit.ts reads it back as frame 0 of its key): triangles of the named
 * float attributes, interleaved, drawn with depth onto a canvas `width` by `height` cleared to black, with uniforms of 1
 * to 4 floats or a matrix of 16, and textures on units in order.
 */
export class RawShot {
  readonly read = [0];
  readonly key: string;
  readonly width: number;
  readonly height: number;
  private readonly out = new Bytes();
  private readonly shape: object;

  constructor(key: string, width: number, height: number, vertex: string, fragment: string, attributes: readonly (readonly [string, number])[], data: Float32Array, uniforms: Readonly<Record<string, readonly number[]>>, textures: readonly RawTexture[]) {
    [this.key, this.width, this.height] = [key, width, height];
    const vertices = [this.out.add(data), data.byteLength];
    const texts = textures.map((t) => ({ name: t.name, size: t.size, channels: t.channels, srgb: t.srgb, levels: t.levels.map((l) => [this.out.add(l), l.length]) }));
    this.shape = { width, height, vertex, fragment, attributes, uniforms, vertices, textures: texts };
  }

  spec(): object {
    return this.shape;
  }

  bytes(): Uint8Array {
    return this.out.join();
  }
}
