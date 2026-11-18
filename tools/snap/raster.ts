// Software rasterizer that executes a frame packet on the CPU, so rendering can be looked at and tested without a browser.
// It reads the same packet, pack bytes and shading constants as the WebGL2 shell, and records what is under every pixel.

import { decodeTexture, sample, type Texture } from "../../client/core/render/cpu-texture.ts";
import { SURFACE_NAMES, WEATHER_LAYER, WEATHER_MATERIAL, surfaceIndex, surfaceMaterial } from "../../content/surfaces.ts";
import { GROUND_BAND, GROUND_SCALE, edgeOf, edged, groundCover, groundMeet, groundWander, higher, staticPlace, staticSeed, weatherFrame, weathered, worldSharp, worldSurface, type WorldSample } from "../../client/core/render/world-surfaces.ts";
import { FAR_FROM, NEAR_BODY } from "../../client/core/render/camera.ts";
import { FAR_BUFFER, FAR_SLOTS, fadeKeeps } from "../../client/core/render/far.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import { LANDMARK_BUFFER } from "../../client/core/render/farlandmarks.ts";
import { nearKeeps } from "../../client/core/render/hand.ts";
import { COARSE, groundNormal, groundSize, tilePicture, type GroundPicture } from "../../client/core/render/terrain.ts";
import { OPEN_BYTES, overGround, skyOpen } from "../../client/core/render/skyopen.ts";
import { MOST_LOD, detailKeeps, rotorOf, shapeOf } from "../../client/core/render/detailtext.ts";
import { ATLAS_REGION, ATLAS_WIDTH, BONE_FLOATS, DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_PUFF, DETAIL_ROTOR, DRAW_BLEND, DRAW_CUTOUT, DRAW_DETAILS, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_PULLED, DRAW_RANGED, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FRAME, FramePacket, SIZE_REGION, STEP_BODY, STEP_FAR, STEP_FAR_SEE, TILE_CASTS, TILE_QUADS, TRANSIENT_BUFFER, quadIndices, stepOf, type TextureUpload } from "../../client/core/render/packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE, WATER_ALPHA } from "../../client/core/render/shading.ts";
import { domeLight, theSky, trueSun } from "../../client/core/render/sky.ts";
import { wearLate } from "../../client/core/render/wear.ts";
import { LAYER_LEVELS, NEUTRAL, bumped, dyed, lit, regionDyes, shown, skinMode, skyFrom, skyLight, srgbToLinear, through, wounded } from "../../client/core/render/surface.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { finishTable, type FinishTable } from "../../shared/pack/finish.ts";
import { CELL, mipOffset } from "../../shared/pack/details.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, detailsAtlas, lodSkin, lodSurface, lodVertices, readIndices, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { MAP_ROLES, TEXTURE_ROLES, pictureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { SIZE_UNITS } from "../../shared/world/nodes.ts";
import { decodeSkin, decodeSurface } from "../pack/surface.ts";

export const PICK_SKY = 0;
export const PICK_TERRAIN = 1;
export const PICK_STRUCTURE = 2;
export const PICK_ENTITY = 3;
/** A draw that fades out with distance (far.ts). Its pick id is its slot. */
export const PICK_FAR = 4;

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

/**
 * What a textured draw reads besides its vertices' places: its material's maps in the order of MAP_ROLES, what its
 * flags say, and its layer with the level it is drawn at, 0 for none.
 */
interface Surfaced {
  maps: Texture[];
  layer: Texture | null;
  level: number;
  /** The wear story its layer is drawn with (wear.ts), and where its vertices lie in its mesh's bounds, -1 to 1: null for none. */
  wear: number;
  box: Float32Array | null;
  tint: readonly number[];
  /** 0 for a draw that is not cut out. */
  cutoff: number;
  /** The material's sheet (shared/pack/finish.ts), 0 for none. */
  sheet: number;
  twoSided: boolean;
  uvs: Float32Array;
  tangents: Float32Array;
}

/** What a draw reads where its material has no texture: one pixel of NEUTRAL. */
const NEUTRALS = MAP_ROLES.map((role) => decodeTexture(role, [NEUTRAL[role].slice(0, role === "normal" ? 2 : 4)]));

const beside = new Float64Array(4);

/**
 * The share of a pixel of a cut-out draw that alpha to coverage covers, as SURFACE's fragment works it out: from the
 * base colour's `alpha` there and how much it changes to the next pixel right, (ux, vx) on in the texture, and down,
 * (uy, vy) on.
 */
function covered(t: Texture, alpha: number, cutoff: number, u: number, v: number, ux: number, vx: number, uy: number, vy: number, spread: number): number {
  sample(t, u + ux, v + vx, spread, beside);
  let change = Math.abs(beside[3]! - alpha);
  sample(t, u + uy, v + vy, spread, beside);
  change += Math.abs(beside[3]! - alpha);
  return Math.min(Math.max((alpha - cutoff) / Math.max(change, 0.0001) + 0.5, 0), 1);
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
/**
 * Into `m` the rows a vertex of a DRAW_ONE_BONE draw goes by: those of its bone `bone` of the pose at `stand`, then those of
 * the instance's first bone `place` (packet.ts DRAW_ONE_BONE).
 */
function standing(bones: Float32Array, stand: number, bone: number, place: number, m: Float64Array): void {
  const s = (stand + bone) * BONE_FLOATS, q = place * BONE_FLOATS;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = c === 3 ? bones[q + r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) v += bones[q + r * 4 + k]! * bones[s + k * 4 + c]!;
      m[r * 4 + c] = v;
    }
  }
}
const stood = new Float64Array(BONE_FLOATS);

const CARRIED = 15;
/** A deferred pixel of the ground, which keeps the normal it is lit by. */
const DEFERRED_GROUND = 2048;
/** The bits from which a deferred pixel names its landmark's row of finishes (shared/pack/finish.ts), 0 for none. */
const DEFERRED_FINISH = 12;
// Scratch for one pixel of a textured draw: what is carried to it, sampled at it and worked out for it.
const carried = new Float64Array(CARRIED);
const carriedNormal = carried.subarray(5, 8);
const carriedTangent = carried.subarray(8, 12);
const texel = TEXTURE_ROLES.map(() => new Float64Array(4));
const albedo = new Float64Array(3);
const worldOrm = new Float64Array(3);
const normal = new Float64Array(3);
const eye = new Float64Array(3);
const light = new Float64Array(3);
const rgb = new Float64Array(3);
const reflected = new Float64Array(3);
const mirrored = new Float64Array(3);
const smoothed = new Float64Array(3);
const albedo2 = new Float64Array(3);
const orm2 = new Float64Array(3);
const normal2 = new Float64Array(3);
const meet = new Float64Array(2);
const ownNow = new Float32Array(4);
const edgeNow = new Float32Array(4);
const wander = new Float64Array(2);

/**
 * The tint the lit tiers' ground takes at ground point (x, z) of a tile that reads picture `pic`, a pixel `footprint`
 * metres wide, as LIT_TERRAIN_FRAGMENT chooses it from the picture's own samples (world-surfaces.ts `groundCover`), and
 * into `out` the other finish's tint it meets there and how much of it is wanted (`groundMeet`).
 */
function groundPair(hf: Heightfield, pic: GroundPicture, x: number, z: number, footprint: number, desert: boolean, out: Float64Array): number {
  groundWander(x, z, footprint, wander);
  const metres = hf.cell * pic.step;
  const s = Math.min(Math.max((x + wander[0]!) / metres - pic.i / pic.step, 0), pic.lastI);
  const t = Math.min(Math.max((z + wander[1]!) / metres - pic.j / pic.step, 0), pic.lastJ);
  const i = Math.min(Math.floor(s), pic.lastI - 1), j = Math.min(Math.floor(t), pic.lastJ - 1);
  const at = (pic.j + j * pic.step) * hf.nx + pic.i + i * pic.step, down = pic.step * hf.nx;
  const a = hf.tint[at]!, b = hf.tint[at + pic.step]!, c = hf.tint[at + down]!, d = hf.tint[at + down + pic.step]!;
  const cover = groundCover(a, b, c, d, s - i, t - j);
  groundMeet(cover, a, b, c, d, s - i, t - j, (tint) => surfaceIndex(tint, true, desert ? "las-vegas" : "default"), out);
  return cover;
}
/** What LIT lights a flat draw as: no occlusion, fully rough, not metal. Its highlight mirrors nothing. */
const ROUGH = [1, 1, 0];
/** Occlusion, roughness and metalness with the sky's openness taken into the occlusion. */
const opened = new Float64Array(3);
const NOTHING = [0, 0, 0];

/**
 * A palette draw on a lit frame into `rgb`, with world-projected finishes and SURFACE lighting. (rx, ry, rz) is where it
 * is from the camera, and (nx, ny, nz) its face's normal. The ground is lit by its own normal, `smooth`, and where its
 * finish meets another, `other` is that one's tint and `share` how much of it is wanted (LIT_TERRAIN_FRAGMENT).
 * A landmark's draw names its row of `finish` (shared/pack/finish.ts): a colour it states is lit as that finish, as LIT_MESH_FRAGMENT has it.
 * `open` is the share of the sky's light the sky's openness leaves it (skyopen.ts), which its sheet's light from behind keeps.
 */
function litFlat(p: FramePacket, pal: Uint8Array, colorIndex: number, shade: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number, sample: WorldSample | null = null, ground = false, footprint = 0, look?: (view: ArrayLike<number>, out: Float64Array | Float32Array | number[]) => void, smooth: Float64Array | null = null, finish?: FinishTable, row = 0, open = 1, other = -1, share = 0, weather: ArrayLike<number> | null = null, over = 0, edge: ArrayLike<number> | null = null): void {
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
  for (let c = 0; c < 3; c++) albedo[c] = srgbToLinear(pal[colorIndex * 4 + c]! / 255);
  normal[0] = smooth ? smooth[0]! : nx;
  normal[1] = smooth ? smooth[1]! : ny;
  normal[2] = smooth ? smooth[2]! : nz;
  eye[0] = -rx / dist;
  eye[1] = -ry / dist;
  eye[2] = -rz / dist;
  const own = ((2 * row - 1) * 256 + colorIndex) * 4;
  // A line's finish is lit as if it faced the eye, as LIT_MESH_FRAGMENT has it.
  if (finish && row > 0 && finish.pixels[own + 3]! > 0 && finish.pixels[own + 3]! < 255) normal.set(eye);
  if (finish && row > 0 && finish.pixels[own + 3]! > 0) {
    for (let c = 0; c < 3; c++) {
      albedo[c] = srgbToLinear(finish.pixels[own + c]! / 255);
      worldOrm[c] = finish.pixels[own + 1024 + c]! / 255;
    }
    const twice = 2 * (normal[0]! * eye[0]! + normal[1]! * eye[1]! + normal[2]! * eye[2]!);
    for (let c = 0; c < 3; c++) reflected[c] = twice * normal[c]! - eye[c]!;
    if (worldOrm[1]! < 1 && look) skyFrom(mirrored, p.frame, reflected, look);
    opened.set([worldOrm[0]! * open, worldOrm[1]!, worldOrm[2]!]);
    lit(light, albedo, opened, normal, eye, p.frame, worldOrm[1]! < 1 && look ? mirrored : NOTHING);
    through(light, albedo, worldOrm, normal, p.frame, finish.pixels[own + 1027]! / 255);
  } else if (sample) {
    const city = p.surfaceCity[7] ? "las-vegas" : "default", touch = p.tier.finish === "light", index = surfaceIndex(colorIndex, ground, city);
    const h = worldSurface(albedo, worldOrm, normal, albedo, index, rx + p.camX, ry + p.camY, rz + p.camZ, nx, ny, nz, footprint, p.surfaceCity, sample, touch, smooth, p.tier.relief ? eye : null);
    if (other >= 0 && share > 0) {
      for (let c = 0; c < 3; c++) albedo2[c] = srgbToLinear(pal[other * 4 + c]! / 255);
      const b = higher(h, worldSurface(albedo2, orm2, normal2, albedo2, surfaceIndex(other, true, city), rx + p.camX, ry + p.camY, rz + p.camZ, nx, ny, nz, footprint, p.surfaceCity, sample, touch, smooth, p.tier.relief ? eye : null), share, GROUND_SCALE, GROUND_BAND);
      for (let c = 0; c < 3; c++) {
        albedo[c] = albedo[c]! * (1 - b) + albedo2[c]! * b;
        worldOrm[c] = worldOrm[c]! * (1 - b) + orm2[c]! * b;
        normal[c] = normal[c]! * (1 - b) + normal2[c]! * b;
      }
      const l = Math.hypot(normal[0]!, normal[1]!, normal[2]!);
      for (let c = 0; c < 3; c++) normal[c]! /= l;
    }
    if (weather && weather[3]! >= 0 && !ground && !touch) {
      weathered(albedo, worldOrm, index, weather[0]!, weather[2]!, weather[3]!, over, open, rx + p.camX, ry + p.camY, rz + p.camZ, Math.abs(nx) > Math.abs(nz), dist, footprint, p.surfaceCity, sample);
      if (edge && edge[0]! >= 0) edged(albedo, worldOrm, normal, index, edge[0]!, edge[1]!, edge[2]!, edge[3]!, h, rx + p.camX, ry + p.camY, rz + p.camZ, footprint, p.surfaceCity, p.tier.finishes < 1024);
    }
    const twice = 2 * (normal[0]! * eye[0]! + normal[1]! * eye[1]! + normal[2]! * eye[2]!);
    for (let c = 0; c < 3; c++) reflected[c] = twice * normal[c]! - eye[c]!;
    const sharp = worldSharp(worldOrm[1]!);
    if (!sharp) skyLight(mirrored, p.frame, reflected);
    else if (look) skyFrom(mirrored, p.frame, reflected, look);
    worldOrm[0]! *= open;
    lit(light, albedo, worldOrm, normal, eye, p.frame, sharp && !look ? NOTHING : mirrored);
  } else {
    opened.set([open, 1, 0]);
    lit(light, albedo, opened, normal, eye, p.frame, NOTHING);
  }
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
  /**
   * For a structure or a node, its instance buffer * 65536 + its slot, which a double holds exactly for every buffer id; an
   * entity's slot index; a far draw's slot.
   */
  readonly pickId: Float64Array;
  /** One more than the bone the triangle under the pixel follows. 0 where no skinned body is drawn. */
  readonly pickBone: Uint8Array;
  /** The draw under the pixel, as the packet numbers them. -1 for the ground and the sky. */
  readonly pickDraw: Int16Array;
  /**
   * How much of the pixel a cut-out draw covers as the SURFACE program's alpha to coverage has it, from the base colour's
   * alpha and how fast it changes to the next pixel. The rasterizer keeps or drops the whole pixel by its middle, so the
   * two pictures differ where this is under 1. 1 under anything not cut out.
   */
  readonly cover: Float32Array;
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
  /** The landmarks' finishes, and the row of them of the flat draw being drawn (shared/pack/finish.ts). */
  private readonly finish: FinishTable;
  private finishRow = 0;
  /** Given a manifest: the surfaces uploaded, by the slot of their level, each with its own slot. */
  private readonly surfaces = new Map<number, { slot: number; surface: DecodedSurface }>();
  /** Levels and surfaces going up in pieces, as far as they have come. */
  private readonly coming = new Map<number, Uint8Array>();
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
  /** What `pickBone` and `pickDraw` get for the triangle being drawn. */
  private bone = 0;
  private drawing = -1;
  /** For a draw that fades out (`drawFade`): where it is gone, and the share of that it fades over. 0 for any other. */
  private fade = 0;
  private fadeShare = 0;
  /** For a draw of nodes in their hand-over (hand.ts): its HAND_ value, the band, and how far the instance's foot is. */
  private hand = 0;
  private handFrom = 0;
  private handTo = 0;
  private handAt = 0;
  /** The far nodes' meshes as the card holds them (packet.ts `atlas`). */
  private atlas = new Float32Array(0);
  /** The sky's openness as the card holds it (packet.ts `openMap`), its cells across and down. */
  private open = new Uint8Array(0);
  private openWidth = 0;
  private openHeight = 0;
  private scratch = new Float32Array(3 * 1024);
  // Clip scratch: a triangle, then up to 5 vertices of (camera-relative x, y, z, screen x, y, 1/w, NDC depth), and room between clips.
  private readonly tri = new Float64Array(3 * 7);
  private readonly poly = new Float64Array(5 * 7);
  private readonly cutScratch = new Float64Array(5 * (CARRIED + 4));
  private readonly textures = new Map<number, Texture>();
  /** Textures being made: their pictures as bytes, and how many bytes are still to come. */
  /** Each world finish's base colour, normal and packed map, once all of them have come. */
  private worldMaps: Texture[][] | null = null;
  /** The weathering masks' packed map, which the finishes are not drawn without where the pack has them, or null. */
  private weatherMap: Texture | null = null;
  private readonly worldSample: WorldSample = (role, layer, u, v, spread, out) => {
    if (layer === WEATHER_LAYER) return this.weatherMap ? sample(this.weatherMap, u, v, spread, out) : void out.fill(0);
    sample(this.worldMaps![layer]![role]!, u, v, spread, out);
  };
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
  /**
   * Per pixel, a lit palette draw's colour and flags, projection footprint, position and geometric normal, and on the
   * ground (DEFERRED_GROUND) the normal it is lit by.
   */
  private readonly deferred: Uint16Array;
  private readonly deferredShade: Float64Array;
  /** 1 for a deferred pixel of a body, whose foot the sky's openness leaves alone (skyopen.ts). */
  private readonly deferredBody: Uint8Array;
  private readonly deferredAt: Float64Array;
  private readonly deferredNormal: Float64Array;
  /** On the ground, the other finish's tint where two meet, or -1, and how much of it is wanted. */
  private readonly deferredOther: Int16Array;
  private readonly deferredShare: Float32Array;
  /** On a weathered static (world-surfaces.ts `weathered`), its weatherFrame and its instance's seed, or a seed of -1. */
  private readonly deferredOwn: Float32Array;
  /** The instance being drawn, where the flat program weathers it: its yaw's cosine and sine, its origin from the eye, and its seed, or -1. */
  private ownC = 1;
  private ownS = 0;
  private readonly ownAt = new Float64Array(3);
  private ownSeed = -1;
  /** On a weathered static's triangle that knows its face's borders: which are outer, a corner's place and its corner of the face, and the face's way across and up per unit of vFace. */
  private edgeFlags = 0;
  private readonly edgeAt = new Float64Array(5);
  private readonly edgeU = new Float64Array(3);
  private readonly edgeV = new Float64Array(3);
  private readonly deferredEdge: Float32Array;
  /** On a lit frame, the tile being drawn: its vertices' normals (terrain.ts groundNormal), or null for any other draw. */
  private groundNormals: Float64Array | null = null;
  private readonly picture: GroundPicture = { i: 0, j: 0, step: 1, lastI: 0, lastJ: 0 };
  // A textured triangle's corners, and its clip scratch: per vertex what it carries, then screen x, y, 1/w and NDC depth.
  private readonly corners = new Float64Array(3 * CARRIED);
  private readonly wide = new Float64Array(5 * (CARRIED + 4));
  /** A particle's card: four corners, each its place and its corner of the card. */
  private readonly quad = new Float64Array(4 * 5);

  constructor(width: number, height: number, pack: Pack, hf: Heightfield, manifest: Manifest | null = null) {
    this.width = width;
    this.height = height;
    this.pack = pack;
    this.hf = hf;
    this.manifest = manifest;
    this.finish = finishTable(pack.palette, manifest ?? pack.header ?? { meshes: [] });
    this.color = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height);
    this.pickKind = new Uint8Array(width * height);
    this.pickId = new Float64Array(width * height);
    this.pickBone = new Uint8Array(width * height);
    this.pickDraw = new Int16Array(width * height);
    this.cover = new Float32Array(width * height);
    this.deferred = new Uint16Array(width * height);
    this.deferredShade = new Float64Array(width * height);
    this.deferredBody = new Uint8Array(width * height);
    this.deferredAt = new Float64Array(width * height * 6);
    this.deferredNormal = new Float64Array(width * height * 3);
    this.deferredOther = new Int16Array(width * height);
    this.deferredShare = new Float32Array(width * height);
    this.deferredOwn = new Float32Array(width * height * 4);
    this.deferredEdge = new Float32Array(width * height * 4);
  }

  render(packet: FramePacket): void {
    this.packet = packet;
    trueSun(packet.frame, this.sun);
    for (const u of packet.uploads) this.buffers.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
    for (const id of packet.drops) this.buffers.delete(id);
    // Far blocks come as levels of their own (far.ts), with a manifest or without.
    for (const piece of packet.assetUploads) {
      if (!this.manifest && piece.slot < FAR_SLOTS) continue;
      // A level or a surface in pieces is taken once its last is in.
      let u = piece;
      if (piece.whole !== undefined) {
        const whole = piece.at === 0 ? new Uint8Array(piece.whole) : this.coming.get(piece.slot);
        if (!whole) continue;
        whole.set(piece.data, piece.at);
        if (piece.at! + piece.data.length < piece.whole) {
          this.coming.set(piece.slot, whole);
          continue;
        }
        this.coming.delete(piece.slot);
        u = { ...piece, data: whole };
      }
      if (u.of === undefined) this.lods.set(u.slot, this.decodeUpload(u));
      else this.surfaces.set(u.of, { slot: u.slot, surface: surfaceOf(u.data.subarray(0, u.skinAt), u.data.subarray(u.skinAt ?? u.data.length), this.manifest!.meshes[u.mesh]!.uv) });
    }
    for (const slot of packet.assetDrops) {
      if (!this.manifest && slot < FAR_SLOTS) continue;
      this.lods.delete(slot);
      for (const [level, s] of this.surfaces) if (s.slot === slot) this.surfaces.delete(level);
    }
    // A texture that is let go goes first, with any copy of it being made. Then rows begin a copy, add to it or complete it.
    for (const slot of packet.texDrops) {
      this.textures.delete(slot);
      this.making.delete(slot);
    }
    for (const u of packet.texUploads) this.texture(u);
    const materials = (this.manifest ?? this.pack.header)?.materials ?? [];
    const finishes = SURFACE_NAMES.map((name) => materials.find((m) => m.id === surfaceMaterial(name)));
    const maps = finishes.map((m) => (m ? [m.base, m.normal, m.mro].map((t) => this.textures.get(t)) : []));
    const weather = materials.find((m) => m.id === WEATHER_MATERIAL);
    this.weatherMap = weather ? (this.textures.get(weather.mro) ?? null) : null;
    this.worldMaps = packet.lit && maps.every((roles) => roles.length === 3 && roles.every((t) => t)) && (!weather || this.weatherMap) ? (maps as Texture[][]) : null;
    if (packet.openWidth !== this.openWidth || packet.openHeight !== this.openHeight) {
      [this.openWidth, this.openHeight] = [packet.openWidth, packet.openHeight];
      this.open = new Uint8Array(this.openWidth * this.openHeight * OPEN_BYTES);
    }
    if (packet.openRows > 0) this.open.set(packet.openMap, packet.openRow * this.openWidth * OPEN_BYTES);
    if (packet.atlasRows > 0) {
      const rows = packet.atlas.subarray(0, packet.atlasRows * ATLAS_WIDTH * 4);
      if (this.atlas.length < rows.length) this.atlas = new Float32Array(rows.length);
      this.atlas.set(rows);
    }

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
    this.pickDraw.fill(-1);
    this.cover.fill(1);
    this.trianglesDrawn = 0;

    this.depthSteps = (2 ** this.depthBits - 1) / 2;
    this.plain = false;
    this.finishRow = 0;
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
      const ground = (this.deferred[at]! & DEFERRED_GROUND) !== 0;
      if (ground) smoothed.set(this.deferredNormal.subarray(at * 3, at * 3 + 3));
      const open = this.opened(s[g6]!, s[g6 + 1]!, s[g6 + 2]!, s[g6 + 3]!, s[g6 + 4]!, s[g6 + 5]!, ground, this.deferredBody[at] === 0);
      const own = this.deferredOwn.subarray(at * 4, at * 4 + 4), edge = this.deferredEdge.subarray(at * 4, at * 4 + 4);
      const over = own[3]! >= 0 ? overGround(this.hf, COARSE, p.frame, p.camY, s[g6]!, s[g6 + 1]!, s[g6 + 2]!) : 0;
      litFlat(p, this.pack.palette, (this.deferred[at]! & 511) - 1, 1, s[g6]!, s[g6 + 1]!, s[g6 + 2]!, s[g6 + 3]!, s[g6 + 4]!, s[g6 + 5]!, (this.deferred[at]! & 1024) === 0 && this.worldMaps ? this.worldSample : null, (this.deferred[at]! & 512) === 0, this.deferredShade[at]!, this.look, ground ? smoothed : null, this.finish, this.deferred[at]! >> DEFERRED_FINISH, open, ground ? this.deferredOther[at]! : -1, this.deferredShare[at]!, own, over, edge);
      for (let c = 0; c < 3; c++) this.color[at * 4 + c] = rgb[c]! * 255;
      this.deferred[at] = 0;
    }
  }

  /**
   * A static triangle's face as ownVertex reads it: its provoking corner's outer borders, and the face's way across and
   * up per unit of its corners (from the three corners' places and their corners of the face), kept for `owned`.
   * Returns the borders, 0 where the face says none.
   */
  private faceOf(pos: Float32Array, ia: number, ib: number, ic: number, bones: Uint8Array): number {
    const edges = (bones[ic]! >> 2) & 15;
    if (edges === 0) return 0;
    const u = [ia, ib, ic].map((v) => bones[v]! & 1), v = [ia, ib, ic].map((k) => (bones[k]! >> 1) & 1);
    const du1 = u[1]! - u[0]!, dv1 = v[1]! - v[0]!, du2 = u[2]! - u[0]!, dv2 = v[2]! - v[0]!, det = du1 * dv2 - du2 * dv1;
    if (det === 0) return 0;
    for (let a = 0; a < 3; a++) {
      const e1 = pos[ib * 3 + a]! - pos[ia * 3 + a]!, e2 = pos[ic * 3 + a]! - pos[ia * 3 + a]!;
      this.edgeU[a] = (e1 * dv2 - e2 * dv1) / det;
      this.edgeV[a] = (e2 * du1 - e1 * du2) / det;
      this.edgeAt[a] = pos[ia * 3 + a]!;
    }
    this.edgeAt[3] = u[0]!;
    this.edgeAt[4] = v[0]!;
    return edges;
  }

  /** Into `out`, the weatherFrame and seed of a point of the instance being drawn with that face's normal, or a seed of -1 where it is not weathered. */
  private owned(rx: number, ry: number, rz: number, nx: number, ny: number, nz: number, out: Float32Array): void {
    out[3] = this.ownSeed;
    edgeNow[0] = -1;
    if (this.ownSeed < 0) return;
    if (this.edgeFlags !== 0) {
      // The pixel's corner of its face from its place, as the face's way across and up give it.
      const pu = this.edgeU, pv = this.edgeV, dx = rx - this.edgeAt[0]!, dy = ry - this.edgeAt[1]!, dz = rz - this.edgeAt[2]!;
      const a = pu[0]! * pu[0]! + pu[1]! * pu[1]! + pu[2]! * pu[2]!, b = pu[0]! * pv[0]! + pu[1]! * pv[1]! + pu[2]! * pv[2]!, c = pv[0]! * pv[0]! + pv[1]! * pv[1]! + pv[2]! * pv[2]!;
      const e = pu[0]! * dx + pu[1]! * dy + pu[2]! * dz, f = pv[0]! * dx + pv[1]! * dy + pv[2]! * dz, det = a * c - b * b;
      if (det > 0) edgeOf(this.edgeAt[3]! + (c * e - b * f) / det, this.edgeAt[4]! + (a * f - b * e) / det, this.edgeFlags, pu, pv, edgeNow);
    }
    const c = this.ownC, s = this.ownS, dx = rx - this.ownAt[0]!, dz = rz - this.ownAt[2]!;
    weatherFrame(c * dx - s * dz, ry - this.ownAt[1]!, s * dx + c * dz, c * nx - s * nz, ny, s * nx + c * nz, out);
  }

  /**
   * The share of the sky's light the sky's openness leaves a camera-relative point with that face's normal, as the lit
   * programs take it (skyopen.ts): the ground's as the ground's, else at its height over the ground, with its foot
   * taken down where it `stands`.
   */
  private opened(rx: number, ry: number, rz: number, nx: number, ny: number, nz: number, ground: boolean, stands: boolean): number {
    const p = this.packet;
    if (ground) return skyOpen(this.open, this.openWidth, this.openHeight, p.frame, rx, rz, 0, 1, 0, 0, 0);
    return skyOpen(this.open, this.openWidth, this.openHeight, p.frame, rx, rz, nx, ny, nz, overGround(this.hf, COARSE, p.frame, p.camY, rx, ry, rz), stands ? 1 : 0);
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
    // The whole of `out`, which is never longer than the scratch: a view of its first corners would be made per triangle.
    spare.set(out);
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
    this.fade = this.hand = this.bone = 0;
    this.plain = false;
    this.finishRow = 0;
    this.drawing = -1;
    const row = TILE_QUADS + 1;
    const pos = new Float32Array(row * row * 3);
    const tint = new Uint8Array(row * row);
    // On a lit frame each vertex has the normal the ground is lit by, from the picture its tile reads.
    const normals = p.lit ? new Float64Array(row * row * 3) : null;
    const size = groundSize(hf);
    for (let t = 0; t < p.tileCount; t++) {
      if ((p.tilePass[t]! & (1 << range)) === 0) continue;
      const stride = p.tiles[t * 4 + 3]!;
      const i0 = p.tileOrigin[t * 2]!;
      const j0 = p.tileOrigin[t * 2 + 1]!;
      tilePicture(p, t, size, this.picture);
      for (let gz = 0; gz < row; gz++) {
        for (let gx = 0; gx < row; gx++) {
          const i = Math.min(i0 + gx * stride, hf.nx - 1);
          const j = Math.min(j0 + gz * stride, hf.nz - 1);
          const k = gz * row + gx;
          pos[k * 3] = i * hf.cell - p.camX;
          pos[k * 3 + 1] = hf.sample(i, j) - p.camY;
          pos[k * 3 + 2] = j * hf.cell - p.camZ;
          tint[k] = hf.tint[j * hf.nx + i]!;
          if (normals) groundNormal(hf, this.picture, i, j, stride, normals, k * 3);
        }
      }
      this.groundNormals = normals;
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
    this.groundNormals = null;
  }

  private draw(p: FramePacket, d: number): void {
    this.drawing = d;
    this.ownSeed = -1;
    [this.hand, this.handFrom, this.handTo] = [p.drawHand[d]!, p.frame[FRAME.handFrom]!, p.frame[FRAME.handTo]!];
    if ((p.drawFlags[d]! & DRAW_DETAILS) !== 0) return this.details(p, d);
    if ((p.drawFlags[d]! & DRAW_PULLED) !== 0) return this.pulled(p, d);
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
    this.plain = (p.drawFlags[d]! & DRAW_PLAIN) !== 0 || (p.lit && (p.drawFlags[d]! & (DRAW_SIZED | DRAW_PULLED)) !== 0);
    this.finishRow = (p.drawFlags[d]! & DRAW_PLAIN) !== 0 ? this.finish.row[p.drawMesh[d]!]! : 0;
    this.fade = p.drawFade[d]!;
    this.fadeShare = p.frame[FRAME.fade]!;
    // Far blocks, the far city and a landmark's far mesh short of where their reach fades draw with no fade, and are far all the same.
    const far = this.fade !== 0 || p.drawBuffer[d] === FAR_BUFFER || p.drawBuffer[d] === CITY_BUFFER || p.drawBuffer[d] === LANDMARK_BUFFER;
    const weathers = p.lit && p.tier.finish === "full" && !skinned && p.drawFade[d] === 0 && p.drawHand[d] === 0;
    const bones = p.bones;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const inst = p.drawFirst[d]! + k;
      const at = inst * INSTANCE_BYTES;
      if (skinned) {
        // Each vertex follows one bone of this instance's body, or with DRAW_ONE_BONE its bone of the pose it stands in and then its first.
        const first = view.getUint16(at + 12, true);
        const px = view.getFloat32(at, true), py = view.getFloat32(at + 4, true), pz = view.getFloat32(at + 8, true);
        for (let v = 0; v < n; v++) {
          let m: ArrayLike<number> = bones, b = (first + lod.bones[v]!) * BONE_FLOATS;
          if (one) {
            standing(bones, ox, lod.bones[v]!, first, stood);
            m = stood;
            b = 0;
          }
          const lx = lod.positions[v * 3]! + px, ly = lod.positions[v * 3 + 1]! + py, lz = lod.positions[v * 3 + 2]! + pz;
          out[v * 3] = m[b]! * lx + m[b + 1]! * ly + m[b + 2]! * lz + m[b + 3]!;
          out[v * 3 + 1] = m[b + 4]! * lx + m[b + 5]! * ly + m[b + 6]! * lz + m[b + 7]!;
          out[v * 3 + 2] = m[b + 8]! * lx + m[b + 9]! * ly + m[b + 10]! * lz + m[b + 11]!;
        }
      } else {
        const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
        const s = Math.sin(yaw);
        const c = Math.cos(yaw);
        const ix = view.getFloat32(at, true) + ox;
        const iy = view.getFloat32(at + 4, true) + oy;
        const iz = view.getFloat32(at + 8, true) + oz;
        this.handAt = Math.hypot(ix, iy, iz);
        // The flat program weathers a near static, which a far or handed-over draw's program does not (programs.ts drawProgram).
        if (weathers) {
          [this.ownC, this.ownS] = [c, s];
          this.ownAt.set([ix, iy, iz]);
          this.ownSeed = staticSeed(staticPlace(ix + p.camX, iz + p.camZ));
        }
        const k = sized ? data[at + 14 + SIZE_REGION]! / SIZE_UNITS : 1;
        for (let v = 0; v < n; v++) {
          const lx = lod.positions[v * 3]! * k;
          const lz = lod.positions[v * 3 + 2]! * k;
          out[v * 3] = c * lx + s * lz + ix;
          out[v * 3 + 1] = lod.positions[v * 3 + 1]! * k + iy;
          out[v * 3 + 2] = -s * lx + c * lz + iz;
        }
      }
      const kind = far ? PICK_FAR : transient ? PICK_ENTITY : PICK_STRUCTURE;
      const id = far ? p.drawSlot[d]! : transient ? p.transientIds[inst]! : p.drawBuffer[d]! * 65536 + buffer!.slots[inst]!;
      const ranged = (p.drawFlags[d]! & DRAW_RANGED) !== 0;
      const [from, end] = ranged ? [p.drawFirstIndex[d]!, p.drawFirstIndex[d]! + p.drawIndexCount[d]!] : [0, lod.indices.length];
      if (end > lod.indices.length) throw new Error(`draw ${d} runs past the indices of its level`);
      for (let t = from; t < end; t += 3) {
        const last = lod.indices[t + 2]!;
        let color = lod.colors[last]!;
        if (color >= REGION_BASE) color = data[at + 14 + color - REGION_BASE]!;
        this.bone = skinned ? lod.bones[last]! + 1 : 0;
        this.edgeFlags = this.ownSeed >= 0 ? this.faceOf(out, lod.indices[t]!, lod.indices[t + 1]!, last, lod.bones) : 0;
        this.triangle(out, lod.indices[t]!, lod.indices[t + 1]!, last, color, true, kind, id, (p.drawFlags[d]! & DRAW_BLEND) !== 0);
      }
    }
  }

  /**
   * A DRAW_DETAILS draw: each particle's card as the details program draws it (client/core/render/detailtext.ts). Its
   * picture is read from the atlas at the level each pixel's footprint asks for. A cut-out pixel is kept by its middle,
   * as any cut-out's is; `cover` is a half where the picture's edge crosses it.
   */
  private details(p: FramePacket, d: number): void {
    const blend = (p.drawFlags[d]! & DRAW_BLEND) !== 0;
    const [f, words] = [p.details, p.detailWords];
    const side = this.pack.header.details?.atlas.side ?? CELL;
    const atlas = detailsAtlas(this.pack);
    const cells = side / CELL;
    const [W, H, m] = [this.width, this.height, this.matrix];
    const src = this.quad;
    const poly = this.wide;
    const texel = [0, 0, 0, 0];
    const shape = [0, 0, 0];
    const [right, below] = [[0, 0], [0, 0]];
    const exposure = p.frame[FRAME.exposure]!;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const o = (p.drawFirst[d]! + k) * DETAIL_FLOATS;
      const misc = words[o + DETAIL.misc]!;
      const [cell, flags, shows, grey] = [misc & 255, (misc >>> 8) & 255, ((misc >>> 16) & 255) / 255, (misc >>> 24) / 255];
      const [a, b] = [words[o + DETAIL.colourA]!, words[o + DETAIL.colourB]!];
      const half = Math.hypot(f[o + DETAIL.along]!, f[o + DETAIL.along + 1]!, f[o + DETAIL.along + 2]!);
      // The corners in turn round the card, each its place and its corner.
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([cx, cy], c) => {
        for (let i = 0; i < 3; i++) src[c * 5 + i] = f[o + DETAIL.middle + i]! + cx! * f[o + DETAIL.across + i]! + cy! * f[o + DETAIL.along + i]!;
        [src[c * 5 + 3], src[c * 5 + 4]] = [cx!, cy!];
      });
      const count = this.clip(src, 4, 5, 5, poly, 9);
      if (count < 3) continue;
      for (let i = 0; i < count; i++) {
        const [x, y, z] = [poly[i * 9]!, poly[i * 9 + 1]!, poly[i * 9 + 2]!];
        const w = m[3]! * x + m[7]! * y + m[11]! * z;
        poly[i * 9 + 5] = (((m[0]! * x + m[4]! * y + m[8]! * z) / w) * 0.5 + 0.5) * W;
        poly[i * 9 + 6] = (0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z) / w) * 0.5) * H;
        poly[i * 9 + 7] = 1 / w;
        poly[i * 9 + 8] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
      }
      // Its normal, turned to the eye.
      const [ax, ay, az, bx, by, bz] = [f[o + DETAIL.along]!, f[o + DETAIL.along + 1]!, f[o + DETAIL.along + 2]!, f[o + DETAIL.across]!, f[o + DETAIL.across + 1]!, f[o + DETAIL.across + 2]!];
      let [nx, ny, nz] = [by * az - bz * ay, bz * ax - bx * az, bx * ay - by * ax];
      const nl = Math.hypot(nx, ny, nz) || 1;
      [nx, ny, nz] = [nx / nl, ny / nl, nz / nl];
      for (let t = 1; t + 1 < count; t++) {
        const [v0, v1, v2] = [0, t * 9, (t + 1) * 9];
        const [px0, py0, px1, py1, px2, py2] = [poly[v0 + 5]!, poly[v0 + 6]!, poly[v1 + 5]!, poly[v1 + 6]!, poly[v2 + 5]!, poly[v2 + 6]!];
        const area = (px1 - px0) * (py2 - py0) - (px2 - px0) * (py1 - py0);
        if (area === 0) continue;
        this.trianglesDrawn++;
        for (let py = Math.max(0, Math.floor(Math.min(py0, py1, py2))); py <= Math.min(H - 1, Math.ceil(Math.max(py0, py1, py2))); py++) {
          for (let px = Math.max(0, Math.floor(Math.min(px0, px1, px2))); px <= Math.min(W - 1, Math.ceil(Math.max(px0, px1, px2))); px++) {
            const [fx, fy] = [px + 0.5, py + 0.5];
            const e0 = ((px1 - fx) * (py2 - fy) - (px2 - fx) * (py1 - fy)) / area;
            const e1 = ((px2 - fx) * (py0 - fy) - (px0 - fx) * (py2 - fy)) / area;
            const e2 = 1 - e0 - e1;
            if (e0 < 0 || e1 < 0 || e2 < 0) continue;
            const at = py * W + px;
            const z = this.stored(e0 * poly[v0 + 8]! + e1 * poly[v1 + 8]! + e2 * poly[v2 + 8]!);
            if (z >= this.depth[at]!) continue;
            const [q0, q1, q2] = [e0 * poly[v0 + 7]!, e1 * poly[v1 + 7]!, e2 * poly[v2 + 7]!];
            const qs = 1 / (q0 + q1 + q2);
            if (blend && (flags & DETAIL_ROTOR) !== 0 && qs < this.from) continue;
            const carry = (j: number): number => (q0 * poly[v0 + j]! + q1 * poly[v1 + j]! + q2 * poly[v2 + j]!) * qs;
            const [rx, ry, rz, cx, cy] = [carry(0), carry(1), carry(2), carry(3), carry(4)];
            // The level the pixel's footprint in the picture asks for, from the corner a pixel right and a pixel down, as derivatives give it.
            const corner = (gx: number, gy: number, out: number[]): void => {
              const g0 = ((px1 - gx) * (py2 - gy) - (px2 - gx) * (py1 - gy)) / area;
              const g1 = ((px2 - gx) * (py0 - gy) - (px0 - gx) * (py2 - gy)) / area;
              const [w0, w1, w2] = [g0 * poly[v0 + 7]!, g1 * poly[v1 + 7]!, (1 - g0 - g1) * poly[v2 + 7]!];
              const ws = 1 / (w0 + w1 + w2);
              out[0] = (w0 * poly[v0 + 3]! + w1 * poly[v1 + 3]! + w2 * poly[v2 + 3]!) * ws;
              out[1] = (w0 * poly[v0 + 4]! + w1 * poly[v1 + 4]! + w2 * poly[v2 + 4]!) * ws;
            };
            corner(fx + 1, fy, right);
            corner(fx, fy + 1, below);
            const footprint = (Math.max(Math.hypot(right[0]! - cx, right[1]! - cy), Math.hypot(below[0]! - cx, below[1]! - cy)) * CELL) / 2;
            const level = Math.min(MOST_LOD, Math.max(0, Math.log2(Math.max(footprint, 1e-6))));
            if ((flags & DETAIL_ROTOR) !== 0) {
              rotorOf(cx, cy, grey, shape);
              [texel[0], texel[1], texel[2], texel[3]] = [shape[2]!, shape[1]!, 0, shape[0]!];
            }
            else if (p.lit) this.detailTexel(atlas, side, cells, cell, cx, cy, level, texel);
            else {
              shapeOf(flags & 7, cx, cy, shape);
              [texel[0], texel[1], texel[2], texel[3]] = [shape[2]!, shape[1]!, 0, shape[0]!];
            }
            let alpha = texel[3]!;
            if (blend) {
              alpha *= shows * ((flags & DETAIL_PUFF) !== 0 ? Math.min(1, Math.max(0, (ry - f[o + DETAIL.floor]!) / (0.5 * half))) : 1);
              if (alpha < 0.004) continue;
            } else if (!detailKeeps(shows, px, H - 1 - py) || alpha < 0.5) continue;
            const dist = Math.hypot(rx, ry, rz);
            const [vx, vy, vz] = [-rx / dist, -ry / dist, -rz / dist];
            if ((flags & DETAIL_PUFF) !== 0) {
              const l = Math.hypot(0.6 * vx, 1 + 0.6 * vy, 0.6 * vz);
              [normal[0], normal[1], normal[2]] = [(0.6 * vx) / l, (1 + 0.6 * vy) / l, (0.6 * vz) / l];
            } else {
              const s = nx * vx + ny * vy + nz * vz < 0 ? -1 : 1;
              [normal[0], normal[1], normal[2]] = [nx * s, ny * s, nz * s];
            }
            const mixed = (word: number, c: number): number => (word >>> (c * 8)) & 255;
            if (p.lit) {
              const shade = srgbToLinear(texel[0]!);
              for (let c = 0; c < 3; c++) {
                const dye = (srgbToLinear(mixed(a, c) / 255) * (1 - texel[1]!) + srgbToLinear(mixed(b, c) / 255) * texel[1]!) / ((flags & DETAIL_ROTOR) !== 0 ? 1 : grey);
                albedo[c] = shade * (dye * (1 - texel[2]!) + texel[2]!);
              }
              [eye[0], eye[1], eye[2]] = [vx, vy, vz];
              if ((flags & DETAIL_LIT) !== 0) lit(light, albedo, ROUGH, normal, eye, p.frame, NOTHING);
              else for (let c = 0; c < 3; c++) light[c] = albedo[c]! / exposure;
              shown(rgb, light, dist, p);
              for (let c = 0; c < 3; c++) rgb[c]! *= 255;
            } else {
              const sun = (flags & DETAIL_LIT) !== 0 ? (AMBIENT + DIFFUSE * Math.max(0, normal[0]! * p.sun[0]! + normal[1]! * p.sun[1]! + normal[2]! * p.sun[2]!)) * p.light : 1;
              let fog = (dist - p.fogStart) / (p.fogEnd - p.fogStart);
              fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
              for (let c = 0; c < 3; c++) rgb[c] = (mixed(a, c) * (1 - texel[1]!) + mixed(b, c) * texel[1]!) * texel[0]! * sun * (1 - fog) + p.sky[c]! * 255 * fog;
            }
            const o4 = at * 4;
            if (blend) for (let c = 0; c < 3; c++) this.color[o4 + c] = this.color[o4 + c]! + (rgb[c]! - this.color[o4 + c]!) * alpha;
            else {
              for (let c = 0; c < 3; c++) this.color[o4 + c] = rgb[c]!;
              this.depth[at] = z;
              this.deferred[at] = 0;
              this.pickKind[at] = PICK_ENTITY;
              this.pickId[at] = 0;
              this.pickBone[at] = 0;
              this.pickDraw[at] = this.drawing;
              this.cover[at] = Math.abs(alpha - 0.5) < 0.25 ? 0.5 : 1;
            }
          }
        }
      }
    }
  }

  /** The atlas at corner (cx, cy) of `cell`, read between texels and between its two levels nearest `level`, as the card reads it. */
  private detailTexel(atlas: Uint8Array, side: number, cells: number, cell: number, cx: number, cy: number, level: number, out: number[]): void {
    const u = ((cell % cells) + cx * 0.5 + 0.5) / cells;
    const v = (Math.floor(cell / cells) - cy * 0.5 + 0.5) / cells;
    out.fill(0);
    const whole = Math.floor(level);
    for (const [l, weight] of [[whole, 1 - (level - whole)], [whole + 1, level - whole]] as const) {
      if (weight <= 0) continue;
      const s = side >> l;
      const base = mipOffset(side, l);
      const [x, y] = [u * s - 0.5, v * s - 0.5];
      const [i, j] = [Math.floor(x), Math.floor(y)];
      const [fx, fy] = [x - i, y - j];
      for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
        const at = base + (Math.min(s - 1, Math.max(0, j + dj)) * s + Math.min(s - 1, Math.max(0, i + di))) * 4;
        for (let c = 0; c < 4; c++) out[c]! += (atlas[at + c]! / 255) * w * weight;
      }
    }
  }

  /**
   * A DRAW_PULLED draw: each instance as its mesh's row of the atlas, as PULLED_VERTEX reads it, to the row's reach and
   * faded over the last of it.
   */
  private pulled(p: FramePacket, d: number): void {
    const buffer = this.buffers.get(p.drawBuffer[d]!);
    if (!buffer) throw new Error(`draw ${d} uses buffer ${p.drawBuffer[d]} which was never uploaded`);
    const { data } = buffer;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const [ox, oy, oz] = [p.drawOffset[d * 3]!, p.drawOffset[d * 3 + 1]!, p.drawOffset[d * 3 + 2]!];
    this.plain = (p.drawFlags[d]! & DRAW_PLAIN) !== 0 || (p.lit && (p.drawFlags[d]! & (DRAW_SIZED | DRAW_PULLED)) !== 0);
    this.finishRow = 0;
    this.fadeShare = p.frame[FRAME.fade]!;
    this.bone = 0;
    const out = this.scratch.length >= ATLAS_WIDTH * 3 ? this.scratch : (this.scratch = new Float32Array(ATLAS_WIDTH * 3));
    const atlas = this.atlas;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const inst = p.drawFirst[d]! + k;
      const at = inst * INSTANCE_BYTES;
      const row = data[at + 14 + ATLAS_REGION]! * ATLAS_WIDTH * 4;
      const [ix, iy, iz] = [view.getFloat32(at, true) + ox, view.getFloat32(at + 4, true) + oy, view.getFloat32(at + 8, true) + oz];
      this.handAt = Math.hypot(ix, iy, iz);
      this.fade = atlas[row]!;
      if (this.handAt >= this.fade) continue;
      const n = atlas[row + 1]!;
      const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
      const [s, c] = [Math.sin(yaw), Math.cos(yaw)];
      const size = data[at + 14 + SIZE_REGION]! / SIZE_UNITS;
      for (let v = 0; v < n; v++) {
        const o = row + (v + 1) * 4;
        const [lx, ly, lz] = [atlas[o]! * size, atlas[o + 1]! * size, atlas[o + 2]! * size];
        out[v * 3] = c * lx + s * lz + ix;
        out[v * 3 + 1] = ly + iy;
        out[v * 3 + 2] = -s * lx + c * lz + iz;
      }
      for (let v = 0; v + 2 < n; v += 3) {
        let color = atlas[row + (v + 3) * 4 + 3]!;
        if (color >= REGION_BASE) color = color - REGION_BASE < ATLAS_REGION ? data[at + 14 + color - REGION_BASE]! : 0;
        this.triangle(out, v, v + 1, v + 2, color, true, PICK_FAR, p.drawSlot[d]!);
      }
    }
  }

  private decode(mesh: number, level: number, slot: number): DecodedLod {
    if (this.manifest || slot >= FAR_SLOTS) {
      const lod = this.lods.get(slot);
      if (!lod) throw new Error(`a draw of ${(this.manifest ?? this.pack.header).meshes[mesh]!.id} at level ${level}, which is not on the graphics card`);
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

  /** A level from the bytes a packet uploads: its indices, padded to a multiple of 4, and then its vertices; or of quads, its vertices alone. */
  private decodeUpload(u: AssetUpload): DecodedLod {
    const view = new DataView(u.data.buffer, u.data.byteOffset, u.data.byteLength);
    const indices = u.quads ? Uint32Array.from(quadIndices(u.indexCount, 4).subarray(0, u.indexCount)) : new Uint32Array(u.indexCount);
    for (let i = 0; !u.quads && i < indices.length; i++) indices[i] = u.indexBytes === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
    const verts = u.data.subarray(u.quads ? 0 : (u.indexCount * u.indexBytes + 3) & ~3);
    return { ...vertices(verts, verts.length / VERTEX_BYTES, u.bounds ?? (this.manifest ?? this.pack.header).meshes[u.mesh]!), indices };
  }

  /**
   * Takes rows of a copy of a texture. The first row of its one-pixel picture begins the copy, and the upload marked
   * `last` puts it in its slot, where the copy before it was drawn with until then.
   */
  private texture(u: TextureUpload): void {
    if (u.format !== "rgba") throw new Error(`texture ${u.slot} comes as ${u.format}, and only the rgba variant is read here`);
    if (u.size === 1 && u.row === 0) {
      const pictures: Uint8Array[] = [];
      for (let size = 1; size <= u.top; size <<= 1) pictures.push(new Uint8Array(pictureBytes("rgba", u.role, size, 1)));
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
    const maps = MAP_ROLES.map((role, k) => {
      const t = this.textures.get(material[role]);
      if (!t && material[role] >= 0 && role !== "normal" && role !== "mro") throw new Error(`draw ${d} uses ${material.id}, whose ${role} texture is not on the graphics card`);
      return t ?? NEUTRALS[k]!;
    });
    const level = p.drawLayer[d]!;
    const layer = level > 0 ? (this.textures.get(material.layer ?? -1) ?? null) : null;
    if (level > 0 && !layer) throw new Error(`draw ${d} draws the layer of ${material.id}, which is not on the graphics card`);
    const wear = layer ? p.drawWear[d]! : 0;
    const { center, half } = (this.manifest ?? this.pack.header).meshes[p.drawMesh[d]!]!;
    const box = wear === 0 ? null : lod.positions.map((x, i) => (x - center[i % 3]!) / half[i % 3]!);
    const s: Surfaced = { maps, layer, level: level / LAYER_LEVELS, wear, box, tint: material.tint, cutoff: (flags & DRAW_CUTOUT) !== 0 ? material.cutoff : 0, sheet: material.sheet ?? 0, twoSided: (flags & DRAW_TWO_SIDED) !== 0, uvs: surface.uvs, tangents: surface.tangents };
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
      this.handAt = Math.hypot(view.getFloat32(at, true) + p.drawOffset[d * 3]!, view.getFloat32(at + 4, true) + p.drawOffset[d * 3 + 1]!, view.getFloat32(at + 8, true) + p.drawOffset[d * 3 + 2]!);
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
      } else if (mode === 2) standing(p.bones, p.drawOffset[d * 3]!, lod.bones[v]!, first, m);
      else if (mode > 0) {
        const b = (first + lod.bones[v]!) * BONE_FLOATS;
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
    tri[0] = ax;
    tri[1] = ay;
    tri[2] = az;
    tri[7] = bx;
    tri[8] = by;
    tri[9] = bz;
    tri[14] = cx;
    tri[15] = cy;
    tri[16] = cz;
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
    const axis = Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz)) ? 1 : Math.abs(nx) > Math.abs(nz) ? 0 : 2;
    const uc = axis === 0 ? 2 : 0, vc = axis === 1 ? 2 : 1;
    // The ground's vertices' normals are blended across the triangle by where a pixel lies over it, as the GPU blends them.
    const ground = this.groundNormals;
    const across = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);

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
      const e0x = (y1 - y2) * inv, e1x = (y2 - y0) * inv, e0y = (x2 - x1) * inv, e1y = (x0 - x2) * inv;
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
          const rx = (q0 * poly[v0]! + q1 * poly[v1]! + q2 * poly[v2]!) * qs;
          const ry = (q0 * poly[v0 + 1]! + q1 * poly[v1 + 1]! + q2 * poly[v2 + 1]!) * qs;
          const rz = (q0 * poly[v0 + 2]! + q1 * poly[v1 + 2]! + q2 * poly[v2 + 2]!) * qs;
          const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
          // A far draw drops its fragment as FAR_FADE does, before anything is kept of it. The pattern counts rows from the bottom.
          if (this.fade !== 0 && !fadeKeeps(dist, this.fade, this.fadeShare, px, H - 1 - py)) continue;
          if (this.hand !== 0 && nearKeeps(this.handAt, this.handFrom, this.handTo, px, H - 1 - py) !== this.hand > 0) continue;
          if (!blend) {
            this.depth[at] = z;
            this.pickKind[at] = pickKind;
            this.pickId[at] = pickId;
            this.pickBone[at] = this.bone;
            this.pickDraw[at] = this.drawing;
            this.cover[at] = 1;
          }
          const wx = rx + sx, wy = solid ? ry + sy : 0, wz = rz + sz;
          let shade = 1;
          const cs = CHECK_COARSE_SIZE;
          if (this.plain || p.lit) shade = 1;
          else {
            if (((Math.floor(wx) + Math.floor(wy) + Math.floor(wz)) & 1) !== 0) shade -= (1 - CHECK_FINE) * Math.max(0, 1 - dist / CHECK_FINE_FADE);
            if (((Math.floor(wx / cs) + Math.floor(wy / cs) + Math.floor(wz / cs)) & 1) !== 0) shade -= (1 - CHECK_COARSE) * Math.max(0, 1 - dist / CHECK_COARSE_FADE);
          }
          // Metres a pixel covers on the finish's projection, and on the ground's level for its cover's wander.
          let footprint = 0;
          let reach = 0;
          if (p.lit && ((this.worldMaps && !this.plain) || ground)) {
            const r0 = (e0 + e0x) * poly[v0 + 5]!, r1 = (e1 + e1x) * poly[v1 + 5]!, r2 = (e2 - e0x - e1x) * poly[v2 + 5]!;
            const d0 = (e0 + e0y) * poly[v0 + 5]!, d1 = (e1 + e1y) * poly[v1 + 5]!, d2 = (e2 - e0y - e1y) * poly[v2 + 5]!;
            const u = axis === 0 ? rz : rx, v = axis === 1 ? rz : ry;
            const ux = (r0 * poly[v0 + uc]! + r1 * poly[v1 + uc]! + r2 * poly[v2 + uc]!) / (r0 + r1 + r2) - u;
            const vx = (r0 * poly[v0 + vc]! + r1 * poly[v1 + vc]! + r2 * poly[v2 + vc]!) / (r0 + r1 + r2) - v;
            const uy = (d0 * poly[v0 + uc]! + d1 * poly[v1 + uc]! + d2 * poly[v2 + uc]!) / (d0 + d1 + d2) - u;
            const vy = (d0 * poly[v0 + vc]! + d1 * poly[v1 + vc]! + d2 * poly[v2 + vc]!) / (d0 + d1 + d2) - v;
            footprint = Math.max(Math.hypot(ux, vx), Math.hypot(uy, vy));
            if (ground && axis === 1) reach = footprint;
            else if (ground) {
              const xx = (r0 * poly[v0]! + r1 * poly[v1]! + r2 * poly[v2]!) / (r0 + r1 + r2) - rx, zx = (r0 * poly[v0 + 2]! + r1 * poly[v1 + 2]! + r2 * poly[v2 + 2]!) / (r0 + r1 + r2) - rz;
              const xy = (d0 * poly[v0]! + d1 * poly[v1]! + d2 * poly[v2]!) / (d0 + d1 + d2) - rx, zy = (d0 * poly[v0 + 2]! + d1 * poly[v1 + 2]! + d2 * poly[v2 + 2]!) / (d0 + d1 + d2) - rz;
              reach = Math.max(Math.hypot(xx, zx), Math.hypot(xy, zy));
            }
          }
          if (p.lit && !blend) {
            // Only what ends in front is shaded, once the opaque draws are done (`resolve`). The ground's cover is chosen here.
            const s = this.deferredAt;
            const g6 = at * 6;
            const tint = ground ? groundPair(this.hf, this.picture, rx + p.camX, rz + p.camZ, reach, p.surfaceCity[7] !== 0, meet) : colorIndex;
            this.deferredOther[at] = ground ? meet[0]! : -1;
            this.deferredShare[at] = ground ? meet[1]! : 0;
            this.owned(rx, ry, rz, nx, ny, nz, ownNow);
            this.deferredOwn.set(ownNow, at * 4);
            this.deferredEdge.set(edgeNow, at * 4);
            this.deferred[at] = (tint + 1) | (solid ? 512 : 0) | (this.plain ? 1024 : 0) | (ground ? DEFERRED_GROUND : 0) | (this.finishRow << DEFERRED_FINISH);
            this.deferredBody[at] = this.bone > 0 ? 1 : 0;
            this.deferredShade[at] = footprint;
            s[g6] = rx;
            s[g6 + 1] = ry;
            s[g6 + 2] = rz;
            s[g6 + 3] = nx;
            s[g6 + 4] = ny;
            s[g6 + 5] = nz;
            if (ground) {
              const wb = ((rx - ax) * (cz - az) - (cx - ax) * (rz - az)) / across;
              const wc = ((bx - ax) * (rz - az) - (rx - ax) * (bz - az)) / across;
              const wa = 1 - wb - wc;
              const gx = wa * ground[ia * 3]! + wb * ground[ib * 3]! + wc * ground[ic * 3]!;
              const gy = wa * ground[ia * 3 + 1]! + wb * ground[ib * 3 + 1]! + wc * ground[ic * 3 + 1]!;
              const gz = wa * ground[ia * 3 + 2]! + wb * ground[ib * 3 + 2]! + wc * ground[ic * 3 + 2]!;
              const gl = Math.hypot(gx, gy, gz);
              this.deferredNormal[at * 3] = gx / gl;
              this.deferredNormal[at * 3 + 1] = gy / gl;
              this.deferredNormal[at * 3 + 2] = gz / gl;
            }
            continue;
          }
          let fog = (dist - p.fogStart) / fogSpan;
          fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
          const o = at * 4;
          let cr = r * shade * (1 - fog) + p.sky[0]! * 255 * fog;
          let cg = g * shade * (1 - fog) + p.sky[1]! * 255 * fog;
          let cb = b * shade * (1 - fog) + p.sky[2]! * 255 * fog;
          if (p.lit) {
            this.owned(rx, ry, rz, nx, ny, nz, ownNow);
            const over = ownNow[3]! >= 0 ? overGround(this.hf, COARSE, p.frame, p.camY, rx, ry, rz) : 0;
            litFlat(p, pal, colorIndex, shade, rx, ry, rz, nx, ny, nz, !this.plain && this.worldMaps ? this.worldSample : null, !solid, footprint, this.look, null, this.finish, this.finishRow, this.opened(rx, ry, rz, nx, ny, nz, false, this.bone === 0), -1, 0, ownNow, over, edgeNow);
            cr = rgb[0]! * 255;
            cg = rgb[1]! * 255;
            cb = rgb[2]! * 255;
          }
          if (blend) {
            // A landmark's see-through draw shows its finish's share (shared/pack/finish.ts), as LIT_MESH_FRAGMENT has it.
            const share = this.finishRow > 0 ? this.finish.pixels[((2 * this.finishRow - 1) * 256 + colorIndex) * 4 + 3]! : 0;
            const alpha = this.finishRow === 0 ? WATER_ALPHA : p.lit && share > 0 ? share / 255 : 1;
            this.color[o] = this.color[o]! + (cr - this.color[o]!) * alpha;
            this.color[o + 1] = this.color[o + 1]! + (cg - this.color[o + 1]!) * alpha;
            this.color[o + 2] = this.color[o + 2]! + (cb - this.color[o + 2]!) * alpha;
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
      for (let i = 0; i < 3; i++) src[o + 12 + i] = s.box ? s.box[v * 3 + i]! : 0;
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

    const [base, bump, mro, mask, mask2, layer] = texel as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
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
          if (this.hand !== 0 && nearKeeps(this.handAt, this.handFrom, this.handTo, px, H - 1 - py) !== this.hand > 0) continue;
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
          this.pickDraw[at] = this.drawing;
          this.cover[at] = s.cutoff > 0 ? covered(s.maps[0]!, base[3]!, s.cutoff, u, v, ux, vx, uy, vy, spread) : 1;
          sample(s.maps[1]!, u, v, spread, bump);
          sample(s.maps[2]!, u, v, spread, mro);
          sample(s.maps[3]!, u, v, spread, mask);
          sample(s.maps[4]!, u, v, spread, mask2);
          const dist = Math.hypot(carried[0]!, carried[1]!, carried[2]!);
          for (let i = 0; i < 3; i++) eye[i] = -carried[i]! / dist;
          dyed(albedo, base, s.tint, this.dyes, mask, mask2);
          if (s.layer) {
            sample(s.layer, u, v, spread, layer);
            wounded(albedo, mro, layer, s.level, wearLate(s.wear, carried[12]!, carried[13]!, carried[14]!));
          }
          bumped(normal, carriedNormal, carriedTangent, bump[0]!, bump[1]!, back);
          const twice = 2 * (normal[0]! * eye[0]! + normal[1]! * eye[1]! + normal[2]! * eye[2]!);
          for (let i = 0; i < 3; i++) reflected[i] = twice * normal[i]! - eye[i]!;
          skyFrom(mirrored, p.frame, reflected, this.look);
          const nl = (back ? -1 : 1) / Math.hypot(carriedNormal[0]!, carriedNormal[1]!, carriedNormal[2]!);
          const open = this.opened(carried[0]!, carried[1]!, carried[2]!, carriedNormal[0]! * nl, carriedNormal[1]! * nl, carriedNormal[2]! * nl, false, bone === 0);
          opened.set([mro[0]! * open, mro[1]!, mro[2]!]);
          lit(light, albedo, opened, normal, eye, p.frame, mirrored);
          through(light, albedo, mro, normal, p.frame, s.sheet);
          shown(rgb, light, dist, p);
          this.color[at * 4] = rgb[0]! * 255;
          this.color[at * 4 + 1] = rgb[1]! * 255;
          this.color[at * 4 + 2] = rgb[2]! * 255;
        }
      }
    }
  }

  /**
   * The depth map of shadow cascade `k` of the frame last rendered, `size` texels a side, drawn from its caster list and
   * the tiles that cast into it: 0 nearest the sun to 1, and 1 where nothing casts. Row 0 is the square's -y edge in the
   * light space. Faces turned to the sun are left out, since back faces cast, but on two-sided casters, and what lies
   * between the sun and the square is flattened onto its near face. Bodies follow one bone a vertex, and cut-out
   * casters are drawn whole.
   */
  cascade(p: FramePacket, k: number, size: number): Float32Array {
    const out = new Float32Array(size * size).fill(1);
    const m = p.cascades.subarray(k * 16, k * 16 + 16);
    const hf = this.hf;
    const row = TILE_QUADS + 1;
    const pos = new Float32Array(row * row * 3);
    for (let t = 0; t < p.tileCount; t++) {
      if ((p.tilePass[t]! & (TILE_CASTS << k)) === 0) continue;
      const stride = p.tiles[t * 4 + 3]!;
      for (let gz = 0; gz < row; gz++) {
        for (let gx = 0; gx < row; gx++) {
          const i = Math.min(p.tileOrigin[t * 2]! + gx * stride, hf.nx - 1);
          const j = Math.min(p.tileOrigin[t * 2 + 1]! + gz * stride, hf.nz - 1);
          pos.set([i * hf.cell - p.camX, hf.sample(i, j) - p.camY, j * hf.cell - p.camZ], (gz * row + gx) * 3);
        }
      }
      for (let a = 0; a < row * TILE_QUADS; a++) {
        if (a % row === TILE_QUADS) continue;
        this.castTriangle(out, size, m, pos, a + row + 1, a + 1, a, false);
        this.castTriangle(out, size, m, pos, a + row, a + row + 1, a, false);
      }
    }
    for (let e = 0; e < p.casterCount; e++) {
      if ((p.casterCascades[e]! & (1 << k)) === 0) continue;
      const flags = p.casterFlags[e]!;
      const lod = this.decode(p.casterMesh[e]!, p.casterLod[e]!, p.casterSlot[e]!);
      const transient = p.casterBuffer[e] === TRANSIENT_BUFFER;
      const buffer = transient ? null : this.buffers.get(p.casterBuffer[e]!);
      if (!transient && !buffer) throw new Error(`caster ${e} uses buffer ${p.casterBuffer[e]} which was never uploaded`);
      const data = transient ? p.transient : buffer!.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const run = (flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
      const [from, to] = run ? [p.casterFirstIndex[e]!, p.casterFirstIndex[e]! + p.casterIndexCount[e]!] : [0, lod.indices.length];
      const n = lod.positions.length / 3;
      const place = new Float32Array(n * 3);
      for (let c = 0; c < p.casterInstances[e]!; c++) {
        const at = (p.casterFirst[e]! + c) * INSTANCE_BYTES;
        const px = view.getFloat32(at, true), py = view.getFloat32(at + 4, true), pz = view.getFloat32(at + 8, true);
        if ((flags & DRAW_SKINNED) !== 0) {
          const first = view.getUint16(at + 12, true);
          for (let v = 0; v < n; v++) {
            let m: ArrayLike<number> = p.bones, b = (first + lod.bones[v]!) * BONE_FLOATS;
            if ((flags & DRAW_ONE_BONE) !== 0) {
              standing(p.bones, p.casterOffset[e * 3]!, lod.bones[v]!, first, stood);
              m = stood;
              b = 0;
            }
            const [lx, ly, lz] = [lod.positions[v * 3]! + px, lod.positions[v * 3 + 1]! + py, lod.positions[v * 3 + 2]! + pz];
            for (let r = 0; r < 3; r++) place[v * 3 + r] = m[b + r * 4]! * lx + m[b + r * 4 + 1]! * ly + m[b + r * 4 + 2]! * lz + m[b + r * 4 + 3]!;
          }
        } else {
          const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
          const [s, co] = [Math.sin(yaw), Math.cos(yaw)];
          const grow = (flags & DRAW_SIZED) !== 0 ? data[at + 14 + SIZE_REGION]! / SIZE_UNITS : 1;
          const [ix, iy, iz] = [px + p.casterOffset[e * 3]!, py + p.casterOffset[e * 3 + 1]!, pz + p.casterOffset[e * 3 + 2]!];
          for (let v = 0; v < n; v++) {
            const [lx, ly, lz] = [lod.positions[v * 3]! * grow, lod.positions[v * 3 + 1]! * grow, lod.positions[v * 3 + 2]! * grow];
            place.set([co * lx + s * lz + ix, ly + iy, -s * lx + co * lz + iz], v * 3);
          }
        }
        for (let t = from; t < to; t += 3) this.castTriangle(out, size, m, place, lod.indices[t]!, lod.indices[t + 1]!, lod.indices[t + 2]!, (flags & DRAW_TWO_SIDED) !== 0);
      }
    }
    return out;
  }

  /** One triangle of camera-relative corners into a cascade's depth map through its matrix `m`. */
  private castTriangle(out: Float32Array, size: number, m: Float32Array, pos: Float32Array, ia: number, ib: number, ic: number, twoSided: boolean): void {
    const corner = (i: number, row: number): number => m[row]! * pos[i * 3]! + m[4 + row]! * pos[i * 3 + 1]! + m[8 + row]! * pos[i * 3 + 2]! + m[12 + row]!;
    const [ax, ay, bx, by, cx, cy] = [corner(ia, 0), corner(ia, 1), corner(ib, 0), corner(ib, 1), corner(ic, 0), corner(ic, 1)];
    // Seen from the sun, counter-clockwise faces it.
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0 || (area > 0 && !twoSided)) return;
    const [az, bz, cz] = [ia, ib, ic].map((i) => Math.max(-1, corner(i, 2))) as [number, number, number];
    const t = (v: number): number => ((v + 1) / 2) * size;
    const [u0, v0, u1, v1, u2, v2] = [t(ax), t(ay), t(bx), t(by), t(cx), t(cy)];
    const inv = 1 / ((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0));
    for (let j = Math.max(0, Math.floor(Math.min(v0, v1, v2))); j <= Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2))); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(u0, u1, u2))); i <= Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2))); i++) {
        const [x, y] = [i + 0.5, j + 0.5];
        const e0 = ((u1 - x) * (v2 - y) - (u2 - x) * (v1 - y)) * inv;
        const e1 = ((u2 - x) * (v0 - y) - (u0 - x) * (v2 - y)) * inv;
        const e2 = 1 - e0 - e1;
        if (e0 < 0 || e1 < 0 || e2 < 0) continue;
        const d = ((e0 * az + e1 * bz + e2 * cz) + 1) / 2;
        if (d <= 1 && d < out[j * size + i]!) out[j * size + i] = d;
      }
    }
  }
}
