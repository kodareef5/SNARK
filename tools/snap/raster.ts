// Software rasterizer that executes a frame packet on the CPU, so rendering can be looked at and tested without a browser.
// It reads the same packet, pack bytes and shading constants as the WebGL2 shell, and records what is under every pixel.

import { FAR_FROM, NEAR_BODY } from "../../client/core/render/camera.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_CUTOUT, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FRAME, FramePacket, SIZE_REGION, STEP_BODY, STEP_FAR, STEP_FAR_SEE, TILE_QUADS, TRANSIENT_BUFFER, stepOf, type TextureUpload } from "../../client/core/render/packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE, WATER_ALPHA } from "../../client/core/render/shading.ts";
import { domeLight, theSky, trueSun } from "../../client/core/render/sky.ts";
import { NEUTRAL, bumped, dyed, lit, regionDyes, shown, skinMode, skyFrom, srgbToLinear } from "../../client/core/render/surface.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, lodSkin, lodSurface, lodVertices, readIndices, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { TEXTURE_ROLES, pictureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { SIZE_UNITS } from "../../shared/world/nodes.ts";
import { decodeSkin, decodeSurface } from "../pack/surface.ts";

export const PICK_SKY = 0;
export const PICK_TERRAIN = 1;
export const PICK_STRUCTURE = 2;
export const PICK_ENTITY = 3;

interface DecodedLod {
  positions: Float32Array;
  colors: Uint8Array;
  bones: Uint8Array;
  indices: Uint32Array;
  /** Read from the pack, where the level is drawn with materials. A manifest's rasterizer has it from an upload of its own. */
  surface?: DecodedSurface;
}

/** What a level drawn with materials has for each vertex besides, and on a body the skin entries. */
interface DecodedSurface {
  uvs: Float32Array;
  normals: Float32Array;
  tangents: Float32Array;
  skin?: { joints: Uint8Array; weights: Float32Array };
}

/** `range` is what the mesh's stored texture coordinates span, where it says (PackMesh.uv). */
function surfaceOf(entries: Uint8Array, skin: Uint8Array | null, range: readonly number[] | undefined): DecodedSurface {
  return skin && skin.length > 0 ? { ...decodeSurface(entries, range), skin: decodeSkin(skin) } : decodeSurface(entries, range);
}

/** A texture on the card: its pictures as numbers from 0 to 1, smallest first, picture k being 1 << k pixels across. A base colour is held as light. */
interface Texture {
  channels: number;
  pictures: Float32Array[];
}

/** What a textured draw reads besides its vertices' places: its material's textures in the order of TEXTURE_ROLES, and what its flags say. */
interface Surfaced {
  maps: Texture[];
  tint: readonly number[];
  /** 0 for a draw that is not cut out. */
  cutoff: number;
  twoSided: boolean;
  uvs: Float32Array;
  tangents: Float32Array;
}

const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Pictures of the rgba variant as a texture: two channels for a normal map and four for the rest. */
function decodeTexture(role: TextureRole, pictures: readonly ArrayLike<number>[]): Texture {
  return {
    channels: role === "normal" ? 2 : 4,
    pictures: pictures.map((bytes) => Float32Array.from(bytes, (b, i) => (role === "base" && (i & 3) !== 3 ? TO_LINEAR[b]! : b / 255))),
  };
}

/** What a draw reads where its material has no texture: one pixel of NEUTRAL. */
const NEUTRALS = TEXTURE_ROLES.map((role) => decodeTexture(role, [NEUTRAL[role].slice(0, role === "normal" ? 2 : 4)]));

function bilinear(t: Texture, k: number, u: number, v: number, weight: number, out: Float64Array): void {
  const size = 1 << k;
  const p = t.pictures[k]!;
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  // The picture repeats: past one edge is the other.
  const x0 = Math.floor(x) & (size - 1);
  const x1 = (Math.floor(x) + 1) & (size - 1);
  const y0 = Math.floor(y) & (size - 1);
  const y1 = (Math.floor(y) + 1) & (size - 1);
  const a = (y0 * size + x0) * t.channels, b = (y0 * size + x1) * t.channels, c = (y1 * size + x0) * t.channels, d = (y1 * size + x1) * t.channels;
  const wa = weight * (1 - fx) * (1 - fy), wb = weight * fx * (1 - fy), wc = weight * (1 - fx) * fy, wd = weight * fx * fy;
  for (let i = 0; i < t.channels; i++) out[i]! += p[a + i]! * wa + p[b + i]! * wb + p[c + i]! * wc + p[d + i]! * wd;
}

/**
 * Samples a texture as a graphics card does when it filters between pixels and between pictures, repeats the texture
 * both ways and takes no account of slant. `spread` is the base-two logarithm of how much of the texture's width one
 * step between screen pixels crosses.
 */
function sample(t: Texture, u: number, v: number, spread: number, out: Float64Array): void {
  const top = t.pictures.length - 1;
  // How many halvings below the top picture a pixel of the texture is as large as a pixel of the screen.
  const level = top + spread > 0 ? Math.min(top + spread, top) : 0;
  const whole = Math.floor(level);
  out.fill(0);
  bilinear(t, top - whole, u, v, 1 - (level - whole), out);
  if (level > whole) bilinear(t, top - whole - 1, u, v, level - whole, out);
}

/** Puts a direction through the rotation in a bone's rows and gives it length 1. */
function turned(m: Float64Array, from: Float32Array, at: number, out: Float32Array, to: number): void {
  const x = from[at]!, y = from[at + 1]!, z = from[at + 2]!;
  const a = m[0]! * x + m[1]! * y + m[2]! * z, b = m[4]! * x + m[5]! * y + m[6]! * z, c = m[8]! * x + m[9]! * y + m[10]! * z;
  const l = Math.hypot(a, b, c) || 1;
  out[to] = a / l;
  out[to + 1] = b / l;
  out[to + 2] = c / l;
}

/** Numbers a corner of a textured triangle carries to its pixels: position, texture coordinate, normal, tangent and the bitangent's side. */
const CARRIED = 12;
// Scratch for one pixel of a textured draw: what is carried to it, sampled at it and worked out for it.
const carried = new Float64Array(CARRIED);
const carriedNormal = carried.subarray(5, 8);
const carriedTangent = carried.subarray(8, 12);
const texel = TEXTURE_ROLES.map(() => new Float64Array(4));
const albedo = new Float64Array(3);
const normal = new Float64Array(3);
const eye = new Float64Array(3);
const light = new Float64Array(3);
const rgb = new Float64Array(3);
const reflected = new Float64Array(3);
const mirrored = new Float64Array(3);
/** What LIT lights a flat draw as: no occlusion, fully rough, not metal. Its highlight mirrors nothing. */
const ROUGH = [1, 1, 0];
const NOTHING = [0, 0, 0];

/**
 * A pixel of a flat draw on a lit frame into `rgb`, as LIT has it: the checker's `shade` darkens the palette colour,
 * which is lit as SURFACE lights a fully rough surface. (rx, ry, rz) is where it is from the camera, and (nx, ny, nz) its face's normal.
 */
function litFlat(p: FramePacket, pal: Uint8Array, colorIndex: number, shade: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): void {
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
  for (let c = 0; c < 3; c++) albedo[c] = srgbToLinear((pal[colorIndex * 4 + c]! / 255) * shade);
  normal[0] = nx;
  normal[1] = ny;
  normal[2] = nz;
  eye[0] = -rx / dist;
  eye[1] = -ry / dist;
  eye[2] = -rz / dist;
  lit(light, albedo, ROUGH, normal, eye, p.frame, NOTHING);
  shown(rgb, light, dist, p);
}

/** Vertices as the pack holds them, eight bytes each, within the bounds of their mesh. */
function vertices(verts: Uint8Array, n: number, m: { center: readonly number[]; half: readonly number[] }): { positions: Float32Array; colors: Uint8Array; bones: Uint8Array } {
  const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const positions = new Float32Array(n * 3);
  const colors = new Uint8Array(n);
  const bones = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    for (let a = 0; a < 3; a++) positions[v * 3 + a] = m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
    colors[v] = verts[v * VERTEX_BYTES + 6]!;
    bones[v] = verts[v * VERTEX_BYTES + 7]!;
  }
  return { positions, colors, bones };
}

export class Rasterizer {
  readonly width: number;
  readonly height: number;
  readonly color: Uint8ClampedArray;
  /**
   * What each pixel keeps of depth: depth after the projection, put into the step's part of the buffer as the shell's
   * depth range puts it, from -1 to 1 with one range, -1 to 0 for the near and 0 to 1 for the far.
   */
  readonly depth: Float32Array;
  /** 24 keeps depth as a graphics card's buffer of that many bits does, in whole steps from 0 to 2^24 - 1. 0 keeps it as it comes. */
  depthBits = 0;
  /** PICK_* per pixel. */
  readonly pickKind: Uint8Array;
  /** Structure ref (chunk * 65536 + slot) or entity slot index. */
  readonly pickId: Uint32Array;
  /** One more than the bone the triangle under the pixel follows. 0 where no skinned body is drawn. */
  readonly pickBone: Uint8Array;
  trianglesDrawn = 0;
  /** The sky table a lit frame reads, as the renderer holds it on its unit: the game's, or one a test sets. */
  skyTable: Uint8Array = theSky().table;
  /** The sky table's lookup, as `skyFrom` takes it. */
  private readonly look = (view: ArrayLike<number>, out: Float64Array | Float32Array | number[]): void => domeLight(this.skyTable, this.sun, view, out);
  /** Where the sun is in the frame being drawn, as the sky table is read at (sky.ts trueSun). */
  private readonly sun = new Float64Array(3);

  private readonly pack: Pack;
  private readonly hf: Heightfield;
  private readonly buffers = new Map<number, { data: Uint8Array; slots: Uint16Array }>();
  private readonly lods = new Map<number, DecodedLod>();
  /** Given a manifest, only what a packet has uploaded may be drawn, as on a graphics card. Levels are kept by slot. */
  private readonly manifest: Manifest | null;
  /** Given a manifest: the surfaces uploaded, by the slot of their level, each with its own slot. */
  private readonly surfaces = new Map<number, { slot: number; surface: DecodedSurface }>();
  private packet!: FramePacket;
  /**
   * The step being drawn (packet.ts): its matrix, the view depths it clips to, how its depth goes into the buffer, and
   * the view depth nearer than which its see-through pixels are left to the near range.
   */
  private matrix!: Float32Array;
  private nearClip = 0.05;
  private farClip = Infinity;
  private depthScale = 1;
  private depthShift = 0;
  private depthSteps = 0;
  private from = 0;
  /** Triangles are drawn without the checker. */
  private plain = false;
  /** What `pickBone` gets for the triangle being drawn. */
  private bone = 0;
  private scratch = new Float32Array(3 * 1024);
  // Clip scratch: a triangle, then up to 5 vertices of (camera-relative x, y, z, screen x, y, 1/w, NDC depth), and room between clips.
  private readonly tri = new Float64Array(3 * 7);
  private readonly poly = new Float64Array(5 * 7);
  private readonly cutScratch = new Float64Array(5 * (CARRIED + 4));
  private readonly textures = new Map<number, Texture>();
  /** Textures being made: their pictures as bytes, and how many bytes are still to come. */
  private readonly making = new Map<number, { role: TextureRole; top: number; pictures: Uint8Array[]; left: number }>();
  /** For a textured draw: each vertex's normal and tangent after its bones, a vertex's bones blended, and the instance's dyes. */
  private frames = new Float32Array(6 * 1024);
  private readonly blend = new Float64Array(BONE_FLOATS);
  private readonly dyes = new Float64Array(18);
  /** The last lit frame's dome, and what it was made from. */
  private domeColor = new Uint8ClampedArray(0);
  private domeDone = new Uint8Array(0);
  private domeTable: Uint8Array | null = null;
  private readonly domeKey = new Float64Array(16 + FRAME.ends + 5);
  private readonly domeInverse = new Float64Array(9);
  /** Per pixel, a lit flat draw's palette colour and one, 0 for none, the checker's shade, and where it is and which way it faces. */
  private readonly deferred: Uint16Array;
  private readonly deferredShade: Float64Array;
  private readonly deferredAt: Float64Array;
  // A textured triangle's corners, and its clip scratch: per vertex what it carries, then screen x, y, 1/w and NDC depth.
  private readonly corners = new Float64Array(3 * CARRIED);
  private readonly wide = new Float64Array(5 * (CARRIED + 4));

  constructor(width: number, height: number, pack: Pack, hf: Heightfield, manifest: Manifest | null = null) {
    this.width = width;
    this.height = height;
    this.pack = pack;
    this.hf = hf;
    this.manifest = manifest;
    this.color = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height);
    this.pickKind = new Uint8Array(width * height);
    this.pickId = new Uint32Array(width * height);
    this.pickBone = new Uint8Array(width * height);
    this.deferred = new Uint16Array(width * height);
    this.deferredShade = new Float64Array(width * height);
    this.deferredAt = new Float64Array(width * height * 6);
  }

  render(packet: FramePacket): void {
    this.packet = packet;
    trueSun(packet.frame, this.sun);
    for (const u of packet.uploads) this.buffers.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
    for (const id of packet.drops) this.buffers.delete(id);
    if (this.manifest) {
      for (const u of packet.assetUploads) {
        if (u.of === undefined) this.lods.set(u.slot, this.decodeUpload(u));
        else this.surfaces.set(u.of, { slot: u.slot, surface: surfaceOf(u.data.subarray(0, u.skinAt), u.data.subarray(u.skinAt ?? u.data.length), this.manifest.meshes[u.mesh]!.uv) });
      }
      for (const slot of packet.assetDrops) {
        this.lods.delete(slot);
        for (const [level, s] of this.surfaces) if (s.slot === slot) this.surfaces.delete(level);
      }
    }
    // A texture that is let go goes first, with any copy of it being made. Then rows begin a copy, add to it or complete it.
    for (const slot of packet.texDrops) {
      this.textures.delete(slot);
      this.making.delete(slot);
    }
    for (const u of packet.texUploads) this.texture(u);

    const sky = [packet.sky[0]! * 255, packet.sky[1]! * 255, packet.sky[2]! * 255];
    for (let i = 0; i < this.width * this.height; i++) {
      this.color[i * 4] = sky[0]!;
      this.color[i * 4 + 1] = sky[1]!;
      this.color[i * 4 + 2] = sky[2]!;
      this.color[i * 4 + 3] = 255;
    }
    this.depth.fill(Infinity);
    this.pickKind.fill(PICK_SKY);
    this.pickId.fill(0);
    this.pickBone.fill(0);
    this.trianglesDrawn = 0;

    this.depthSteps = (2 ** this.depthBits - 1) / 2;
    this.plain = false;
    this.bone = 0;
    let step = -1;
    for (let d = 0; d < packet.drawCount; d++) {
      const s = stepOf(packet, d);
      while (step < s) this.step(packet, ++step);
      this.draw(packet, d);
    }
    while (step < STEP_FAR_SEE) this.step(packet, ++step);
    if (packet.lit) this.resolve();
  }

  /** Shades the pixels of flat draws on a lit frame that ended in front, as `litFlat` does. */
  private resolve(): void {
    const p = this.packet;
    const s = this.deferredAt;
    for (let at = 0; at < this.width * this.height; at++) {
      if (this.deferred[at] === 0) continue;
      const g6 = at * 6;
      litFlat(p, this.pack.palette, this.deferred[at]! - 1, this.deferredShade[at]!, s[g6]!, s[g6 + 1]!, s[g6 + 2]!, s[g6 + 3]!, s[g6 + 4]!, s[g6 + 5]!);
      for (let c = 0; c < 3; c++) this.color[at * 4 + c] = rgb[c]! * 255;
      this.deferred[at] = 0;
    }
  }

  /**
   * A lit frame's dome where nothing is drawn yet, as its program draws it: through each pixel's middle, the view's
   * direction from the inverse of the rows of `viewProj` that give x, y and w, and the sky table there. Under water,
   * the fog's colour. A pixel's dome is kept until the view, the frame block, the fog or the table change.
   */
  private dome(p: FramePacket): void {
    const key = this.domeKey;
    let same = this.domeColor.length === this.color.length && this.domeTable === this.skyTable;
    this.domeTable = this.skyTable;
    const take = (at: number, v: number): void => {
      if (key[at] !== v) same = false;
      key[at] = v;
    };
    for (let i = 0; i < 16; i++) take(i, p.viewProj[i]!);
    for (let i = 0; i < FRAME.ends; i++) take(16 + i, p.frame[i]!);
    [p.sky[0]!, p.sky[1]!, p.sky[2]!, p.fogStart, p.fogEnd].forEach((v, i) => take(16 + FRAME.ends + i, v));
    if (!same) {
      if (this.domeColor.length !== this.color.length) this.domeColor = new Uint8ClampedArray(this.color.length);
      this.domeDone = new Uint8Array(this.width * this.height);
      const m = p.viewProj;
      // Rows x, y and w of the view and projection, and the inverse of the three by three they make, by its cofactors.
      const a = m[0]!, b = m[4]!, c = m[8]!, d = m[1]!, e = m[5]!, f = m[9]!, g = m[3]!, h = m[7]!, k = m[11]!;
      const inv = this.domeInverse;
      inv.set([e * k - f * h, c * h - b * k, b * f - c * e, f * g - d * k, a * k - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d]);
      const det = a * inv[0]! + b * inv[3]! + c * inv[6]!;
      for (let i = 0; i < 9; i++) inv[i]! /= det;
    }
    const inv = this.domeInverse;
    const under = p.frame[FRAME.eyeHeight]! < 0;
    for (let at = 0; at < this.width * this.height; at++) {
      if (this.depth[at] !== Infinity) continue;
      const o = at * 4;
      if (this.domeDone[at] === 0) {
        this.domeDone[at] = 1;
        if (under) for (let i = 0; i < 3; i++) this.domeColor[o + i] = p.sky[i]! * 255;
        else {
          const nx = (((at % this.width) + 0.5) / this.width) * 2 - 1, ny = 1 - ((Math.floor(at / this.width) + 0.5) / this.height) * 2;
          for (let i = 0; i < 3; i++) reflected[i] = inv[i * 3]! * nx + inv[i * 3 + 1]! * ny + inv[i * 3 + 2]!;
          const l = Math.hypot(reflected[0]!, reflected[1]!, reflected[2]!);
          for (let i = 0; i < 3; i++) reflected[i]! /= l;
          skyFrom(mirrored, p.frame, reflected, this.look);
          shown(rgb, mirrored, 0, p);
          for (let i = 0; i < 3; i++) this.domeColor[o + i] = rgb[i]! * 255;
        }
      }
      for (let i = 0; i < 3; i++) this.color[o + i] = this.domeColor[o + i]!;
    }
  }

  /**
   * Begins a step of the frame as the shell does: its matrix, the view depths it clips to (from 0.05 m on the near side,
   * nearer than the camera's own plane, as the rasterizer always has), its part of the depth buffer, and in an opaque
   * step the terrain tiles in its range. The viewer's own body draws over everything so far, with its own near plane.
   */
  private step(p: FramePacket, s: number): void {
    const split = p.split > 0 && s !== STEP_BODY;
    const far = s === STEP_FAR || s === STEP_FAR_SEE;
    this.matrix = s === STEP_BODY ? p.nearViewProj : far ? p.farViewProj : p.viewProj;
    this.nearClip = s === STEP_BODY ? NEAR_BODY : far ? p.split * FAR_FROM : 0.05;
    this.farClip = split && !far ? p.split : Infinity;
    this.depthScale = split ? 0.5 : 1;
    this.depthShift = split ? (far ? 0.5 : -0.5) : 0;
    this.from = s === STEP_FAR_SEE ? p.split : 0;
    // On a lit frame what is opaque is shaded, and the dome goes where it left the sky, before anything is seen through.
    if (s === STEP_FAR_SEE && p.lit) {
      this.resolve();
      this.dome(p);
    }
    if (s === STEP_BODY) this.depth.fill(Infinity);
    if (s <= STEP_FAR) this.terrain(p, s);
  }

  /** What a pixel at depth `z` after the projection keeps (`depth`). */
  private stored(z: number): number {
    const d = z * this.depthScale + this.depthShift;
    return this.depthBits > 0 ? Math.round((d + 1) * this.depthSteps) : d;
  }

  /**
   * Clips a polygon of `count` corners, `stride` numbers apart in `src` and each a camera-relative position first, to the
   * step's view depths. The first `carried` numbers of a corner are carried to where an edge is cut. Writes the corners
   * left `outStride` apart to `out` and returns how many there are.
   */
  private clip(src: Float64Array, count: number, stride: number, carried: number, out: Float64Array, outStride: number): number {
    const n = this.cut(src, count, stride, carried, out, outStride, this.nearClip, 1);
    if (this.farClip === Infinity || n < 3) return n;
    const spare = this.cutScratch;
    spare.set(out.subarray(0, n * outStride));
    return this.cut(spare, n, outStride, carried, out, outStride, this.farClip, -1);
  }

  /** One plane of `clip`: keeps what lies past view depth `plane` when `side` is 1, and what lies short of it when -1. */
  private cut(src: Float64Array, count: number, stride: number, carried: number, out: Float64Array, outStride: number, plane: number, side: number): number {
    const m = this.matrix;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = i * stride;
      const b = ((i + 1) % count) * stride;
      const w0 = m[3]! * src[a]! + m[7]! * src[a + 1]! + m[11]! * src[a + 2]!;
      const w1 = m[3]! * src[b]! + m[7]! * src[b + 1]! + m[11]! * src[b + 2]!;
      const in0 = (w0 - plane) * side > 0;
      if (in0) {
        for (let k = 0; k < carried; k++) out[n * outStride + k] = src[a + k]!;
        n++;
      }
      if (in0 !== (w1 - plane) * side > 0) {
        const t = (plane - w0) / (w1 - w0);
        for (let k = 0; k < carried; k++) out[n * outStride + k] = src[a + k]! + (src[b + k]! - src[a + k]!) * t;
        n++;
      }
    }
    return n;
  }

  /** The terrain tiles in depth range `range`. */
  private terrain(p: FramePacket, range: number): void {
    const hf = this.hf;
    const row = TILE_QUADS + 1;
    const pos = new Float32Array(row * row * 3);
    const tint = new Uint8Array(row * row);
    for (let t = 0; t < p.tileCount; t++) {
      if ((p.tilePass[t]! & (1 << range)) === 0) continue;
      const stride = p.tiles[t * 4 + 3]!;
      const i0 = p.tileOrigin[t * 2]!;
      const j0 = p.tileOrigin[t * 2 + 1]!;
      for (let gz = 0; gz < row; gz++) {
        for (let gx = 0; gx < row; gx++) {
          const i = Math.min(i0 + gx * stride, hf.nx - 1);
          const j = Math.min(j0 + gz * stride, hf.nz - 1);
          const k = gz * row + gx;
          pos[k * 3] = i * hf.cell - p.camX;
          pos[k * 3 + 1] = hf.sample(i, j) - p.camY;
          pos[k * 3 + 2] = j * hf.cell - p.camZ;
          tint[k] = hf.tint[j * hf.nx + i]!;
        }
      }
      for (let gz = 0; gz < TILE_QUADS; gz++) {
        for (let gx = 0; gx < TILE_QUADS; gx++) {
          const a = gz * row + gx;
          const b = a + 1;
          const c = a + row;
          const d = c + 1;
          // Both triangles of a quad take the colour of its first corner.
          this.triangle(pos, d, b, a, tint[a]!, false, PICK_TERRAIN, 0);
          this.triangle(pos, c, d, a, tint[a]!, false, PICK_TERRAIN, 0);
        }
      }
    }
  }

  private draw(p: FramePacket, d: number): void {
    if ((p.drawFlags[d]! & DRAW_TEXTURED) !== 0) return this.textured(p, d);
    const meshIndex = p.drawMesh[d]!;
    const lod = this.decode(meshIndex, p.drawLod[d]!, p.drawSlot[d]!);
    const transient = p.drawBuffer[d] === TRANSIENT_BUFFER;
    const buffer = transient ? null : this.buffers.get(p.drawBuffer[d]!);
    if (!transient && !buffer) throw new Error(`draw ${d} uses buffer ${p.drawBuffer[d]} which was never uploaded`);
    const data = transient ? p.transient : buffer!.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ox = p.drawOffset[d * 3]!;
    const oy = p.drawOffset[d * 3 + 1]!;
    const oz = p.drawOffset[d * 3 + 2]!;
    const n = lod.positions.length / 3;
    if (this.scratch.length < n * 3) this.scratch = new Float32Array(n * 3);
    const out = this.scratch;
    const skinned = (p.drawFlags[d]! & DRAW_SKINNED) !== 0;
    const one = (p.drawFlags[d]! & DRAW_ONE_BONE) !== 0;
    const sized = (p.drawFlags[d]! & DRAW_SIZED) !== 0;
    this.plain = (p.drawFlags[d]! & DRAW_PLAIN) !== 0;
    const bones = p.bones;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const inst = p.drawFirst[d]! + k;
      const at = inst * INSTANCE_BYTES;
      if (skinned) {
        // Each vertex follows one bone of this instance's body, or with DRAW_ONE_BONE all of them its first.
        const first = view.getUint16(at + 12, true);
        const px = view.getFloat32(at, true), py = view.getFloat32(at + 4, true), pz = view.getFloat32(at + 8, true);
        for (let v = 0; v < n; v++) {
          const b = (first + (one ? 0 : lod.bones[v]!)) * BONE_FLOATS;
          const lx = lod.positions[v * 3]! + px, ly = lod.positions[v * 3 + 1]! + py, lz = lod.positions[v * 3 + 2]! + pz;
          out[v * 3] = bones[b]! * lx + bones[b + 1]! * ly + bones[b + 2]! * lz + bones[b + 3]!;
          out[v * 3 + 1] = bones[b + 4]! * lx + bones[b + 5]! * ly + bones[b + 6]! * lz + bones[b + 7]!;
          out[v * 3 + 2] = bones[b + 8]! * lx + bones[b + 9]! * ly + bones[b + 10]! * lz + bones[b + 11]!;
        }
      } else {
        const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
        const s = Math.sin(yaw);
        const c = Math.cos(yaw);
        const ix = view.getFloat32(at, true) + ox;
        const iy = view.getFloat32(at + 4, true) + oy;
        const iz = view.getFloat32(at + 8, true) + oz;
        const k = sized ? data[at + 14 + SIZE_REGION]! / SIZE_UNITS : 1;
        for (let v = 0; v < n; v++) {
          const lx = lod.positions[v * 3]! * k;
          const lz = lod.positions[v * 3 + 2]! * k;
          out[v * 3] = c * lx + s * lz + ix;
          out[v * 3 + 1] = lod.positions[v * 3 + 1]! * k + iy;
          out[v * 3 + 2] = -s * lx + c * lz + iz;
        }
      }
      const kind = transient ? PICK_ENTITY : PICK_STRUCTURE;
      const id = transient ? p.transientIds[inst]! : p.drawBuffer[d]! * 65536 + buffer!.slots[inst]!;
      for (let t = 0; t < lod.indices.length; t += 3) {
        const last = lod.indices[t + 2]!;
        let color = lod.colors[last]!;
        if (color >= REGION_BASE) color = data[at + 14 + color - REGION_BASE]!;
        this.bone = skinned ? lod.bones[last]! + 1 : 0;
        this.triangle(out, lod.indices[t]!, lod.indices[t + 1]!, last, color, true, kind, id, (p.drawFlags[d]! & DRAW_BLEND) !== 0);
      }
    }
  }

  private decode(mesh: number, level: number, slot: number): DecodedLod {
    if (this.manifest) {
      const lod = this.lods.get(slot);
      if (!lod) throw new Error(`a draw of ${this.manifest.meshes[mesh]!.id} at level ${level}, which is not on the graphics card`);
      return lod;
    }
    const key = mesh * 8 + level;
    let lod = this.lods.get(key);
    if (lod) return lod;
    const m = this.pack.header.meshes[mesh]!;
    if (level >= m.lods.length) throw new Error(`a draw of ${m.id} at level ${level}, which it does not have`);
    lod = { ...vertices(lodVertices(this.pack, m.lods[level]!), m.lods[level]!.vertexCount, m), indices: readIndices(this.pack, m.lods[level]!) };
    const surface = lodSurface(this.pack, m.lods[level]!);
    if (surface) lod.surface = surfaceOf(surface, lodSkin(this.pack, m.lods[level]!), m.uv);
    this.lods.set(key, lod);
    return lod;
  }

  /** A level from the bytes a packet uploads: its indices, padded to a multiple of 4, and then its vertices. */
  private decodeUpload(u: AssetUpload): DecodedLod {
    const view = new DataView(u.data.buffer, u.data.byteOffset, u.data.byteLength);
    const indices = new Uint32Array(u.indexCount);
    for (let i = 0; i < indices.length; i++) indices[i] = u.indexBytes === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
    const verts = u.data.subarray((u.indexCount * u.indexBytes + 3) & ~3);
    return { ...vertices(verts, verts.length / VERTEX_BYTES, this.manifest!.meshes[u.mesh]!), indices };
  }

  /**
   * Takes rows of a copy of a texture. The first row of its one-pixel picture begins the copy, and the upload marked
   * `last` puts it in its slot, where the copy before it was drawn with until then.
   */
  private texture(u: TextureUpload): void {
    if (u.format !== "rgba") throw new Error(`texture ${u.slot} comes as ${u.format}, and only the rgba variant is read here`);
    if (u.size === 1 && u.row === 0) {
      const pictures: Uint8Array[] = [];
      for (let size = 1; size <= u.top; size <<= 1) pictures.push(new Uint8Array(pictureBytes("rgba", u.role, size)));
      this.making.set(u.slot, { role: u.role, top: u.top, pictures, left: pictures.reduce((sum, p) => sum + p.length, 0) });
    }
    const t = this.making.get(u.slot);
    if (!t || t.top !== u.top) throw new Error(`texture ${u.slot} is sent rows of a copy that was not begun`);
    const picture = t.pictures[Math.log2(u.size)]!;
    const row = picture.length / u.size;
    picture.set(u.data.subarray(0, u.rows * row), u.row * row);
    t.left -= u.rows * row;
    if (!u.last) return;
    if (t.left !== 0) throw new Error(`texture ${u.slot} was completed with ${t.left} bytes of it not sent`);
    this.making.delete(u.slot);
    this.textures.set(u.slot, decodeTexture(t.role, t.pictures));
  }

  /**
   * A draw with a material: a run of its level's indices, drawn as the SURFACE program draws it, with no checker and
   * nothing seen through. A texture's slot is its place in the manifest's list, which is the pack's. The level's
   * surface, the base colour and the masks must be on the card. A normal or packed map that is not there reads as
   * NEUTRAL, as one the material lacks does.
   */
  private textured(p: FramePacket, d: number): void {
    const lod = this.decode(p.drawMesh[d]!, p.drawLod[d]!, p.drawSlot[d]!);
    const surface = this.manifest ? this.surfaces.get(p.drawSlot[d]!)?.surface : lod.surface;
    const material = (this.manifest ?? this.pack.header).materials?.[p.drawMaterial[d]!];
    if (!surface) throw new Error(`draw ${d} is textured, and the surface of its level is not on the graphics card`);
    if (!material) throw new Error(`draw ${d} uses material ${p.drawMaterial[d]}, which the pack does not have`);
    const flags = p.drawFlags[d]!;
    const maps = TEXTURE_ROLES.map((role, k) => {
      const t = this.textures.get(material[role]);
      if (!t && material[role] >= 0 && role !== "normal" && role !== "mro") throw new Error(`draw ${d} uses ${material.id}, whose ${role} texture is not on the graphics card`);
      return t ?? NEUTRALS[k]!;
    });
    const s: Surfaced = { maps, tint: material.tint, cutoff: (flags & DRAW_CUTOUT) !== 0 ? material.cutoff : 0, twoSided: (flags & DRAW_TWO_SIDED) !== 0, uvs: surface.uvs, tangents: surface.tangents };
    const end = p.drawFirstIndex[d]! + p.drawIndexCount[d]!;
    if (end > lod.indices.length) throw new Error(`draw ${d} runs past the indices of its level`);
    const transient = p.drawBuffer[d] === TRANSIENT_BUFFER;
    const buffer = transient ? null : this.buffers.get(p.drawBuffer[d]!);
    if (!transient && !buffer) throw new Error(`draw ${d} uses buffer ${p.drawBuffer[d]} which was never uploaded`);
    const data = transient ? p.transient : buffer!.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const skinned = (flags & DRAW_SKINNED) !== 0;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const inst = p.drawFirst[d]! + k;
      const at = inst * INSTANCE_BYTES;
      this.pose(p, d, lod, surface, view, at);
      regionDyes(this.dyes, this.pack.palette, data, at + 14, material.grey);
      // A sized instance's last region is its size, and dyes nothing.
      if ((flags & DRAW_SIZED) !== 0) this.dyes.fill(1, SIZE_REGION * 3, SIZE_REGION * 3 + 3);
      const kind = transient ? PICK_ENTITY : PICK_STRUCTURE;
      const id = transient ? p.transientIds[inst]! : p.drawBuffer[d]! * 65536 + buffer!.slots[inst]!;
      for (let t = p.drawFirstIndex[d]!; t < end; t += 3) {
        const last = lod.indices[t + 2]!;
        this.texturedTriangle(s, lod.indices[t]!, lod.indices[t + 1]!, last, kind, id, skinned ? lod.bones[last]! + 1 : 0);
      }
    }
  }

  /**
   * The vertex stage of a textured draw, as SURFACE_VERTEX has it: where an instance's vertices are, camera-relative,
   * into `scratch`, and their normals and tangents into `frames`.
   */
  private pose(p: FramePacket, d: number, lod: DecodedLod, surface: DecodedSurface, view: DataView, at: number): void {
    const { positions } = lod;
    const { normals, tangents, skin } = surface;
    const n = positions.length / 3;
    if (this.scratch.length < n * 3) this.scratch = new Float32Array(n * 3);
    if (this.frames.length < n * 6) this.frames = new Float32Array(n * 6);
    const out = this.scratch;
    const m = this.blend;
    const mode = skinMode(p.drawFlags[d]!, skin !== undefined);
    const first = view.getUint16(at + 12, true);
    let px = view.getFloat32(at, true), py = view.getFloat32(at + 4, true), pz = view.getFloat32(at + 8, true);
    const k = mode === -1 ? view.getUint8(at + 14 + SIZE_REGION) / SIZE_UNITS : 1;
    if (mode <= 0) {
      const yaw = (first / 65536) * Math.PI * 2;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      m.set([cos, 0, sin, px + p.drawOffset[d * 3]!, 0, 1, 0, py + p.drawOffset[d * 3 + 1]!, -sin, 0, cos, pz + p.drawOffset[d * 3 + 2]!]);
      px = py = pz = 0;
    }
    for (let v = 0; v < n; v++) {
      if (mode === 3) {
        m.fill(0);
        for (let j = 0; j < 4; j++) {
          const w = skin!.weights[v * 4 + j]!;
          const b = (first + skin!.joints[v * 4 + j]!) * BONE_FLOATS;
          if (w > 0) for (let i = 0; i < BONE_FLOATS; i++) m[i]! += p.bones[b + i]! * w;
        }
      } else if (mode > 0) {
        const b = (first + (mode === 2 ? 0 : lod.bones[v]!)) * BONE_FLOATS;
        for (let i = 0; i < BONE_FLOATS; i++) m[i] = p.bones[b + i]!;
      }
      const lx = positions[v * 3]! * k + px, ly = positions[v * 3 + 1]! * k + py, lz = positions[v * 3 + 2]! * k + pz;
      out[v * 3] = m[0]! * lx + m[1]! * ly + m[2]! * lz + m[3]!;
      out[v * 3 + 1] = m[4]! * lx + m[5]! * ly + m[6]! * lz + m[7]!;
      out[v * 3 + 2] = m[8]! * lx + m[9]! * ly + m[10]! * lz + m[11]!;
      turned(m, normals, v * 3, this.frames, v * 6);
      turned(m, tangents, v * 4, this.frames, v * 6 + 3);
    }
  }

  /** Positions are camera-relative. Counter-clockwise faces the viewer. */
  private triangle(pos: Float32Array, ia: number, ib: number, ic: number, colorIndex: number, solid: boolean, pickKind: number, pickId: number, blend = false): void {
    const p = this.packet;
    const ax = pos[ia * 3]!, ay = pos[ia * 3 + 1]!, az = pos[ia * 3 + 2]!;
    const bx = pos[ib * 3]!, by = pos[ib * 3 + 1]!, bz = pos[ib * 3 + 2]!;
    const cx = pos[ic * 3]!, cy = pos[ic * 3 + 1]!, cz = pos[ic * 3 + 2]!;
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nx * ax + ny * ay + nz * az >= 0) {
      if (!blend) return; // faces away from the camera at the origin
      // A see-through surface is drawn from behind too, lit as the face seen.
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // Clip to the step's view depths, producing up to 5 vertices.
    const m = this.matrix;
    const poly = this.poly;
    const tri = this.tri;
    [tri[0], tri[1], tri[2], tri[7], tri[8], tri[9], tri[14], tri[15], tri[16]] = [ax, ay, az, bx, by, bz, cx, cy, cz];
    const count = this.clip(tri, 3, 7, 3, poly, 7);
    if (count < 3) return;
    const W = this.width;
    const H = this.height;
    for (let i = 0; i < count; i++) {
      const x = poly[i * 7]!, y = poly[i * 7 + 1]!, z = poly[i * 7 + 2]!;
      const w = m[3]! * x + m[7]! * y + m[11]! * z;
      poly[i * 7 + 3] = ((m[0]! * x + m[4]! * y + m[8]! * z) / w * 0.5 + 0.5) * W;
      poly[i * 7 + 4] = (0.5 - (m[1]! * x + m[5]! * y + m[9]! * z) / w * 0.5) * H;
      poly[i * 7 + 5] = 1 / w;
      poly[i * 7 + 6] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    }

    const light = (AMBIENT + DIFFUSE * Math.max(0, nx * p.sun[0]! + ny * p.sun[1]! + nz * p.sun[2]!)) * p.light;
    const pal = this.pack.palette;
    const r = pal[colorIndex * 4]! * light;
    const g = pal[colorIndex * 4 + 1]! * light;
    const b = pal[colorIndex * 4 + 2]! * light;
    // The checker samples the world position, pushed slightly behind the face.
    const sx = p.camX - nx * CHECK_INSET;
    const sy = p.camY - ny * CHECK_INSET;
    const sz = p.camZ - nz * CHECK_INSET;
    const fogSpan = p.fogEnd - p.fogStart;

    for (let k = 1; k + 1 < count; k++) {
      const v0 = 0, v1 = k * 7, v2 = (k + 1) * 7;
      const x0 = poly[v0 + 3]!, y0 = poly[v0 + 4]!;
      const x1 = poly[v1 + 3]!, y1 = poly[v1 + 4]!;
      const x2 = poly[v2 + 3]!, y2 = poly[v2 + 4]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;
      this.trianglesDrawn++;
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const fx = px + 0.5;
          const e0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) * inv;
          const e1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) * inv;
          const e2 = 1 - e0 - e1;
          if (e0 < 0 || e1 < 0 || e2 < 0) continue;
          const z = this.stored(e0 * poly[v0 + 6]! + e1 * poly[v1 + 6]! + e2 * poly[v2 + 6]!);
          const at = py * W + px;
          if (z >= this.depth[at]!) continue;
          // Perspective-correct position for the checker and fog. `qs` is the view depth.
          const q0 = e0 * poly[v0 + 5]!, q1 = e1 * poly[v1 + 5]!, q2 = e2 * poly[v2 + 5]!;
          const qs = 1 / (q0 + q1 + q2);
          // In the far range a see-through pixel the near range drew is dropped, as SEE_THROUGH_SPLIT drops it.
          if (blend && qs < this.from) continue;
          if (!blend) {
            this.depth[at] = z;
            this.pickKind[at] = pickKind;
            this.pickId[at] = pickId;
            this.pickBone[at] = this.bone;
          }
          const rx = (q0 * poly[v0]! + q1 * poly[v1]! + q2 * poly[v2]!) * qs;
          const ry = (q0 * poly[v0 + 1]! + q1 * poly[v1 + 1]! + q2 * poly[v2 + 1]!) * qs;
          const rz = (q0 * poly[v0 + 2]! + q1 * poly[v1 + 2]! + q2 * poly[v2 + 2]!) * qs;
          const wx = rx + sx, wy = solid ? ry + sy : 0, wz = rz + sz;
          const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
          let shade = 1;
          const cs = CHECK_COARSE_SIZE;
          if (this.plain) shade = 1;
          else {
            if (((Math.floor(wx) + Math.floor(wy) + Math.floor(wz)) & 1) !== 0) shade -= (1 - CHECK_FINE) * Math.max(0, 1 - dist / CHECK_FINE_FADE);
            if (((Math.floor(wx / cs) + Math.floor(wy / cs) + Math.floor(wz / cs)) & 1) !== 0) shade -= (1 - CHECK_COARSE) * Math.max(0, 1 - dist / CHECK_COARSE_FADE);
          }
          if (p.lit && !blend) {
            // Only what ends in front is shaded, once the opaque draws are done (`resolve`).
            const s = this.deferredAt;
            const g6 = at * 6;
            this.deferred[at] = colorIndex + 1;
            this.deferredShade[at] = shade;
            s[g6] = rx;
            s[g6 + 1] = ry;
            s[g6 + 2] = rz;
            s[g6 + 3] = nx;
            s[g6 + 4] = ny;
            s[g6 + 5] = nz;
            continue;
          }
          let fog = (dist - p.fogStart) / fogSpan;
          fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
          const o = at * 4;
          let cr = r * shade * (1 - fog) + p.sky[0]! * 255 * fog;
          let cg = g * shade * (1 - fog) + p.sky[1]! * 255 * fog;
          let cb = b * shade * (1 - fog) + p.sky[2]! * 255 * fog;
          if (p.lit) {
            litFlat(p, pal, colorIndex, shade, rx, ry, rz, nx, ny, nz);
            [cr, cg, cb] = [rgb[0]! * 255, rgb[1]! * 255, rgb[2]! * 255];
          }
          if (blend) {
            this.color[o] = this.color[o]! + (cr - this.color[o]!) * WATER_ALPHA;
            this.color[o + 1] = this.color[o + 1]! + (cg - this.color[o + 1]!) * WATER_ALPHA;
            this.color[o + 2] = this.color[o + 2]! + (cb - this.color[o + 2]!) * WATER_ALPHA;
          } else {
            this.color[o] = cr;
            this.color[o + 1] = cg;
            this.color[o + 2] = cb;
          }
        }
      }
    }
  }

  /**
   * One triangle of a textured draw. Its texture coordinate, normal and tangent are carried to each pixel with
   * correct perspective, as its position is, and client/core/render/surface.ts shades the pixel.
   */
  private texturedTriangle(s: Surfaced, ia: number, ib: number, ic: number, pickKind: number, pickId: number, bone: number): void {
    const p = this.packet;
    const pos = this.scratch;
    const ax = pos[ia * 3]!, ay = pos[ia * 3 + 1]!, az = pos[ia * 3 + 2]!;
    const bx = pos[ib * 3]!, by = pos[ib * 3 + 1]!, bz = pos[ib * 3 + 2]!;
    const cx = pos[ic * 3]!, cy = pos[ic * 3 + 1]!, cz = pos[ic * 3 + 2]!;
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const back = nx * ax + ny * ay + nz * az >= 0;
    if (back && !s.twoSided) return;

    const src = this.corners;
    [ia, ib, ic].forEach((v, k) => {
      const o = k * CARRIED;
      for (let i = 0; i < 3; i++) src[o + i] = pos[v * 3 + i]!;
      src[o + 3] = s.uvs[v * 2]!;
      src[o + 4] = s.uvs[v * 2 + 1]!;
      for (let i = 0; i < 6; i++) src[o + 5 + i] = this.frames[v * 6 + i]!;
      src[o + 11] = s.tangents[v * 4 + 3]!;
    });

    // Clip as `triangle` does, with everything a corner carries.
    const m = this.matrix;
    const poly = this.wide;
    const stride = CARRIED + 4;
    const count = this.clip(src, 3, CARRIED, CARRIED, poly, stride);
    if (count < 3) return;
    const W = this.width;
    const H = this.height;
    for (let i = 0; i < count; i++) {
      const o = i * stride;
      const x = poly[o]!, y = poly[o + 1]!, z = poly[o + 2]!;
      const w = m[3]! * x + m[7]! * y + m[11]! * z;
      poly[o + CARRIED] = ((m[0]! * x + m[4]! * y + m[8]! * z) / w * 0.5 + 0.5) * W;
      poly[o + CARRIED + 1] = (0.5 - (m[1]! * x + m[5]! * y + m[9]! * z) / w * 0.5) * H;
      poly[o + CARRIED + 2] = 1 / w;
      poly[o + CARRIED + 3] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    }

    const [base, bump, mro, mask, mask2] = texel as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
    for (let k = 1; k + 1 < count; k++) {
      const v0 = 0, v1 = k * stride, v2 = (k + 1) * stride;
      const x0 = poly[v0 + CARRIED]!, y0 = poly[v0 + CARRIED + 1]!, i0 = poly[v0 + CARRIED + 2]!;
      const x1 = poly[v1 + CARRIED]!, y1 = poly[v1 + CARRIED + 1]!, i1 = poly[v1 + CARRIED + 2]!;
      const x2 = poly[v2 + CARRIED]!, y2 = poly[v2 + CARRIED + 1]!, i2 = poly[v2 + CARRIED + 2]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;
      this.trianglesDrawn++;
      const inv = 1 / area;
      // How the first two corners' weights change from a pixel to the next one right, and to the next one down.
      const e0x = (y1 - y2) * inv, e0y = (x2 - x1) * inv, e1x = (y2 - y0) * inv, e1y = (x0 - x2) * inv;
      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const fx = px + 0.5;
          const e0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) * inv;
          const e1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) * inv;
          const e2 = 1 - e0 - e1;
          if (e0 < 0 || e1 < 0 || e2 < 0) continue;
          const z = this.stored(e0 * poly[v0 + CARRIED + 3]! + e1 * poly[v1 + CARRIED + 3]! + e2 * poly[v2 + CARRIED + 3]!);
          const at = py * W + px;
          if (z >= this.depth[at]!) continue;
          const q0 = e0 * i0, q1 = e1 * i1, q2 = e2 * i2;
          const qs = 1 / (q0 + q1 + q2);
          for (let i = 0; i < CARRIED; i++) carried[i] = (q0 * poly[v0 + i]! + q1 * poly[v1 + i]! + q2 * poly[v2 + i]!) * qs;
          const u = carried[3]!, v = carried[4]!;
          // The picture to sample is chosen by how far the texture coordinate moves to the next pixel right and to the next down.
          const r0 = (e0 + e0x) * i0, r1 = (e1 + e1x) * i1, r2 = (e2 - e0x - e1x) * i2;
          const d0 = (e0 + e0y) * i0, d1 = (e1 + e1y) * i1, d2 = (e2 - e0y - e1y) * i2;
          const ux = (r0 * poly[v0 + 3]! + r1 * poly[v1 + 3]! + r2 * poly[v2 + 3]!) / (r0 + r1 + r2) - u;
          const vx = (r0 * poly[v0 + 4]! + r1 * poly[v1 + 4]! + r2 * poly[v2 + 4]!) / (r0 + r1 + r2) - v;
          const uy = (d0 * poly[v0 + 3]! + d1 * poly[v1 + 3]! + d2 * poly[v2 + 3]!) / (d0 + d1 + d2) - u;
          const vy = (d0 * poly[v0 + 4]! + d1 * poly[v1 + 4]! + d2 * poly[v2 + 4]!) / (d0 + d1 + d2) - v;
          const spread = Math.log2(Math.max(Math.hypot(ux, vx), Math.hypot(uy, vy)));
          sample(s.maps[0]!, u, v, spread, base);
          if (base[3]! < s.cutoff) continue;
          this.depth[at] = z;
          this.deferred[at] = 0;
          this.pickKind[at] = pickKind;
          this.pickId[at] = pickId;
          this.pickBone[at] = bone;
          sample(s.maps[1]!, u, v, spread, bump);
          sample(s.maps[2]!, u, v, spread, mro);
          sample(s.maps[3]!, u, v, spread, mask);
          sample(s.maps[4]!, u, v, spread, mask2);
          const dist = Math.hypot(carried[0]!, carried[1]!, carried[2]!);
          for (let i = 0; i < 3; i++) eye[i] = -carried[i]! / dist;
          dyed(albedo, base, s.tint, this.dyes, mask, mask2);
          bumped(normal, carriedNormal, carriedTangent, bump[0]!, bump[1]!, back);
          const twice = 2 * (normal[0]! * eye[0]! + normal[1]! * eye[1]! + normal[2]! * eye[2]!);
          for (let i = 0; i < 3; i++) reflected[i] = twice * normal[i]! - eye[i]!;
          skyFrom(mirrored, p.frame, reflected, this.look);
          lit(light, albedo, mro, normal, eye, p.frame, mirrored);
          shown(rgb, light, dist, p);
          this.color[at * 4] = rgb[0]! * 255;
          this.color[at * 4 + 1] = rgb[1]! * 255;
          this.color[at * 4 + 2] = rgb[2]! * 255;
        }
      }
    }
  }
}
