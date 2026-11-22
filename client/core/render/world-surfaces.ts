import { fixtureShader } from "./street-finish.ts";
// Metre-space materials for terrain and meshes without authored surfaces. CPU and GLSL deliberately use the same
// projection, integer hash, noises, blends and weather fields. There is no animation clock here.
import { MASK_MATERIALS, REPAIRS_LAYER, ROAD_LAYER, ROAD_LOOK, SURFACE_CITIES, SURFACE_FINISHES, SURFACE_GROUPS, SURFACE_NAMES, SURFACE_WEATHERING, WALK_LOOK, MASK_LAYER, surfaceIndex, surfaceMaterial } from "../../../content/surfaces.ts";
import { TERRAIN_CELL } from "../../../shared/world/heightfield.ts";
import { hash3, hash32 } from "../texgen/noise.ts";
import { WEATHER_BAY, WEATHER_BAYS, WEATHER_FIELD, WEATHER_FIELDS, WEATHER_LAYERS, WEATHER_PAD, WEATHER_STOREY, WEATHER_TWIN_SIDE, weatherRead } from "../texgen/weather.ts";
import { ROAD_ACROSS, ROAD_ALONG, ROAD_CELL, ROAD_HALF, ROAD_ONE_WAY, ROAD_PLANES, ROAD_STEP, ROAD_WEAR_SHIFT, ROAD_WRAP, type RoadSectors } from "../../../shared/world/roadframe.ts";
import type { PackMaterial, PackTexture } from "../../../shared/pack/pack.ts";
import { STEP0_SIZE, topIn, type TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import { WEIGHT } from "../assets/residency.ts";
import { FRAME, WORLD_LAYERS, type FramePacket } from "./packet.ts";
import { srgbToLinear } from "./surface.ts";
import { CHUNK_SIDE, PAVED_VERGE, PLANE_MOST, PLANE_STEP, STREET_TINT, VERGE_TINTS, WALK_TINT } from "../../../shared/world/streets.ts";
import { STREET_CHUNKS, STREET_SIDE } from "./streets.ts";

type Out = Float64Array;
type Numbers = ArrayLike<number>;
/** A finish this smooth or smoother, its wetness's share taken off, mirrors the sky table; a rougher one mirrors the sky's light in that direction. */
export const WORLD_SHARP = 0.6;
/**
 * Each finish's painted occlusion, roughness and metal, its packed map's one-pixel mip, of 255: what a finish read from
 * afar, and the touch rule's light finish, which read no packed map, are lit with.
 */
export const WORLD_MRO: readonly (readonly [number, number, number])[] = [
  [240, 225, 0], [251, 246, 0], [183, 221, 0], [242, 184, 0], [217, 237, 0], [234, 238, 0], [233, 225, 0], [195, 225, 0],
  [254, 225, 0], [239, 233, 0], [207, 192, 0], [249, 217, 0], [255, 161, 1], [254, 205, 0], [245, 221, 0], [255, 54, 0],
  [254, 214, 0],
];
/**
 * Each finish's base colour and tint mask, its base colour map's one-pixel mip as stored (sRGB): what a finish is drawn
 * as before any of its maps has come, so that what comes sharpens it and never colours it otherwise.
 */
export const WORLD_BASE: readonly (readonly [number, number, number, number])[] = [
  [98, 110, 48, 223], [206, 183, 158, 255], [128, 102, 77, 204], [93, 74, 60, 253], [125, 125, 123, 251], [150, 134, 116, 125], [96, 96, 93, 104], [128, 125, 119, 218],
  [137, 134, 126, 253], [160, 113, 89, 211], [143, 91, 68, 204], [124, 80, 60, 1], [113, 111, 106, 252], [197, 192, 183, 255], [95, 89, 80, 244], [116, 128, 128, 253],
  [158, 154, 147, 255],
];
/**
 * The base-two logarithm of the tiles a pixel crosses beyond which a finish begins to be read as from afar, and the
 * octaves over which it comes to that in full: its first copy's base colour alone, its painted means for the rest and
 * no lean, as the light finish is. The air sees most of the city so.
 */
export const WORLD_FAR = -4;
export const WORLD_FAR_BAND = 1;
/**
 * The metres the finishes are asked for as if they were off (assets/residency.ts `shown`): their maps' first steps
 * come before every other texture's but those nearer the eye than about 1.4 m, base colours first and the packed
 * maps last, and after the meshes' pages. They colour the whole screen.
 */
export const WORLD_NEAR = 0.345;
/** Frames over which the finishes come up from their base colours alone to every map once all have come (`early`). */
export const WORLD_RISE = 20;
/** Tiles across one cell of the noise that says where a finish's second copy shows, and the share of a tile's height over which the higher of two shows through the other. */
export const WORLD_PATCH = 0.37;
export const WORLD_BAND = 0.2;
/** How far a finish's second copy is moved: in tiles where it is turned, and in modules where it keeps the pattern's direction. */
const SHIFT = [0.37, 0.71] as const;
const MODULES = [3, 5] as const;

export function surfaceCity(id: string): string {
  const key = id.split(":").pop()!;
  return key in SURFACE_CITIES ? key : "default";
}
/** Three vec4s: tint and scale; weather, wetness, growth, desert; bump and reserved. */
export function citySurface(out: Float32Array, id: string): void {
  const key = surfaceCity(id), d = SURFACE_CITIES[key]!;
  out.set(d.tint);
  out[3] = d.scale;
  out[4] = d.weather;
  out[5] = d.wetness;
  out[6] = d.growth;
  out[7] = key === "las-vegas" ? 1 : 0;
  out[8] = d.bump;
  out.fill(0, 9, 12);
}
/** The finishes, a layer each of the arrays, before the masks'. */
const N = SURFACE_NAMES.length;
const finishes = SURFACE_NAMES.map((name, i) => {
  const f = SURFACE_FINISHES[name], g = SURFACE_GROUPS[f.group];
  const b = WORLD_BASE[i]!;
  return { ...f, metres: f.metres * g.scale, bump: f.bump * g.bump, weather: f.weather * g.weather, tint: g.tint, wetness: g.wetness, growth: g.growth, module: f.module ?? [0, 0], mean: WORLD_MRO[i]!.map((v) => v / 255), base: [srgbToLinear(b[0] / 255), srgbToLinear(b[1] / 255), srgbToLinear(b[2] / 255), b[3] / 255] };
});
/** Metres across finish `index`'s tile in a city (citySurface). */
export const finishMetres = (index: number, city: Numbers): number => finishes[index]!.metres * city[3]!;

/** For each finish, where the eye is in its tiles along x, y and z, less whole tiles, which the GPU is given in place of a large number. */
export function worldPhase(out: Float32Array, x: number, y: number, z: number, city: Numbers): void {
  for (let i = 0; i < finishes.length; i++) {
    const m = finishMetres(i, city);
    out[i * 3] = x / m - Math.floor(x / m);
    out[i * 3 + 1] = y / m - Math.floor(y / m);
    out[i * 3 + 2] = z / m - Math.floor(z / m);
  }
}

/** What the finishes need of the textures' residency (assets/residency.ts). */
export interface FinishResidency {
  readonly format: TextureFormat;
  shown(t: number, px: number, weight: number, needed: boolean): void;
  holds(t: number): number;
  canHave(t: number): boolean;
  again(t: number): void;
}

/** How many times its nearest surface's pixels a tile a finish is wanted at: twice where the tier reads at a slant, whose taps may read a level finer. */
export const finishTaps = (tier: Tier): number => (tier.anisotropy > 1 ? 2 : 1);
/** Levels a frame a layer's finest level in hand comes down by on the card once a finer one has come (`worldLeast`). */
export const WORLD_EASE = 0.25;
/** worldGrad's widening of a read's steps (dx, dy: texels of the array's base a pixel), held `least` levels over it, as its twin. */
export function heldWidening(dx: readonly number[], dy: readonly number[], least: number, taps: number): number {
  const a = Math.hypot(dx[0]!, dx[1]!), b = Math.hypot(dy[0]!, dy[1]!), major = Math.max(a, b, 1e-9), minor = Math.max(Math.abs(dx[0]! * dy[1]! - dx[1]! * dy[0]!) / major, 1e-9);
  return least > 0 ? Math.max(1, 2 ** least * Math.max(Math.min(2 ** Math.ceil(Math.log2(major / Math.max(Math.min(a, b), 1e-9))), taps) / major, 1 / minor)) : 1;
}
/**
 * The side of the weathering masks' layers on a tier whose finishes the card keeps `side` wide (0 for none), where it
 * reads them in full: 512, a texel 1.6 cm of a bay's 8 m, finer than a track of runoff, 10.7 MiB with every level; on
 * ultra 1,024, whose finest threads are sharper, 42.7 MiB. None elsewhere.
 */
export const weatherSide = (tier: Tier, side: number): number => (side > 0 && tier.finish === "full" ? (tier.finishes >= 2048 ? 1024 : 512) : 0);
/** Bytes the masks hold on the card with layers `side` wide, every level of each. */
export const weatherBytes = (side: number): number => Math.round((side * side * 4 * WEATHER_LAYERS * 4) / 3);
/** Metres nearer than which a surface is wanted as if it were this near. */
const NEAREST = 0.25;

/**
 * The world finishes' maps, a frame at a time. Each layer of each role is asked for as wide as its nearest surface
 * shows it (finish-near.ts), no wider than the tier keeps them and never less than its first step; the card is told the
 * side of the array it keeps each role in, the finest level any layer has come to, which it reads from, and for each
 * layer how far over that the finest it holds lies, so that no read takes a level it has not had. A layer that comes
 * to a finer level eases down to it over frames. When the side changes the card makes its arrays again, so their
 * textures are taken again from their first step.
 */
export class WorldFinishes {
  private readonly materials: number[];
  /** Each role's textures by their index in the manifest, and each one's layer of the array: a finish each, then the masks'. */
  private readonly textures: number[][];
  private readonly layers: number[][];
  /** Each role's top, and its top against the base colour's. */
  private readonly tops: number[];
  private readonly share: number[];
  private side = 0;
  private roles = 0;
  /** Frames since every map has come, up to WORLD_RISE; and whether a frame has been drawn without them since the finishes were asked for, which the rise is for. */
  private risen = 0;
  private drawnEarly = false;
  /** The side the tier has the card make its textures at, which the card's budget holds from the first, and the side it makes them at, from the frame every map had come. */
  wanted = 0;
  private making = 0;
  /** Per layer and role as `worldLeast` lays them out, the finest level the card reads, counted from the array's widest. */
  private readonly read = new Float32Array(WORLD_LAYERS * 3);

  constructor(materials: readonly PackMaterial[], textures: readonly PackTexture[]) {
    const found = SURFACE_NAMES.map((name) => materials.findIndex((m) => m.id === surfaceMaterial(name)));
    this.materials = found.every((m) => m >= 0) ? found : [];
    const masks = MASK_MATERIALS.map((id) => (this.materials.length ? materials.findIndex((m) => m.id === id) : -1));
    const roles = ["base", "normal", "mro"] as const;
    const layers = roles.map((_, r) => [...this.materials.map((_, i) => i), ...(r === 2 ? masks.flatMap((m, k) => (m >= 0 ? [MASK_LAYER + k] : [])) : [])]);
    this.layers = layers;
    this.textures = roles.map((role, r) => layers[r]!.map((l) => materials[l < MASK_LAYER ? this.materials[l]! : masks[l - MASK_LAYER]!]![role]));
    this.tops = this.textures.map((ts) => (ts.length ? textures[ts[0]!]!.top : 0));
    this.share = this.tops.map((top) => top / (this.tops[0] || 1));
  }

  get present(): boolean {
    return this.materials.length > 0;
  }

  /**
   * `near` is metres from the eye to the nearest surface of each finish and the nearest wall (finish-near.ts), and
   * `scale` the pixels a metre covers on screen a metre off. A layer is wanted at as many pixels a tile as its nearest
   * surface shows, times `finishTaps`.
   */
  frame(p: FramePacket, residency: FinishResidency, tier: Tier, near: ArrayLike<number>, scale: number): void {
    const side = this.present && tier.lit ? tier.finishes : 0;
    // The touch rule's light finish reads the base colour alone, so it neither fetches nor holds the others.
    const roles = tier.finish === "light" ? 1 : 3;
    if (side !== this.side || roles !== this.roles) {
      for (const ts of this.textures) for (const t of ts) residency.again(t);
      this.drawnEarly = false;
    }
    this.side = side;
    this.roles = roles;
    const taps = finishTaps(tier);
    const shown = (metres: number, at: number): number => (taps * scale * metres) / Math.max(at, NEAREST);
    for (let r = 0; r < 3; r++) {
      const along = r < roles ? Math.min(side * this.share[r]!, topIn(residency.format, this.tops[r]!)) : 0;
      const ts = this.textures[r]!, ls = this.layers[r]!;
      let level = along > 0 ? 0 : -1, finest = Infinity;
      for (let k = 0; k < ts.length; k++) {
        const t = ts[k]!, l = ls[k]!;
        if (along > 0) {
          let px = 0;
          if (l < MASK_LAYER) {
            let at = near[l]!;
            // Paint let go on a wall shows the concrete under it.
            if (l === CONCRETE) for (const f of PEELED) at = Math.min(at, near[f]!);
            px = shown(finishMetres(l, p.surfaceCity), at);
          } else {
            const reads = MASK_READS[l - MASK_LAYER]!;
            for (let j = 0; j < reads.length; j += 2) px = Math.max(px, shown(reads[j + 1]!, near[reads[j]!]!));
          }
          residency.shown(t, Math.min(along, px), WEIGHT[r]! / WORLD_NEAR, true);
        }
        const held = residency.holds(t);
        if (held < 0 || level < 0) {
          level = -1;
          continue;
        }
        const at = Math.log2(along / Math.min(along, STEP0_SIZE << held)), was = this.read[l * 3 + r]!;
        finest = Math.min(finest, at);
        this.read[l * 3 + r] = at > was ? at : Math.max(at, was - WORLD_EASE);
      }
      if (level >= 0) level = finest;
      p.worldSide[r] = along;
      p.worldLevel[r] = level;
      for (const l of ls) p.worldLeast[l * 3 + r] = level < 0 ? 0 : this.read[l * 3 + r]! - level;
    }
    // Drawn from the base colours alone, the far path's way, until the normals and packed maps have all come too.
    const full = p.worldLevel[0]! >= 0 && (roles < 3 || (p.worldLevel[1]! >= 0 && p.worldLevel[2]! >= 0));
    // Maps that were all there from the first frame drawn with them come up at once: there is nothing to rise from.
    if (side > 0 && !full) this.drawnEarly = true;
    this.risen = full ? (this.drawnEarly ? Math.min(WORLD_RISE, this.risen + 1) : WORLD_RISE) : 0;
    p.worldEarly = 1 - this.risen / WORLD_RISE;
    // Where their base colours cannot come at all (a picture made with no network), the finishes are not drawn early.
    p.worldComing = side > 0 && this.textures[0]!.every((t) => residency.canHave(t));
    // The card makes its textures once the finishes have come, and goes on at that side while it is the one wanted.
    const want = (this.wanted = weatherSide(tier, side));
    p.weatherSide = this.making = want > 0 && (full || this.making === want) ? want : 0;
    worldPhase(p.worldPhase, p.camX, p.camY, p.camZ, p.surfaceCity);
    p.frame[FRAME.edgesOff] = 0;
    p.frame[FRAME.roadOff] = 0;
  }
}

export function surfaceHash(x: number, y: number): number {
  let h = (Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 8) / 16777216;
}
const fract = (x: number): number => x - Math.floor(x);
const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x));
/** Whether a finish whose roughness, its wetness's share taken off (worldSurface's `orm`), is `rough` mirrors the sky as a picture, as LIT decides it. */
export const worldSharp = (rough: number): boolean => rough < WORLD_SHARP;
export function surfaceNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y);
  const a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy);
  return (surfaceHash(ix, iy) * (1 - a) + surfaceHash(ix + 1, iy) * a) * (1 - b) + (surfaceHash(ix, iy + 1) * (1 - a) + surfaceHash(ix + 1, iy + 1) * a) * b;
}
/**
 * The share of `b` where `t` of it is wanted and the higher of heights `a` and `b` shows through the other within
 * `band`: 0 at t 0 and 1 at t 1 while the two are less than `scale` apart.
 */
export function higher(a: number, b: number, t: number, scale = 1, band = WORLD_BAND): number {
  const ha = a + 2 * scale * (1 - t), hb = b + 2 * scale * t, top = Math.max(ha, hb) - band;
  const wa = Math.max(ha - top, 0), wb = Math.max(hb - top, 0);
  return wb / (wa + wb);
}
/** How much of a finish's second copy shows at tile point (u, v), from 0 to 1. */
export function secondShare(u: number, v: number): number {
  const k = clamp((surfaceNoise(u * WORLD_PATCH + 5.3, v * WORLD_PATCH + 1.7) - 0.35) / 0.3);
  return k * k * (3 - 2 * k);
}

/**
 * Reads role `role` (0 base colour as light with the tint mask in alpha, 1 normal as stored, 2 occlusion, roughness,
 * metal and height) of finish `layer` at tile point (u, v), the tile repeating, into `out`. `spread` is the base-two
 * logarithm of the tiles one step between screen pixels crosses.
 */
export type WorldSample = (role: number, layer: number, u: number, v: number, spread: number, out: Out) => void;
const read = [new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array(4)];
/** Steps down the view's ray into a finish's relief where the tier reads it so (assets/tiers.ts `relief`). */
export const RELIEF_STEPS = 6;
/** Texels across a tile at which a pixel is as wide as one, nearer than which the relief is read in full, fading out by twice as wide. */
const RELIEF_TEXELS = 2048;
const deep = new Float64Array(4), met = new Float64Array(2), tangent = new Float64Array(3);

/**
 * Where the ray from the eye along `view` (the way to the eye in the tile's frame: across, down the tile and out of the
 * face) first meets finish `id`'s painted height under tile point (u, v), `depth` tiles deep, read on its first copy
 * where `second` is false and on its second where true: RELIEF_STEPS even steps down, and between the two either side
 * of the meeting. Into `met`.
 */
function relief(id: number, u: number, v: number, spread: number, view: Numbers, depth: number, second: boolean, sample: WorldSample): void {
  const f = finishes[id]!, turned = f.module[0] === 0;
  const au = (-view[0]! / view[2]!) * depth / RELIEF_STEPS, av = (-view[1]! / view[2]!) * depth / RELIEF_STEPS;
  const height = (k: number): number => {
    const pu = u + au * k, pv = v + av * k;
    sample(2, id, !second ? pu : turned ? -pv + SHIFT[0] : pu + f.module[0] * MODULES[0], !second ? pv : turned ? pu + SHIFT[1] : pv + f.module[1] * MODULES[1], spread, deep);
    return deep[3]!;
  };
  let above = 1 - height(0), under = 0, k = 1;
  for (; k <= RELIEF_STEPS; k++) {
    under = height(k) - (1 - k / RELIEF_STEPS);
    if (under >= 0) break;
    above = -under;
  }
  const along = k > RELIEF_STEPS ? RELIEF_STEPS : above + under > 0 ? k - 1 + above / (above + under) : k - 1;
  met[0] = u + au * along;
  met[1] = v + av * along;
}
const maps = { base: new Float64Array(4), mro: new Float64Array(4), lean: new Float64Array(2), patch: 0 };

/**
 * A finish's maps at tile point (u, v), its second copy shown over the first where secondShare says, the higher
 * showing; where `depth` (tiles) is more than 0, read where the ray to the eye along `view` (relief) meets the painted
 * height. Into `maps`. Where `early` is 1 only the base colours have come: the rest are read as their means, and the
 * copies meet by their noise alone; between 0 and 1 they come up to what is read. Where it is 2 nothing has come, and
 * the finish is its means, its base colour's too.
 */
function finishMaps(id: number, u: number, v: number, spread: number, sample: WorldSample, light: boolean, view: Numbers, depth: number, early = 0): void {
  const f = finishes[id]!, turned = f.module[0] === 0;
  const far = light ? 1 : clamp((spread - WORLD_FAR) / WORLD_FAR_BAND);
  const second = secondShare(u, v), t = second * (1 - far);
  if (early >= 2) {
    for (let c = 0; c < 4; c++) maps.base[c] = f.base[c]!;
    for (let c = 0; c < 3; c++) maps.mro[c] = f.mean[c]!;
    maps.mro[3] = 0.5;
    maps.lean[0] = maps.lean[1] = 0;
    maps.patch = second;
    return;
  }
  if (depth > 0 && early < 1) {
    relief(id, u, v, spread, view, depth, t >= 0.5, sample);
    u = met[0]!;
    v = met[1]!;
  }
  const bu = turned ? -v + SHIFT[0] : u + f.module[0] * MODULES[0], bv = turned ? u + SHIFT[1] : v + f.module[1] * MODULES[1];
  for (const r of read) r.fill(0);
  if (t < 1) {
    sample(0, id, u, v, spread, read[0]!);
    if (far < 1 && early < 1) {
      sample(2, id, u, v, spread, read[1]!);
      sample(1, id, u, v, spread, read[2]!);
    }
  }
  if (t > 0) {
    sample(0, id, bu, bv, spread, read[3]!);
    if (early < 1) {
      sample(2, id, bu, bv, spread, read[4]!);
      sample(1, id, bu, bv, spread, read[5]!);
    }
  }
  const s = t <= 0 ? 0 : t >= 1 ? 1 : higher(read[1]![3]!, read[4]![3]!, t) * (1 - early) + t * early;
  maps.patch = s * (1 - far) + second * far;
  for (let c = 0; c < 4; c++) {
    maps.base[c] = read[0]![c]! * (1 - s) + read[3]![c]! * s;
    maps.mro[c] = read[1]![c]! * (1 - s) + read[4]![c]! * s;
  }
  // A turned copy's lean along its own across is a lean up the first's, and its lean up is one back across.
  const ax = (read[2]![0]! * 255 - 128) / 127.5, ay = (read[2]![1]! * 255 - 128) / 127.5;
  const bx = (read[5]![0]! * 255 - 128) / 127.5, by = (read[5]![1]! * 255 - 128) / 127.5;
  maps.lean[0] = t >= 1 ? 0 : ax * (1 - s);
  maps.lean[1] = t >= 1 ? 0 : ay * (1 - s);
  if (t > 0) {
    maps.lean[0] += (turned ? -by : bx) * s;
    maps.lean[1] += (turned ? bx : by) * s;
  }
  if (far > 0) {
    for (let c = 0; c < 3; c++) maps.mro[c] = maps.mro[c]! * (1 - far) + f.mean[c]! * far;
    maps.mro[3] = maps.mro[3]! * (1 - far) + 0.5 * far;
    maps.lean[0] = far >= 1 ? 0 : maps.lean[0]! * (1 - far);
    maps.lean[1] = far >= 1 ? 0 : maps.lean[1]! * (1 - far);
  }
  if (early > 0) {
    for (let c = 0; c < 3; c++) maps.mro[c] = maps.mro[c]! * (1 - early) + f.mean[c]! * early;
    maps.mro[3] = maps.mro[3]! * (1 - early) + 0.5 * early;
    maps.lean[0] = early >= 1 ? 0 : maps.lean[0]! * (1 - early);
    maps.lean[1] = early >= 1 ? 0 : maps.lean[1]! * (1 - early);
  }
}

/**
 * Writes linear albedo, ORM and the bumped normal of finish `index` at world point (x, y, z), and returns the height
 * there in millimetres with the finish's lift. `palette` is the palette colour as light. `footprint` is metres covered
 * by one screen pixel on the projection. `light` is the touch rule's finish (assets/tiers.ts `finish`): the base colour
 * of one copy alone, and no stain. (nx, ny, nz) is the face's normal, which chooses the projection and where growth
 * takes; `smooth`, where given, is the normal the light falls on and the bump turns (the ground's, from its heights),
 * and otherwise the face's is. `early` is the frame's (FramePacket `worldEarly`): 1 while only the base colours have
 * come, read as the far path reads them, and 2 before any has, the finish its means. `eye`, where given, is the way to the eye, and the finish is read where that ray meets
 * its painted height (assets/tiers.ts `relief`).
 */
export function worldSurface(albedo: Out, orm: Out, normal: Out, palette: Numbers, index: number, x: number, y: number, z: number,
  nx: number, ny: number, nz: number, footprint: number, city: Numbers, sample: WorldSample, light = false, smooth: Numbers | null = null, eye: Numbers | null = null, early = 0): number {
  const f = finishes[index]!;
  const axis = Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz)) ? 1 : Math.abs(nx) > Math.abs(nz) ? 0 : 2;
  const metres = finishMetres(index, city);
  const u = (axis === 0 ? z : x) / metres, v = (axis === 1 ? z : -y) / metres;
  const spread = Math.log2(Math.max(footprint / metres, 1e-9));
  let depth = 0;
  if (eye && !light) {
    // The way to the eye across the tile, down it and out of the face.
    tangent[0] = axis === 0 ? eye[2]! : eye[0]!;
    tangent[1] = axis === 1 ? eye[2]! : -eye[1]!;
    tangent[2] = axis === 1 ? eye[1]! * Math.sign(ny) : axis === 0 ? eye[0]! * Math.sign(nx) : eye[2]! * Math.sign(nz);
    if (tangent[2] > 0.1) depth = (f.height / 1000 / metres) * clamp(2 - 2 ** spread * RELIEF_TEXELS);
  }
  finishMaps(index, u, v, spread, sample, light, tangent, depth, early);
  const macro = surfaceNoise(x / 37 + y / 53, z / 37);
  const stain = light ? 0 : 0.75 * surfaceNoise(x / 8 + z / 19, y / 17 + z / 11) + 0.25 * surfaceNoise(x / 2.9 + z / 7.3, y / 4.1 + z / 3.7);
  const weather = f.weather * city[4]!;
  const wet = clamp(f.wetness + city[5]!);
  const growth = clamp((f.growth + city[6]!) * clamp((macro - 0.42) * 3) * (ny > 0.2 ? 1 : 0.4));
  for (let c = 0; c < 3; c++) {
    const dye = 1 + (clamp(palette[c]! / 0.3, 0.18, 2.2) - 1) * f.palette * maps.base[3]!;
    const green = c === 1 ? 0.75 : c === 0 ? 0.55 : 0.35;
    albedo[c] = maps.base[c]! * dye * f.tint[c]! * city[c]! * (1 + (macro - 0.5) * 0.5 - stain * weather * 0.5) * (1 + (maps.patch - 0.5) * f.patch) * (1 - wet * 0.28) * (1 - growth + growth * green);
  }
  // The normal map's lean across and up the tile, in the tile's frame: across is +u, up is -v.
  const k = f.bump * city[8]!, lx = light ? 0 : maps.lean[0]!, ly = light ? 0 : maps.lean[1]!;
  const lz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
  const bx = lx * k, by = ly * k;
  let ox = (smooth ? smooth[0]! : nx) * lz, oy = (smooth ? smooth[1]! : ny) * lz, oz = (smooth ? smooth[2]! : nz) * lz;
  if (axis === 1) { ox += bx; oz -= by; } else if (axis === 0) { oz += bx; oy += by; } else { ox += bx; oy += by; }
  const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
  normal[0] = ox / length;
  normal[1] = oy / length;
  normal[2] = oz / length;
  orm[0] = maps.mro[0]!;
  orm[1] = clamp(maps.mro[1]! * f.rough - wet * 0.35, 0.12, 1);
  orm[2] = maps.mro[2]! * f.metal;
  return maps.mro[3]! * f.height + f.lift;
}

/** Metres from the eye over which the walls' weathering fades out, well before the far city's boxes take over. */
export const WEATHER_NEAR = 150;
export const WEATHER_GONE = 250;
/**
 * Metres of a box's rounded arris, about which its outer edges turn, wear and chip, and a hand's width over each floor
 * line, an inside corner, within which dirt darkens a wall.
 */
export const EDGE_ROUND = 0.02;
export const EDGE_DIRT = 0.12;
/** How much each finish's outer edges wear lighter and chip, and what a chip shows: 0 aggregate, 1 the render under paint, 2 bare metal, 3 grey timber, 4 a paler core. */
const EDGES: Record<string, readonly [number, number, number]> = {
  concrete: [1, 1, 0], plaster: [0.8, 1, 1], brick: [0.6, 0.7, 4], clay: [0.6, 0.6, 4], steel: [0.5, 1, 2], rust: [0.4, 0.8, 2], wood: [0.7, 1, 3], glass: [0.2, 0, 0], rock: [0.7, 0.6, 0],
};
const edgings = SURFACE_NAMES.map((name) => EDGES[name] ?? [0.6, 0.6, 0]);
/** What runoff leaves, as a multiplier of the wall's light: grime, rust and salt. */
const LEFT = { grime: [0.38, 0.37, 0.34], rust: [0.95, 0.5, 0.28], salt: [1.35, 1.33, 1.28] } as const;
const CONCRETE = SURFACE_NAMES.indexOf("concrete");
const weatherings = SURFACE_NAMES.map((name) => SURFACE_WEATHERING[name]);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bare = new Float64Array(4);
/** A static instance's place in quarter metres, from its origin's world x and z, which the vertex text gives as vPlace: storeys stacked on one bay share it. */
export const staticPlace = (x: number, z: number): [number, number] => [Math.floor(x * 4 + 0.5), Math.floor(z * 4 + 0.5)];
/** The seed of a static at a place (staticPlace), from 0 to 1. */
export const staticSeed = (place: readonly number[]): number => surfaceHash(place[0]!, place[1]!);

/**
 * Where a static's weathering is read on a wall, from the point in its instance's own frame (`own`, metres, as the
 * vertex text gives it in vOwn) and its face's normal in that frame: metres along the wall, the way a reader facing the
 * face reads, and metres up. Into `out`, with 1 in its third place on a wall and 0 on a face that looks up or down.
 */
export function weatherFrame(ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, out: Float64Array | Float32Array): void {
  const facesZ = Math.abs(nz) >= Math.abs(nx);
  out[0] = facesZ ? ox * (nz < 0 ? -1 : 1) : oz * (nx < 0 ? 1 : -1);
  out[1] = oy;
  out[2] = Math.abs(ny) < 0.5 ? 1 : 0;
}

/** The way the afternoon sun comes from, on the ground (x west, z north): south and a little west. A wall facing it bleaches. */
export const SUN_FACE = [0.42, -0.91] as const;
/**
 * Metres of a wall's plane over which its bays share a key: two walls closer than this are one to the weathering. The
 * cells' edges lie an eighth of a metre off the quarter metres walls are often on, and a bay within PLANE_BLEND of one
 * takes a share of both keys, so a wall on an edge never flickers between them as the float's last bits move.
 */
const PLANE_CELL = 2, PLANE_EDGE = 0.125, PLANE_BLEND = 0.1;
/** Metres either side of a bay's side over which its tone becomes the next bay's. */
const TONE_BLEND = 0.25;
/** The second field read's scale against the first, which no whole number of either's tiles meets. */
const FIELD_TWO = 0.731;
/** What a field reads as while the masks are being made: damp at its middle, nothing let go, no patina and no salt. */
const FIELD_NONE = [0.5, 0, 0, 0] as const;
const bay = new Float64Array(6), field = new Float64Array(4), field2 = new Float64Array(4);
/** What rust bled from a fixing leaves, as a multiplier of the wall's light; the green of a film of algae; salt's white. */
const RUST = [0.81, 0.43, 0.24] as const, ALGAE = [0.62, 0.72, 0.5] as const, SALT = [0.72, 0.71, 0.68] as const, GROWTH = [0.55, 0.7, 0.42] as const;

/**
 * Where a wall's weathering is read, from its world point and its face's normal, the same on either side of a chunk's
 * edge and on an instance as on a chunk's mesh: metres along it, measured along world z where the face looks more along
 * x and along x where it looks along z; and the keys of its bay in that frame, from its plane where the bay's middle
 * lies, so that a wall a little off the axes keeps its bays' keys along it. Into `out`: along; the keys of the plane
 * cells either side of the nearest cell edge and the second's share (PLANE_BLEND); the side it faces (0 and 1 along x,
 * 2 and 3 along z); and 1 where the face is a wall, 0 where it looks up or down. A face that looks up or down reads
 * along x with no key of its own, as its normal says nothing steady of x and z.
 */
export function wallFrame(x: number, z: number, nx: number, ny: number, nz: number, out: Float64Array): void {
  const wall = Math.abs(ny) < 0.5, facesX = wall && Math.abs(nx) > Math.abs(nz);
  const along = facesX ? z : x, plane = facesX ? x : z, slope = !wall ? 0 : facesX ? -nz / nx : -nx / nz;
  const side = facesX ? (nx > 0 ? 0 : 1) : nz > 0 ? 2 : 3;
  const centre = (Math.floor(along / WEATHER_BAY) + 0.5) * WEATHER_BAY;
  const cell = (plane + (centre - along) * slope - PLANE_EDGE) / PLANE_CELL, edge = Math.floor(cell + 0.5);
  out[0] = along;
  out[1] = wall ? (edge - 1) * 4 + side : 0;
  out[2] = wall ? edge * 4 + side : 0;
  out[3] = wall ? smooth(-PLANE_BLEND, PLANE_BLEND, (cell - edge) * PLANE_CELL) : 0;
  out[4] = side;
  out[5] = wall ? 1 : 0;
}

/**
 * A storey of a bay's stamp, keyed `key`: one of the bay layers by its hash, the half of it its place's parity picks so
 * that the bays beside it along and up the wall never take the same stamp, and mirrored or not; and its leak, 0 to 1,
 * and whether its fixings bleed rust. Each from bits of one integer hash of their own. Into `out`.
 */
export function bayStamp(bay: number, storey: number, key: number, out: Float64Array | number[]): void {
  const h = hash32(bay, storey, key);
  out[0] = ((h & 0xffff) * WEATHER_BAYS) >>> 16;
  out[1] = (bay + storey) & 1;
  out[2] = (h >>> 16) & 1;
  out[3] = ((h >>> 17) & 0x7f) / 127;
  out[4] = h >>> 24 < 154 ? 1 : 0;
}

/** A wall's tone, 0 to 1, from bay to bay along it, keyed `key`, eased into the next bay's within TONE_BLEND of a bay's side. */
export function bayTone(along: number, key: number): number {
  const edge = Math.floor(along / WEATHER_BAY + 0.5), t = smooth(-TONE_BLEND, TONE_BLEND, along - edge * WEATHER_BAY), a = hash3(edge - 1, key, 977);
  return a + (hash3(edge, key, 977) - a) * t;
}

const choice = new Float64Array(5), other = new Float64Array(6);
/** The masks of a storey of a bay's stamp at (u, down) of it, keyed `key`, then its leak and rust: into `out`. */
function stamped(masks: WorldSample, bay: number, storey: number, key: number, u: number, down: number, spread: number, out: Float64Array): void {
  bayStamp(bay, storey, key, choice);
  masks(3, choice[0]!, choice[2] ? 1 - u : u, (choice[1]! + WEATHER_PAD + down * (1 - 2 * WEATHER_PAD)) / 2, spread, out);
  out[4] = choice[3]!;
  out[5] = choice[4]!;
}
const frame = new Float64Array(6);
/** The weathering masks as the page makes them, read at the twin's side (texgen/weather.ts). */
const twinMasks: WorldSample = (_role, layer, u, v, spread, out) => weatherRead(layer, WEATHER_TWIN_SIDE, u, v, spread, out);
/** How much of a pixel `footprint` metres wide, `d` metres from a line's middle, the line `half` metres either side of it covers. */
const coveredLine = (d: number, half: number, footprint: number): number => {
  const f = Math.max(footprint, 1e-4);
  return clamp((half - d) / f + 0.5) * clamp((2 * half) / f);
};
/** The formwork of a concrete wall, by its 2 m panels along the wall and up each storey: their joints and their tie holes. */
export function formwork(along: number, over: number, footprint: number): number {
  const panel = Math.floor(along / 2 + 0.5), storey = Math.floor(over / WEATHER_STOREY), s = over - storey * WEATHER_STOREY;
  const across = Math.abs(along - panel * 2 + (surfaceNoise(over / 0.7, panel * 3.1) - 0.5) * 0.008);
  const lift = Math.floor(s / 2 + 0.5), up = Math.abs(s - lift * 2 + (surfaceNoise(along / 0.7, storey * 5.3 + lift) - 0.5) * 0.008);
  const half = 0.0045 + 0.003 * surfaceNoise(along / 0.3 + over / 0.5, storey * 1.7);
  const a = along - Math.floor(along / 2) * 2, b = s - Math.floor(s / 2) * 2;
  const ha = a - (0.38 + 0.62 * clamp(Math.round((a - 0.38) / 0.62), 0, 2)), hb = b - (0.38 + 0.62 * clamp(Math.round((b - 0.38) / 0.62), 0, 2));
  return Math.max(coveredLine(across, half, footprint), coveredLine(up, half, footprint), coveredLine(Math.sqrt(ha * ha + hb * hb), 0.0125, footprint) * 0.8);
}

/**
 * Weathers finish `index`'s light and ORM as worldSurface left them, at world point (x, y, z) of a static whose face's
 * normal is (nx, ny, nz), `over` metres over the ground and with `open` of the sky's light there (skyopen.ts), `dist`
 * metres from the eye, a pixel `footprint` metres wide. Every static face's value moves from bay to bay and across 5 to
 * 30 m; on a wall, within WEATHER_GONE of the eye, the masks the page makes (client/core/texgen/weather.ts), read by
 * `masks` with a layer of that array (their twin, unless a caller gives its own), put a variant of runoff, drips, rust and splash in each bay of each
 * storey by its key (wallFrame), and damp, the plaster's hold, a patina and salt over the wall from two reads of the
 * fields that never line up. `ready` is how far the masks have come, from 0 to 1. Each effect is as much as the
 * finish's SURFACE_WEATHERING says.
 */
export function weathered(albedo: Out, orm: Out, index: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, over: number, open: number,
  dist: number, footprint: number, city: Numbers, sample: WorldSample, ready = 1, masks: WorldSample = twinMasks): void {
  const w = weatherings[index]!;
  wallFrame(x, z, nx, ny, nz, frame);
  const along = frame[0]!, share = frame[3]!, side = frame[4]!, wall = frame[5] === 1, key = share < 1 ? frame[1]! : frame[2]!, both = share > 0 && share < 1;
  const bayAt = Math.floor(along / WEATHER_BAY), storey = Math.floor(over / WEATHER_STOREY);
  // A wall's bays each take their own tone; a roof's tone moves only with the noise.
  const column = !wall ? 0.5 : both ? bayTone(along, key) + (bayTone(along, frame[2]!) - bayTone(along, key)) * share : bayTone(along, key);
  const value = 1 + w.value * ((surfaceNoise(x / 7 + y / 5, z / 7 - y / 4) - 0.5) * 0.7 + (column - 0.5) * 0.3);
  for (let c = 0; c < 3; c++) albedo[c]! *= value;
  const fade = 1 - smooth(WEATHER_NEAR, WEATHER_GONE, dist);
  if (!wall || fade <= 0) return;
  // The bay's stamp, its runoff from the slab line at the top of the storey to the floor.
  const u = along / WEATHER_BAY - bayAt, down = 1 - (over / WEATHER_STOREY - storey), spread = Math.log2(Math.max(footprint / WEATHER_BAY, 1e-9));
  stamped(masks, bayAt, storey, key, u, down, spread, bay);
  if (both) {
    stamped(masks, bayAt, storey, frame[2]!, u, down, spread, other);
    for (let c = 0; c < 6; c++) bay[c] = bay[c]! + (other[c]! - bay[c]!) * share;
  }
  const o = side * 5.3, f0 = WEATHER_BAYS + (side & 1), f1 = WEATHER_BAYS + ((side & 1) ^ (WEATHER_FIELDS > 1 ? 1 : 0));
  masks(3, f0, (along + o) / WEATHER_FIELD, -over / WEATHER_FIELD, Math.log2(Math.max(footprint / WEATHER_FIELD, 1e-9)), field);
  masks(3, f1, (along * FIELD_TWO + 3.7 + o) / WEATHER_FIELD, (-over * FIELD_TWO + 1.3) / WEATHER_FIELD, Math.log2(Math.max((footprint * FIELD_TWO) / WEATHER_FIELD, 1e-9)), field2);
  const blend = smooth(0.3, 0.7, surfaceNoise(x / 9 + z / 9, y / 6));
  for (let c = 0; c < 4; c++) {
    bay[c] = bay[c]! * ready;
    field[c] = FIELD_NONE[c]! + (field[c]! + (field2[c]! - field[c]!) * blend - FIELD_NONE[c]!) * ready;
  }
  const damp = field[0]!, hold = field[1]!, patina = field[2]!, salt = field[3]!;
  // Buildings are much dirtier than their neighbours where a 31 m noise is high; a bay's leaks are its own.
  const dirty = smooth(0.5, 0.75, surfaceNoise(x / 31 + 11.3, z / 31 + 5.7));
  const wet = (0.55 + 0.9 * surfaceNoise(x / 41 + 3.1, z / 41 + 7.7)) * (1 + dirty), leak = (0.3 + 0.7 * bay[4]!) * wet, worn = 0.65 * wet;
  if (w.peel > 0) {
    // Whole patches of plaster gone, metres across where a wall is dirty, and flakes elsewhere as its leaks loosen it.
    const gone = smooth(0.62, 0.7, surfaceNoise(along / 6, over / 5 + side * 17) + 0.25 * dirty);
    const t = 1 - (0.88 * gone + w.peel * worn * 0.4 * (1 - gone)) * fade, lost = smooth(t, t + 0.02, hold), rim = smooth(t - 0.04, t, hold) - lost;
    const chalk = 0.3 * w.peel * fade * smooth(0.2, 0.8, damp), grey = (albedo[0]! + albedo[1]! + albedo[2]!) / 3;
    const metres = finishMetres(CONCRETE, city);
    // The concrete is projected as worldSurface projects a wall: along z where the face looks along x.
    if (lost > 0) sample(0, CONCRETE, (side < 2 ? z : x) / metres, -y / metres, Math.log2(Math.max(footprint / metres, 1e-9)), bare);
    for (let c = 0; c < 3; c++) {
      const faded = albedo[c]! + (grey * 1.1 - albedo[c]!) * chalk;
      albedo[c] = (faded * (1 - lost) + bare[c]! * city[c]! * 0.85 * lost) * (1 - 0.3 * rim);
    }
  }
  const runs = bay[0]! * w.runs * leak * (0.7 + 0.3 * open) * fade, left = LEFT[w.left], wash = (0.12 * w.runs * worn + 0.4 * dirty) * fade;
  // Under every slab line the wall is darker, fading down the storey, which a street sees from far off.
  const below = (over - storey * WEATHER_STOREY) / WEATHER_STOREY, band = below * below * below * 0.35 * w.runs * (0.6 + 0.4 * worn) * (0.7 + 0.3 * open) * fade;
  const edge = (0.35 + 0.65 * surfaceNoise(along / 9, side * 13)) * (0.55 + 0.9 * damp) * (1.3 + 0.6 * dirty), foot = (1 - smooth(edge - 0.06, edge, over)) * w.damp * fade;
  const growth = (1 - smooth(0.1, 0.45 * (0.6 + damp), over)) * foot * clamp(city[6]! * 2.5 + 0.2);
  const joints = w.joints > 0 ? formwork(along, over, footprint) * w.joints * fade : 0;
  const floor = over - storey * WEATHER_STOREY, dirt = (1 - smooth(0, EDGE_DIRT, floor)) * fade;
  const drips = bay[1]! * w.drips * (0.6 + 0.4 * leak) * fade;
  const rust = bay[2]! * w.drips * bay[5]! * fade;
  const splash = storey === 0 ? bay[3]! * w.splash * fade * (1 - smooth(0.8, 1.2, over)) : 0;
  // The sun bleaches a wall facing it under an open sky, in a patina's patches; facing away in the shade it greens.
  const sunward = nx * SUN_FACE[0] + nz * SUN_FACE[1];
  const bleach = w.bleach * smooth(0, 0.85, sunward) * smooth(0.35, 0.9, open) * (0.4 + 0.6 * smooth(0.3, 0.8, patina)) * fade;
  const algae = w.algae * clamp(city[6]! * 2.5 + 0.2) * smooth(0, 0.8, 0.2 - sunward) * (1 - 0.6 * open) * smooth(0.45, 0.8, patina + 0.4 * bay[0]!) * fade;
  // Salt blooms out of a wall at its damp foot, up to a little over the tide line, and under its runs.
  const salted = w.salt * smooth(0.7, 0.92, salt) * Math.min(1, 1 - smooth(edge * 0.7, edge + 0.25, over) + 0.5 * bay[0]!) * fade;
  const grey = (albedo[0]! + albedo[1]! + albedo[2]!) / 3;
  for (let c = 0; c < 3; c++) {
    let a = albedo[c]!;
    a += (grey * 1.15 + a * 0.08 - a) * 0.35 * bleach;
    a *= (1 + (left[c]! - 1) * runs) * (1 + (left[c]! - 1) * drips * 0.8) * (1 - 0.5 * foot) * (1 - 0.4 * joints) * (1 - 0.3 * dirt) * (1 - wash) * (1 - band) * (1 - 0.32 * splash);
    a += (a * RUST[c]! - a) * rust * 0.8;
    a *= 1 - growth + growth * GROWTH[c]!;
    a *= 1 + (ALGAE[c]! - 1) * 0.6 * algae;
    albedo[c] = a + (SALT[c]! - a) * 0.3 * salted;
  }
  orm[1] = Math.min(1, orm[1]! * (1 - 0.3 * foot) + 0.08 * splash);
}

/**
 * A static's nearest outer edge (edgeOf) on finish `index`, `dist` metres off across its face, (ox, oy, oz) the way
 * out across it: the arris turns the normal toward the next face within EDGE_ROUND, of a width that wanders, and is
 * chipped back where the finish's painted height (`painted`, worldSurface's) is low, more toward the edge; and the edge wears
 * lighter over a little more. All fade as a pixel grows wider than the arris. `line` keeps only the wear (medium's).
 */
export function edged(albedo: Out, orm: Out, normal: Out, index: number, dist: number, ox: number, oy: number, oz: number, painted: number,
  x: number, y: number, z: number, footprint: number, city: Numbers, line: boolean): void {
  const [wear, chip, shows] = edgings[index]!, f = finishes[index]!, height = (painted - f.lift) / f.height;
  const round = EDGE_ROUND * (0.6 + 0.8 * surfaceNoise(x / 0.37 + z / 0.53, y / 0.41));
  const worn = (1 - smooth(0, round * 2.5, dist)) * wear * (1 - smooth(round, round * 4, footprint));
  for (let c = 0; c < 3; c++) albedo[c]! *= 1 + 0.18 * worn;
  if (line) return;
  const seen = 1 - smooth(round * 0.5, round * 3, footprint), turn = (1 - smooth(0, round, dist)) * seen;
  if (turn > 0) {
    const nx = normal[0]! + ox * turn, ny = normal[1]! + oy * turn, nz = normal[2]! + oz * turn, l = Math.hypot(nx, ny, nz);
    normal[0] = nx / l;
    normal[1] = ny / l;
    normal[2] = nz / l;
  }
  const near = 1 - smooth(0, round * 3, dist), top = 0.15 + 0.45 * near;
  const chipped = near > 0 ? (1 - smooth(top - 0.04, top, height)) * chip * seen : 0;
  if (chipped <= 0) return;
  const grey = (albedo[0]! + albedo[1]! + albedo[2]!) / 3;
  for (let c = 0; c < 3; c++) {
    const bare = shows === 0 ? albedo[c]! * 0.8 : shows === 1 ? [0.3, 0.29, 0.27][c]! * city[c]! : shows === 2 ? [0.56, 0.57, 0.58][c]! : shows === 3 ? grey * 1.3 : albedo[c]! * 1.25;
    albedo[c] = albedo[c]! + (bare - albedo[c]!) * chipped;
  }
  orm[1] = orm[1]! + ((shows === 2 ? 0.45 : 1) - orm[1]!) * chipped;
  if (shows === 2) orm[2] = orm[2]! + (1 - orm[2]!) * chipped;
}

/**
 * From a static face's corners as the vertex text gives them (vFace, from 0 to 1 across and up the face) and the steps
 * of the face's place and of those corners between pixels, the nearest of the borders that `edges` names outer (bits 0
 * to 3: u at 0, u at 1, v at 0, v at 1): into `out` its distance in metres and the way out across it, or -1 for none.
 */
export function edgeOf(u: number, v: number, edges: number, pu: Numbers, pv: Numbers, out: Float64Array | Float32Array): void {
  const w = Math.hypot(pu[0]!, pu[1]!, pu[2]!), h = Math.hypot(pv[0]!, pv[1]!, pv[2]!);
  out[0] = -1;
  if (edges === 0 || w <= 0 || h <= 0) return;
  const far = [u * w, (1 - u) * w, v * h, (1 - v) * h];
  let best = -1;
  for (let k = 0; k < 4; k++) if ((edges & (1 << k)) !== 0 && (best < 0 || far[k]! < far[best]!)) best = k;
  if (best < 0) return;
  const along = best < 2 ? pu : pv, length = best < 2 ? w : h, sign = best % 2 === 0 ? -1 : 1;
  out[0] = far[best]!;
  for (let c = 0; c < 3; c++) out[c + 1] = (sign * along[c]!) / length;
}

/** Metres between the points of the noise by which an edge between two covers of the ground wanders, and the most it wanders, in metres. */
export const GROUND_GRAIN = 1.5;
export const GROUND_WANDER = 0.4;
/** How fast, against the share of the samples' weight, the second finish of the ground comes in where two meet: it shows from a share of 1/2 - 1/(2 GROUND_MEET). */
export const GROUND_MEET = 2;
/** Millimetres over which the higher of two finishes of the ground shows through the lower where they meet, and the most two finishes' heights may differ. */
export const GROUND_BAND = 6;
export const GROUND_SCALE = 40;

/** The twelve high bits of a hash, and the twelve low, each from 0 to 1. */
const high = (h: number): number => Math.floor(h * 4096) / 4096;
const low = (h: number): number => h * 4096 - Math.floor(h * 4096);

/**
 * How far along x and z, in metres, the ground's cover is looked up from ground point (x, z): a smooth noise of the high
 * and the low bits of hashes GROUND_GRAIN apart, within GROUND_WANDER either way, which fades out as the pixel's
 * `footprint` grows from a quarter of the grain to half of it, where it would only scatter the edge's pixels. Into `out`.
 */
export function groundWander(x: number, z: number, footprint: number, out: Float64Array): void {
  const reach = clamp(2 - (4 * footprint) / GROUND_GRAIN) * 2 * GROUND_WANDER;
  out[0] = out[1] = 0;
  if (reach === 0) return;
  const p = x / GROUND_GRAIN, q = z / GROUND_GRAIN;
  const ix = Math.floor(p), iz = Math.floor(q);
  const fx = (p - ix) * (p - ix) * (3 - 2 * (p - ix)), fz = (q - iz) * (q - iz) * (3 - 2 * (q - iz));
  const a = surfaceHash(ix, iz), b = surfaceHash(ix + 1, iz), c = surfaceHash(ix, iz + 1), d = surfaceHash(ix + 1, iz + 1);
  out[0] = (((high(a) * (1 - fx) + high(b) * fx) * (1 - fz) + (high(c) * (1 - fx) + high(d) * fx) * fz) - 0.5) * reach;
  out[1] = (((low(a) * (1 - fx) + low(b) * fx) * (1 - fz) + (low(c) * (1 - fx) + low(d) * fx) * fz) - 0.5) * reach;
}

/**
 * The tint a pixel of the ground takes from the four samples round it, a, b, c and d at the corners (0, 0), (1, 0),
 * (0, 1) and (1, 1) of their cell, where it lies at (fx, fz) in the cell: the tint with most of the bilinear weight
 * there, the first of them where two have as much. Where two covers meet, the edge runs where each has half the
 * weight, a curve across the cell rather than its side.
 */
export function groundCover(a: number, b: number, c: number, d: number, fx: number, fz: number): number {
  if (a === b && a === c && a === d) return a;
  const wa = (1 - fx) * (1 - fz), wb = fx * (1 - fz), wc = (1 - fx) * fz, wd = fx * fz;
  const sa = wa + (b === a ? wb : 0) + (c === a ? wc : 0) + (d === a ? wd : 0);
  const sb = (a === b ? wa : 0) + wb + (c === b ? wc : 0) + (d === b ? wd : 0);
  const sc = (a === c ? wa : 0) + (b === c ? wb : 0) + wc + (d === c ? wd : 0);
  const sd = (a === d ? wa : 0) + (b === d ? wb : 0) + (c === d ? wc : 0) + wd;
  let best = a, most = sa;
  if (sb > most) {
    best = b;
    most = sb;
  }
  if (sc > most) {
    best = c;
    most = sc;
  }
  return sd > most ? d : best;
}

/**
 * Where a pixel of the ground whose cover is `cover` (groundCover) meets another finish: of the four samples' tints
 * (as groundCover has them), the one whose finish has the most weight of those not `cover`'s finish, and how much of it
 * is wanted there, 0 away from the edge, 1/2 on it. Into `out`: the tint, or -1 for none, and the share. `finish`
 * gives a tint's finish.
 */
export function groundMeet(cover: number, a: number, b: number, c: number, d: number, fx: number, fz: number, finish: (tint: number) => number, out: Float64Array): void {
  const tints = [a, b, c, d], w = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz], f = tints.map(finish);
  const own = finish(cover);
  let mine = 0;
  for (let k = 0; k < 4; k++) if (f[k] === own) mine += w[k]!;
  out[0] = -1;
  out[1] = 0;
  let most = 0;
  for (let k = 0; k < 4; k++) {
    if (f[k] === own) continue;
    let sum = 0;
    for (let j = 0; j < 4; j++) if (f[j] === f[k]) sum += w[j]!;
    if (sum > most) {
      most = sum;
      out[0] = tints[k]!;
    }
  }
  if (out[0] >= 0) out[1] = clamp((most / (mine + most) - 0.5) * GROUND_MEET + 0.5);
}

/** The ground's sidewalk, whose edges are straight: no wander where it is one of a cell's four (groundWander), and `walkMeet`. */
export const GROUND_WALK = SURFACE_NAMES.indexOf("sidewalk");
/**
 * How much of the other finish shows where the sidewalk meets another, from groundMeet's share, a pixel `footprint`
 * metres wide: half on the line where the two finishes' samples weigh the same, none half a pixel to the cover's side
 * of it and all of it half a pixel to the other's, so a poured walk has an edge and not the higher finish's spill
 * (`higher`).
 */
export function walkMeet(share: number, footprint: number): number {
  return clamp((share - 0.5) / Math.max((footprint * GROUND_MEET) / TERRAIN_CELL, 1e-3) + 0.5);
}

/** Metres the ground's macros' tile spans, and a road's repairs' (content/surfaces.ts ROAD_MATERIAL, REPAIRS_MATERIAL). */
export const ROAD_MACRO = 32;
export const ROAD_REPAIRS = 8;
/** Tar, as light: the sealant over a patch's seams and in a sealed crack. */
const TAR = [0.03, 0.029, 0.027] as const;
/** How rough tar is, and the roughness a joint or a seal comes to. */
const TAR_ROUGH = 0.42;
const ASPHALT = SURFACE_NAMES.indexOf("asphalt"), SAND = SURFACE_NAMES.indexOf("sand"), SIDEWALK = SURFACE_NAMES.indexOf("sidewalk");
/** The finishes whose paint lets go to the concrete under it on a wall (`weathered`). */
const PEELED = SURFACE_NAMES.flatMap((name, i) => (SURFACE_WEATHERING[name].peel > 0 ? [i] : []));
/**
 * What reads each mask, in pairs: its slot in finish-near.ts's distances and the metres a tile it reads at. Asphalt and
 * sand the macro, a walk too for the stains of its panels; asphalt the repairs, and a walk for its panels' cracks.
 */
const MASK_READS: readonly (readonly number[])[] = [
  [ASPHALT, ROAD_MACRO, SAND, ROAD_MACRO, SIDEWALK, 3],
  [ASPHALT, ROAD_REPAIRS, SIDEWALK, ROAD_REPAIRS],
];
/** The beach's second copy of its macro: turned an eighth and this many metres a tile, so the two never line up. */
const BEACH_TURN = Math.SQRT1_2, BEACH_SECOND = 41;
const roadMask = new Float64Array(4);

/**
 * The ground's wear at map point (x, z) where its finish `id` is asphalt or sand, a pixel `footprint` metres wide, onto
 * albedo and orm (worldSurface's). Sand takes the beach's macro, two copies at angles. Asphalt takes a used road's
 * macro and its repairs in 8 m squares on the world's axes, each square with its own share of patches and of sealed
 * cracks and its own place in their tile, by a hash of where it is; open cracks are in every square.
 */
/**
 * Floats of a road's frame at a point (roadFrameAt): along and across in metres, how sure, along's and across's rise a
 * metre along x and z, then the carriageway's half width in metres, its lanes, 1 where it is one way, and how worn its
 * class is from 0 to 1.
 */
export const ROAD_FRAME = 11;

const corners = new Uint8Array(4 * ROAD_PLANES);

/**
 * The road's frame at map point (x, z) from what is held of a map's (Heightfield `road`), into `out`: along and across
 * between its four cells round the point, along unwrapped from the first's; how sure the four are one road's (0 to 1): 0
 * off a road or where none is held, where they are not one carriageway's, or where they do not lie in one plane, as where
 * two roads' frames meet at a crossing; along's and across's rise a metre along x and z there; and the carriageway's own.
 */
export function roadFrameAt(held: RoadSectors, x: number, z: number, out: Float64Array): void {
  out.fill(0);
  const qx = x / ROAD_CELL, qz = z / ROAD_CELL, i = Math.floor(qx), j = Math.floor(qz);
  const road = corners, a = 0, b = ROAD_PLANES, c = 2 * ROAD_PLANES, d = 3 * ROAD_PLANES;
  if (!held.cell(i, j, road, a) || !held.cell(i + 1, j, road, b) || !held.cell(i, j + 1, road, c) || !held.cell(i + 1, j + 1, road, d)) return;
  const fx = qx - i, fz = qz - j;
  if (road[a] === 0 || road[b] === 0 || road[c] === 0 || road[d] === 0) return;
  for (const k of [b, c, d]) if (road[k + 2] !== road[a + 2] || road[k + 3] !== road[a + 3]) return;
  const ca = (road[a]! - 128) / ROAD_ACROSS, cb = (road[b]! - 128) / ROAD_ACROSS, cc = (road[c]! - 128) / ROAD_ACROSS, cd = (road[d]! - 128) / ROAD_ACROSS;
  const la = road[a + 1]! / ROAD_ALONG;
  const on = (v: number): number => la + ((((v / ROAD_ALONG - la + ROAD_WRAP / 2) % ROAD_WRAP) + ROAD_WRAP) % ROAD_WRAP) - ROAD_WRAP / 2;
  const lb = on(road[b + 1]!), lc = on(road[c + 1]!), ld = on(road[d + 1]!);
  const bent = Math.abs(ca + cd - cb - cc) + Math.abs(la + ld - lb - lc);
  out[3] = ((lb - la) * (1 - fz) + (ld - lc) * fz) / ROAD_CELL;
  out[4] = ((lc - la) * (1 - fx) + (ld - lb) * fx) / ROAD_CELL;
  out[5] = ((cb - ca) * (1 - fz) + (cd - cc) * fz) / ROAD_CELL;
  out[6] = ((cc - ca) * (1 - fx) + (cd - cb) * fx) / ROAD_CELL;
  out[0] = (la * (1 - fx) + lb * fx) * (1 - fz) + (lc * (1 - fx) + ld * fx) * fz;
  out[1] = (ca * (1 - fx) + cb * fx) * (1 - fz) + (cc * (1 - fx) + cd * fx) * fz;
  out[2] = clamp(2 - 2 * bent) * clamp(1 - Math.abs(Math.sqrt(out[5] * out[5] + out[6] * out[6]) - 1) * 4);
  out[7] = road[a + 2]! / ROAD_HALF;
  out[8] = road[a + 3]! & 7;
  out[9] = road[a + 3]! & ROAD_ONE_WAY ? 1 : 0;
  out[10] = (road[a + 3]! >> ROAD_WEAR_SHIFT) / 6;
}

/** A band of `g` round `centre`, `half` either side, spread over `blur` where that is wider, its weight kept. */
const roadBand = (g: number, centre: number, half: number, blur: number): number => {
  const w = Math.max(half, blur);
  return (1 - smooth(w * 0.5, w, Math.abs(g - centre))) * (half / w);
};

/**
 * The ground's wear at map point (x, z) where its finish `id` is asphalt or sand, a pixel `footprint` metres wide, onto
 * albedo and orm (worldSurface's). Sand takes the beach's macro, two copies at angles. Asphalt takes a used road's
 * macro and its repairs. Where the road's frame (roadFrameAt) is sure they lie along the carriageway, its lanes laid out
 * from its edge, with a wheel path under each pair of wheels of a lane and oil between them, sealed joints between its
 * lanes, dirt in its gutters, and its repairs a lane wide by 8 m; elsewhere, as on a lot, in 8 m squares on the world's
 * axes. Each cell has its own share of patches and sealed cracks and its own place in their tile, by where it is. `kerb`,
 * where 0 or more, is how far in from a raised kerb the point is (streetCover), and the gutter runs along that line; -2
 * where the streets say the edge is flush, which has none; -1 where they say nothing, and the frame's line has it.
 */
export function roadWorn(albedo: Out, orm: Out, id: number, x: number, z: number, footprint: number, sample: WorldSample, frame: Numbers | null = null, kerb = -1): void {
  const level = (metres: number): number => Math.log2(Math.max(footprint / metres, 1e-9));
  if (id === SAND) {
    sample(2, ROAD_LAYER, x / ROAD_MACRO, z / ROAD_MACRO, level(ROAD_MACRO), roadMask);
    const first = roadMask[1]!;
    sample(2, ROAD_LAYER, (x - z) * BEACH_TURN / BEACH_SECOND + 0.37, (x + z) * BEACH_TURN / BEACH_SECOND + 0.71, level(BEACH_SECOND), roadMask);
    const k = (1 + (first - 0.5) * ROAD_LOOK.beach) * (1 + (roadMask[1]! - 0.5) * ROAD_LOOK.beach * 0.5);
    for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! * k;
    return;
  }
  if (id !== ASPHALT) return;
  // Along a sure frame, u is across the carriageway and v along it; elsewhere x and z.
  const sure = frame ? frame[2]! : 0, along = sure > 0.5;
  const u = along ? frame![1]! : x, v = along ? frame![0]! : z;
  sample(2, ROAD_LAYER, u / ROAD_MACRO, v / ROAD_MACRO, level(ROAD_MACRO), roadMask);
  let shade = 1 + (roadMask[0]! - 0.5) * ROAD_LOOK.macro;
  let rough = orm[1]! * (1 + (roadMask[2]! - 0.5) * 0.25 * ROAD_LOOK.macroRough);
  let wide = ROAD_REPAIRS, from0 = 0, joint = 0;
  if (along) {
    const s = smooth(0.5, 1, sure), half = frame![7]!, lane = (2 * half) / frame![8]!, worn = (0.4 + 0.6 * frame![10]!) * s * smooth(0, 0.3, half - Math.abs(u));
    const t = (u + half) / lane, k = Math.floor(t), g = t - k, blur = footprint / lane;
    const wheels = roadBand(g, 0.27, 0.075, blur) + roadBand(g, 0.73, 0.075, blur);
    const oil = roadBand(g, 0.5, 0.07, blur) * (0.4 + 1.2 * surfaceNoise(v / 5.3, k * 3.1));
    const gutter = kerb > -1.5 && kerb < 0 ? roadBand(Math.abs(u), half - 0.25, 0.25, footprint) * s : 0;
    shade *= (1 - wheels * ROAD_LOOK.wheels * worn) * (1 - oil * ROAD_LOOK.oil * worn) * (1 - gutter * ROAD_LOOK.gutter);
    rough += gutter * 0.1 - (wheels * 0.06 + oil * 0.1) * worn;
    // The joint between two lanes nearest, sealed along some of its 8 m, by where each 8 m's middle is.
    const kb = Math.round(t), cell = Math.floor(v / ROAD_REPAIRS), mid = (cell + 0.5) * ROAD_REPAIRS;
    const jx = x + frame![3]! * (mid - v) + frame![5]! * ((kb - t) * lane), jz = z + frame![4]! * (mid - v) + frame![6]! * ((kb - t) * lane);
    if (kb >= 1 && kb < frame![8]! && surfaceHash(Math.floor(jx / ROAD_REPAIRS) * 7 + kb, Math.floor(jz / ROAD_REPAIRS) * 13 + 977) < ROAD_LOOK.joint) {
      joint = roadBand((t - kb) * lane + (surfaceNoise(v / 3.1, kb * 5.5) - 0.5) * 0.08, 0, 0.035, footprint) * s;
    }
    wide = lane;
    from0 = -half;
  }
  if (kerb >= 0) {
    const gutter = roadBand(kerb, 0.25, 0.25, footprint);
    shade *= 1 - gutter * ROAD_LOOK.gutter;
    rough += gutter * 0.1;
  }
  // The repairs of this lane's or this square's 8 m: where in their tile, and whether patched and sealed, by where its middle is.
  const ku = Math.floor((u - from0) / wide), kv = Math.floor(v / ROAD_REPAIRS);
  const mu = from0 + (ku + 0.5) * wide, mv = (kv + 0.5) * ROAD_REPAIRS;
  const h = along
    ? surfaceHash(Math.floor((x + frame![3]! * (mv - v) + frame![5]! * (mu - u)) / ROAD_REPAIRS) * 7 + ku, Math.floor((z + frame![4]! * (mv - v) + frame![6]! * (mu - u)) / ROAD_REPAIRS) * 13 + kv)
    : surfaceHash(ku * 8, kv * 14);
  const edge = smooth(0, 0.4, Math.min(u - from0 - ku * wide, from0 + (ku + 1) * wide - u, v - kv * ROAD_REPAIRS, (kv + 1) * ROAD_REPAIRS - v));
  sample(2, REPAIRS_LAYER, u / ROAD_REPAIRS + fract(h * 7.13), v / ROAD_REPAIRS + fract(h * 3.71), level(ROAD_REPAIRS), roadMask);
  const patched = h < ROAD_LOOK.patched ? edge : 0, sealed = fract(h * 13.7) < ROAD_LOOK.sealed ? edge : 0, from = 0.35 + 0.4 * fract(h * 5.3);
  const patch = roadMask[0]! * patched, seam = roadMask[1]! * patched, seal = smooth(from, from + 0.15, roadMask[2]!) * sealed;
  const dim = shade * (1 - 0.2 * patch) * (1 - 0.3 * roadMask[3]! * edge);
  rough -= 0.08 * patch;
  // A lane joint's seal is as rough as the road round it, and lighter than a patch's: it does not mirror the sky.
  const sealant = Math.max(seam, seal) * 0.9, tar = Math.max(joint * 0.6, sealant);
  for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! * dim * (1 - tar) + TAR[c]! * tar;
  orm[1] = clamp(rough * (1 - sealant) + TAR_ROUGH * sealant, 0.12, 1);
}

/** Dirt and grass in a walk's joints, as light, and the metres either side of a joint's line the most of each reaches. */
const DIRT = [0.08, 0.066, 0.048] as const, GRASS = [0.03, 0.055, 0.014] as const;
const JOINT_DIRT = 0.008, JOINT_GRASS = 0.035;
const walkMask = new Float64Array(4);
/** How much of a pixel `footprint` metres wide, `d` metres from a line's middle, the line `half` metres either side of it covers. */
const covered = (d: number, half: number, footprint: number): number => {
  const f = Math.max(footprint, 1e-4);
  return clamp((half - d) / f + 0.5) * clamp((2 * half) / f);
};

/**
 * A poured walk's wear at map point (x, z) where finish `id` is the sidewalk, a pixel `footprint` metres wide, onto
 * albedo, orm and normal (worldSurface's), by its panels (the finish's module, half its tile) and their joints. Each
 * panel by a hash of where it is takes its own tone and may be stained (the road's macro), cracked (the repairs' cracks)
 * or sunk, leaning a little one way; each joint's piece, a panel's side, may hold grass or dirt along it, in patches.
 */
export function walkWorn(albedo: Out, orm: Out, normal: Out, id: number, x: number, z: number, footprint: number, city: Numbers, sample: WorldSample, place: Numbers | null = null): void {
  if (id !== GROUND_WALK) return;
  const panel = finishMetres(id, city) / 2;
  // Along a street's walk (streetCover) its panels run along it, a row from its inner edge: `place` is where in that frame.
  const gu = (place ? place[0]! : x) / panel, gv = (place ? place[1]! : z) / panel, ku = Math.floor(gu), kv = Math.floor(gv), fu = gu - ku, fv = gv - kv;
  const h = surfaceHash(ku * 5 + 3, kv * 9 + 1);
  const du = Math.min(fu, 1 - fu) * panel, dv = Math.min(fv, 1 - fv) * panel, d = Math.min(du, dv);
  // The joint nearest, by the panels' corner it starts at and which way it runs.
  const hj = du < dv ? surfaceHash((ku + (fu > 0.5 ? 1 : 0)) * 7, kv * 13 + 5) : surfaceHash(ku * 7 + 3, (kv + (fv > 0.5 ? 1 : 0)) * 13);
  const inner = clamp((d - 0.02) / 0.05);
  let shade = 1 + (fract(h * 3.1) - 0.5) * WALK_LOOK.tone, rough = orm[1]!;
  if (fract(h * 7.7) < WALK_LOOK.stained) {
    sample(2, ROAD_LAYER, x / 3 + fract(h * 5.3), z / 3 + fract(h * 9.1), Math.log2(Math.max(footprint / 3, 1e-9)), walkMask);
    const stain = smooth(0.45, 0.75, walkMask[0]!) * inner;
    shade *= 1 - 0.22 * stain;
    rough += 0.05 * stain;
  }
  if (fract(h * 11.3) < WALK_LOOK.cracked) {
    sample(2, REPAIRS_LAYER, x / ROAD_REPAIRS + fract(h * 2.9), z / ROAD_REPAIRS + fract(h * 6.7), Math.log2(Math.max(footprint / ROAD_REPAIRS, 1e-9)), walkMask);
    const from = 0.2 + 0.2 * fract(h * 4.1), crack = smooth(from, from + 0.12, walkMask[2]!) * inner;
    shade *= 1 - 0.5 * crack;
    rough += 0.1 * crack;
  }
  let gap = 0;
  if (fract(h * 13.9) < WALK_LOOK.sunk) {
    const a = fract(h * 17.3) * 2 * Math.PI;
    normal[0] = normal[0]! + Math.cos(a) * WALK_LOOK.lean;
    normal[2] = normal[2]! + Math.sin(a) * WALK_LOOK.lean;
    const l = Math.hypot(normal[0]!, normal[1]!, normal[2]!);
    for (let c = 0; c < 3; c++) normal[c] = normal[c]! / l;
    gap = covered(d, 0.008, footprint) * 0.5;
  }
  shade *= 1 - gap;
  for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! * shade;
  // Along the joint in patches a quarter of a metre or so, grass in tufts a few centimetres apart.
  const along = du < dv ? gv : gu, patchy = surfaceNoise(along * 6 + hj * 50, hj * 31);
  if (fract(hj * 3.7) < WALK_LOOK.grass) {
    const tufts = 0.35 + 0.65 * surfaceNoise(along * 40 + hj * 17, hj * 13);
    const g = covered(d, JOINT_GRASS * smooth(0.35, 0.8, patchy) * tufts, footprint) * 0.9;
    for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! * (1 - g) + GRASS[c]! * g;
    rough = rough * (1 - g) + 0.9 * g;
  } else if (fract(hj * 5.9) < WALK_LOOK.dirt) {
    const k = covered(d, JOINT_DIRT * (0.5 + patchy), footprint) * 0.75;
    for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! * (1 - k) + DIRT[c]! * k;
    rough = rough * (1 - k) + 0.95 * k;
  }
  orm[1] = clamp(rough, 0.12, 1);
}

const fl = (n: number): string => Number.isInteger(n) ? n.toFixed(1) : String(n);
const vectors = (name: string, rows: readonly (readonly number[])[]): string => {
  const t = `vec${rows[0]!.length}`;
  return `const ${t} ${name}[${N}] = ${t}[${N}](${rows.map((a) => `${t}(${a.map(fl).join(",")})`).join(",")});\n`;
};
/** Adds a material index to FLAT's mesh vertex texts, and gives the colour as light, keeping the low-poly texts byte-for-byte. */
export function worldVertex(vertex: string): string {
  const table = Array.from({ length: 256 }, (_, i) => surfaceIndex(i, false));
  const lookup = `#ifdef STREET_FINISH\nuniform float uFixture;\nflat out int vFixture;\n${fixtureShader()}\n#endif\nflat out int vSurface;\nconst int SURFACE_IDS[256] = int[256](${table.join(",")});\n`;
  const light = "  vColor = mix(vColor / 12.92, pow((vColor + 0.055) / 1.055, vec3(2.4)), step(0.04045, vColor));\n";
  return vertex.replace("out vec3 vRel;", lookup + "out vec3 vRel;").replace("  vRel = p;", `#ifdef STREET_FINISH\n  int fixture = uFixture < 0.0 ? int(aBone >> 6u) : int(uFixture);\n  vFixture = fixtureFace(fixture,i,l);\n#endif\n  vSurface = SURFACE_IDS[int(i)];\n${light}  vRel = p;`);
}

/**
 * A static's own frame, for its walls' weathering and edges and for whatever else is drawn on a wall. Adds to FLAT's
 * mesh vertex text, after worldVertex, on the lit tiers that read the finishes in full (programs.ts, WORLD_WEATHER):
 *
 * - vOwn (vec3, metres): the vertex in its instance's own frame, its mesh's position sized; x and z turn with the
 *   instance's yaw, y is up from its origin. A near chunk mesh's frame is the chunk's (shared/world/city.ts).
 * - vPlace (flat vec2, quarter metres): the instance's origin in the world, x and z, rounded (staticPlace). Its seed,
 *   from 0 to 1, is surfaceHash(ivec2(vPlace)) (staticSeed): storeys stacked on one bay share it, neighbours do not;
 *   a near chunk's statics share their chunk's.
 * - vFace (vec2, 0 to 1): across and up the face, from its corners, where the mesh says them (aBone, a body's bone
 *   byte, which a static keeps for this: bits 0 and 1 its corner, shared/world/city.ts cornerByte); 0 where it does not.
 * - vEdges (flat uint, bits): which of the face's borders are outer edges, u at 0, u at 1, v at 0, v at 1 (bits 2 to 5
 *   of aBone); 0 where none or unknown.
 *
 * A fragment reads its wall with staticWall (GLSL, after WORLD_GLSL) or weatherFrame (TypeScript): the face's normal in
 * the own frame from vOwn's steps between pixels; metres along the wall, the way a reader facing it reads (vOwn.x or
 * vOwn.z); metres over the ground (skyopen.ts overGround); the storey, of WEATHER_STOREY (4 m) from the ground; the bay,
 * of WEATHER_BAY (8 m) along; and the seed. A face's size and its nearest outer border come from vFace's and vRel's
 * steps between pixels (edgeOf).
 */
export function ownVertex(vertex: string): string {
  if (!vertex.includes("out vec3 vRel;") || !vertex.includes("  vRel = p;")) throw new Error("ownVertex: not a flat mesh vertex text");
  return vertex.replace("out vec3 vRel;", "out vec3 vRel;\nout vec3 vOwn;\nflat out vec2 vPlace;\nout vec2 vFace;\nflat out uint vEdges;\nuniform vec3 uWorldEye;")
    .replace("  vRel = p;", "  vOwn = l;\n  vPlace = floor((iPos + uOffset + uWorldEye).xz * 4.0 + 0.5);\n  vFace = vec2(float(aBone & 1u), float((aBone >> 1u) & 1u));\n  vEdges = uSkin > 0.5 ? 0u : (aBone >> 2u) & 15u;\n  vRel = p;");
}

/** The tints whose finish differs on the desert's ground (content/surfaces.ts surfaceIndex): its open land, all of one finish. */
const desert = Array.from({ length: 256 }, (_, i) => i).filter((i) => surfaceIndex(i, true, "las-vegas") !== surfaceIndex(i, true));

/**
 * Same operations as worldSurface, on finish `id` at the pixel `rel` from the eye, which moves `dx` and `dy` to the
 * next pixels: `face` is the face's normal and `n` the one the light falls on, the same on everything but the ground.
 * Texture reads take their footprint from those steps, so they may be made where pixels go different ways.
 */
export const WORLD_GLSL = `
uniform vec3 uWorldEye;
uniform vec3 uWorldPhase[${N}];
uniform vec4 uSurfaceCity[3];
uniform float uWorldReady;
uniform highp sampler2DArray uWorldBase, uWorldNormal, uWorldOrm;
uniform vec3 uWorldLeast[${WORLD_LAYERS}];
#ifndef WORLD_TAPS
#define WORLD_TAPS 16.0
#endif
${vectors("WF", finishes.map((f) => [f.metres, f.bump, f.rough, f.metal]))}
${vectors("WT", finishes.map((f) => [...f.tint, f.palette]))}
${vectors("WW", finishes.map((f) => [f.weather, f.wetness, f.growth, f.mean[1]!]))}
${vectors("WO", finishes.map((f) => [...f.mean, 0.5]))}
${vectors("WB", finishes.map((f) => f.base))}
${vectors("WM", finishes.map((f) => [...f.module, f.height, f.lift]))}const float WS[${N}] = float[${N}](${finishes.map((f) => fl(f.patch)).join(",")});

float surfaceHash(ivec2 p) {
  uint h = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  return float((h ^ (h >> 13u)) >> 8u) / 16777216.0;
}
float surfaceNoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(surfaceHash(i), surfaceHash(i + ivec2(1,0)), f.x), mix(surfaceHash(i + ivec2(0,1)), surfaceHash(i + ivec2(1,1)), f.x), f.y);
}
float higher(float a, float b, float t, float scale, float band) {
  float ha = a + 2.0 * scale * (1.0 - t), hb = b + 2.0 * scale * t, top = max(ha, hb) - band;
  float wa = max(ha - top, 0.0), wb = max(hb - top, 0.0);
  return wb / (wa + wb);
}
// A read of an array's layer at q held to the finest level of it on the card, \`least\` levels over the array's base
// (FramePacket worldLeast): where the card could read finer, the steps between pixels are widened until it cannot, a
// slanted read taken as the next power of two taps up to the tier's anisotropy, and its footprint's narrow way never under
// a texel, as a card may take the level from that however slanted. A level never put on the card is never read (heldWidening).
vec4 worldGrad(highp sampler2DArray s, vec2 q, int layer, vec2 dx, vec2 dy, float least) {
  if (least > 0.0) {
    float side = float(textureSize(s, 0).x), a = length(dx) * side, b = length(dy) * side, major = max(max(a, b), 1e-9);
    float minor = max(abs(dx.x * dy.y - dx.y * dy.x) * side * side / major, 1e-9);
    float k = max(1.0, exp2(least) * max(min(exp2(ceil(log2(major / max(min(a, b), 1e-9)))), WORLD_TAPS) / major, 1.0 / minor));
    dx *= k;
    dy *= k;
  }
  return textureGrad(s, vec3(q, float(layer)), dx, dy);
}
vec4 worldBase(vec2 q, int layer, vec2 dx, vec2 dy) { return worldGrad(uWorldBase, q, layer, dx, dy, uWorldLeast[layer].x); }
vec4 worldNormal(vec2 q, int layer, vec2 dx, vec2 dy) { return worldGrad(uWorldNormal, q, layer, dx, dy, uWorldLeast[layer].y); }
vec4 worldOrm(vec2 q, int layer, vec2 dx, vec2 dy) { return worldGrad(uWorldOrm, q, layer, dx, dy, uWorldLeast[layer].z); }
vec2 lean(vec4 nn) { return (nn.WORLD_NORMAL * 255.0 - 128.0) / 127.5; }
// Where tile point q is on a finish's second copy, turned and moved or moved by whole modules.
vec2 secondAt(vec2 q, int id) {
  vec2 m = WM[id].xy;
  return m.x == 0.0 ? vec2(-q.y + ${fl(SHIFT[0])}, q.x + ${fl(SHIFT[1])}) : q + m * vec2(${fl(MODULES[0])}, ${fl(MODULES[1])});
}
#ifdef WORLD_RELIEF
// Where the ray to the eye along view (across, down the tile, out of the face) first meets the painted height, depth tiles deep (relief's twin).
vec2 worldRelief(int id, vec2 q, vec2 dx, vec2 dy, vec3 view, float depth, bool second) {
  vec2 along = -view.xy / view.z * depth / ${fl(RELIEF_STEPS)};
  bool turned = second && WM[id].x == 0.0;
  vec2 gx = turned ? vec2(-dx.y, dx.x) : dx, gy = turned ? vec2(-dy.y, dy.x) : dy;
  float above = 1.0 - worldOrm(second ? secondAt(q, id) : q, id, gx, gy).a, under = 0.0;
  int k = 1;
  for (; k <= ${RELIEF_STEPS}; k++) {
    vec2 p = q + along * float(k);
    under = worldOrm(second ? secondAt(p, id) : p, id, gx, gy).a - (1.0 - float(k) / ${fl(RELIEF_STEPS)});
    if (under >= 0.0) break;
    above = -under;
  }
  return q + along * (k > ${RELIEF_STEPS} ? ${fl(RELIEF_STEPS)} : above + under > 0.0 ? float(k - 1) + above / (above + under) : float(k - 1));
}
#endif
// A finish's maps at tile point q, its second copy shown over the first where the noise says, the higher showing; read
// where the ray to the eye meets the painted height where depth is more than 0.
void finishMaps(int id, vec2 q, vec2 dx, vec2 dy, vec3 view, float depth, out vec4 base, out vec4 mro, out vec2 bump, out float tone) {
  bool turned = WM[id].x == 0.0;
  float second = clamp((surfaceNoise(q * ${fl(WORLD_PATCH)} + vec2(5.3, 1.7)) - 0.35) / 0.3, 0.0, 1.0);
  second = second * second * (3.0 - 2.0 * second);
#ifdef WORLD_LIGHT
  float far = 1.0;
#else
  float far = clamp((log2(max(length(dx), length(dy))) - ${fl(WORLD_FAR)}) / ${fl(WORLD_FAR_BAND)}, 0.0, 1.0);
#endif
  float t = second * (1.0 - far);
  // Nothing come yet (uWorldReady 3): the finish is its means, so what comes sharpens it and never recolours it.
  if (uWorldReady > 2.5) {
    base = WB[id];
    mro = WO[id];
    bump = vec2(0.0);
    tone = second;
    return;
  }
  // 1 while the base colours alone have come: the rest stand at their means, and the copies meet by their noise.
  float early = clamp(uWorldReady - 1.0, 0.0, 1.0);
#ifdef WORLD_RELIEF
  if (depth > 0.0 && early < 1.0) q = worldRelief(id, q, dx, dy, view, depth, t >= 0.5);
#endif
  vec2 qb = secondAt(q, id);
  vec2 bx = turned ? vec2(-dx.y, dx.x) : dx, by = turned ? vec2(-dy.y, dy.x) : dy;
  vec4 b0 = vec4(0.0), r0 = vec4(0.0), b1 = vec4(0.0), r1 = vec4(0.0);
  vec2 n0 = vec2(0.0), n1 = vec2(0.0);
  if (t < 1.0) {
    b0 = worldBase(q, id, dx, dy);
    if (far < 1.0 && early < 1.0) {
      r0 = worldOrm(q, id, dx, dy);
      n0 = lean(worldNormal(q, id, dx, dy));
    }
  }
  if (t > 0.0) {
    b1 = worldBase(qb, id, bx, by);
    if (early < 1.0) {
      r1 = worldOrm(qb, id, bx, by);
      n1 = lean(worldNormal(qb, id, bx, by));
      if (turned) n1 = vec2(-n1.y, n1.x);
    }
  }
  float s = t <= 0.0 ? 0.0 : t >= 1.0 ? 1.0 : mix(higher(r0.a, r1.a, t, 1.0, ${fl(WORLD_BAND)}), t, early);
  tone = mix(s, second, far);
  base = mix(b0, b1, s);
  mro = mix(mix(mix(r0, r1, s), WO[id], far), WO[id], early);
  bump = far >= 1.0 || early >= 1.0 ? vec2(0.0) : mix(n0, n1, s) * (1.0 - far) * (1.0 - early);
}
// Whether the finish is smooth enough to mirror the sky as a picture (worldSharp's twin), set by worldSurface.
bool worldSharp = false;
// Returns the height in millimetres with the finish's lift.
float worldSurface(inout vec3 albedo, out vec3 orm, inout vec3 n, vec3 face, int id, vec3 rel, vec3 dpx, vec3 dpy) {
  vec4 f = WF[id], tint = WT[id], w = WW[id];
  vec3 an = abs(face);
  int axis = an.y >= max(an.x,an.z) ? 1 : an.x > an.z ? 0 : 2;
  float metres = f.x * uSurfaceCity[0].w;
  vec3 phase = uWorldPhase[id];
  vec2 q = axis == 1 ? rel.xz / metres + phase.xz : axis == 0 ? vec2(rel.z / metres + phase.z, -rel.y / metres - phase.y) : vec2(rel.x / metres + phase.x, -rel.y / metres - phase.y);
  vec2 dx = (axis == 1 ? dpx.xz : axis == 0 ? vec2(dpx.z, -dpx.y) : vec2(dpx.x, -dpx.y)) / metres;
  vec2 dy = (axis == 1 ? dpy.xz : axis == 0 ? vec2(dpy.z, -dpy.y) : vec2(dpy.x, -dpy.y)) / metres;
  vec4 base, mro; vec2 bump; float tone;
  vec3 view = vec3(0.0, 0.0, 1.0);
  float depth = 0.0;
#ifdef WORLD_RELIEF
  vec3 e = -normalize(rel);
  view = vec3(axis == 0 ? e.z : e.x, axis == 1 ? e.z : -e.y, axis == 1 ? e.y * sign(face.y) : axis == 0 ? e.x * sign(face.x) : e.z * sign(face.z));
  if (view.z > 0.1) depth = WM[id].z * 0.001 / metres * clamp(2.0 - max(length(dx), length(dy)) * ${fl(RELIEF_TEXELS)}, 0.0, 1.0);
#endif
  finishMaps(id, q, dx, dy, view, depth, base, mro, bump, tone);
  vec3 p = rel + uWorldEye;
  float macro = surfaceNoise(vec2(p.x/37.0+p.y/53.0,p.z/37.0));
#ifdef WORLD_LIGHT
  float stain = 0.0;
  bump = vec2(0.0);
#else
  float stain = 0.75*surfaceNoise(vec2(p.x/8.0+p.z/19.0,p.y/17.0+p.z/11.0))+0.25*surfaceNoise(vec2(p.x/2.9+p.z/7.3,p.y/4.1+p.z/3.7));
#endif
  float weather = w.x*uSurfaceCity[1].x;
  float wet = clamp(w.y+uSurfaceCity[1].y,0.0,1.0);
  float growth = clamp((w.z+uSurfaceCity[1].z)*clamp((macro-0.42)*3.0,0.0,1.0)*(face.y>0.2?1.0:0.4),0.0,1.0);
  albedo = base.rgb*(1.0+(clamp(albedo/0.3,0.18,2.2)-1.0)*tint.w*base.a)*tint.rgb*uSurfaceCity[0].rgb;
  albedo *= (1.0+(macro-0.5)*0.5-stain*weather*0.5)*(1.0+(tone-0.5)*WS[id])*(1.0-wet*0.28)*mix(vec3(1.0),vec3(0.55,0.75,0.35),growth);
  float z = sqrt(max(0.0, 1.0 - dot(bump, bump)));
  bump *= f.y*uSurfaceCity[2].x;
  n = normalize(n * z + (axis==1 ? vec3(bump.x,0.0,-bump.y) : axis==0 ? vec3(0.0,bump.y,bump.x) : vec3(bump.x,bump.y,0.0)));
  orm = vec3(mro.r,clamp(mro.g*f.z-wet*0.35,0.12,1.0),mro.b*f.w);
  worldSharp = orm.y < ${fl(WORLD_SHARP)};
  return mro.a * WM[id].z + WM[id].w;
}
#ifdef WORLD_WEATHER
${vectors("WX", weatherings.map((w) => [w.runs, w.damp, w.peel, w.joints]))}const float WV[${N}] = float[${N}](${weatherings.map((w) => fl(w.value)).join(",")});
const vec3 WL[${N}] = vec3[${N}](${weatherings.map((w) => `vec3(${LEFT[w.left].map(fl).join(",")})`).join(",")});
${vectors("WY", weatherings.map((w) => [w.drips, w.splash, w.bleach, w.algae]))}const float WZ[${N}] = float[${N}](${weatherings.map((w) => fl(w.salt)).join(",")});
uniform highp sampler2DArray uWeather;
uniform float uWeatherReady;
uint weatherHash(int a, int b, int c) {
  uint h = uint(a) * 1597334677u ^ uint(b) * 3812015801u ^ uint(c) * 2654435761u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return h ^ (h >> 16u);
}
float weatherUnit(int a, int b, int c) {
  return float(weatherHash(a, b, c) >> 8u) / 16777216.0;
}
bool wallFrame(vec3 p, vec3 n, out float along, out ivec2 keys, out float share, out int side) {
  bool wall = abs(n.y) < 0.5, facesX = wall && abs(n.x) > abs(n.z);
  along = facesX ? p.z : p.x;
  float plane = facesX ? p.x : p.z, slope = !wall ? 0.0 : facesX ? -n.z / n.x : -n.x / n.z;
  side = facesX ? (n.x > 0.0 ? 0 : 1) : (n.z > 0.0 ? 2 : 3);
  float centre = (floor(along / ${fl(WEATHER_BAY)}) + 0.5) * ${fl(WEATHER_BAY)};
  float cell = (plane + (centre - along) * slope - ${fl(PLANE_EDGE)}) / ${fl(PLANE_CELL)}, edge = floor(cell + 0.5);
  keys = wall ? ivec2(int(edge) * 4 - 4 + side, int(edge) * 4 + side) : ivec2(0);
  share = wall ? smoothstep(${fl(-PLANE_BLEND)}, ${fl(PLANE_BLEND)}, (cell - edge) * ${fl(PLANE_CELL)}) : 0.0;
  return wall;
}
float bayTone(float along, int key) {
  float edge = floor(along / ${fl(WEATHER_BAY)} + 0.5);
  return mix(weatherUnit(int(edge) - 1, key, 977), weatherUnit(int(edge), key, 977), smoothstep(${fl(-TONE_BLEND)}, ${fl(TONE_BLEND)}, along - edge * ${fl(WEATHER_BAY)}));
}
vec4 stamped(int bay, int storey, int key, float u, float down, vec2 gx, vec2 gy, out vec2 leakRust) {
  uint h = weatherHash(bay, storey, key);
  float flip = ((h >> 16u) & 1u) == 1u ? -1.0 : 1.0;
  leakRust = vec2(float((h >> 17u) & 127u) / 127.0, (h >> 24u) < 154u ? 1.0 : 0.0);
  vec2 q = vec2(flip < 0.0 ? 1.0 - u : u, (float((bay + storey) & 1) + ${fl(WEATHER_PAD)} + down * ${fl(1 - 2 * WEATHER_PAD)}) * 0.5);
  return textureGrad(uWeather, vec3(q, float(((h & 65535u) * ${WEATHER_BAYS}u) >> 16u)), vec2(gx.x * flip, gx.y), vec2(gy.x * flip, gy.y));
}
float coveredLine(float d, float hw, float f) {
  f = max(f, 1e-4);
  return clamp((hw - d) / f + 0.5, 0.0, 1.0) * clamp(2.0 * hw / f, 0.0, 1.0);
}
// formwork's twin.
float formwork(float along, float over, float footprint) {
  float panel = floor(along / 2.0 + 0.5), storey = floor(over / ${fl(WEATHER_STOREY)}), s = over - storey * ${fl(WEATHER_STOREY)};
  float across = abs(along - panel * 2.0 + (surfaceNoise(vec2(over / 0.7, panel * 3.1)) - 0.5) * 0.008);
  float lift = floor(s / 2.0 + 0.5), up = abs(s - lift * 2.0 + (surfaceNoise(vec2(along / 0.7, storey * 5.3 + lift)) - 0.5) * 0.008);
  float hw = 0.0045 + 0.003 * surfaceNoise(vec2(along / 0.3 + over / 0.5, storey * 1.7));
  float a = along - floor(along / 2.0) * 2.0, b = s - floor(s / 2.0) * 2.0;
  float ha = a - (0.38 + 0.62 * clamp(floor((a - 0.38) / 0.62 + 0.5), 0.0, 2.0)), hb = b - (0.38 + 0.62 * clamp(floor((b - 0.38) / 0.62 + 0.5), 0.0, 2.0));
  return max(max(coveredLine(across, hw, footprint), coveredLine(up, hw, footprint)), coveredLine(sqrt(ha * ha + hb * hb), 0.0125, footprint) * 0.8);
}
// weathered's twin, on a static at the pixel rel from the eye, over metres over the ground with open of the sky's
// light; face, dpx and dpy are LIT's.
void weathered(inout vec3 albedo, inout vec3 orm, int id, float over, float open, vec3 rel, vec3 face, vec3 dpx, vec3 dpy) {
  float ox = dFdx(over), oy = dFdy(over);
  vec3 p = rel + uWorldEye;
  float along, share;
  ivec2 keys;
  int side;
  bool wall = wallFrame(p, face, along, keys, share, side), both = share > 0.0 && share < 1.0;
  int bay = int(floor(along / ${fl(WEATHER_BAY)})), storey = int(floor(over / ${fl(WEATHER_STOREY)})), key = share < 1.0 ? keys.x : keys.y;
  float column = !wall ? 0.5 : both ? mix(bayTone(along, keys.x), bayTone(along, keys.y), share) : bayTone(along, key);
  albedo *= 1.0 + WV[id] * ((surfaceNoise(vec2(p.x / 7.0 + p.y / 5.0, p.z / 7.0 - p.y / 4.0)) - 0.5) * 0.7 + (column - 0.5) * 0.3);
  float fade = 1.0 - smoothstep(${fl(WEATHER_NEAR)}, ${fl(WEATHER_GONE)}, length(rel));
  if (!wall || fade <= 0.0) return;
  float ax = side < 2 ? dpx.z : dpx.x, ay = side < 2 ? dpy.z : dpy.x;
  float u = along / ${fl(WEATHER_BAY)} - float(bay), down = 1.0 - (over / ${fl(WEATHER_STOREY)} - float(storey));
  vec2 gx = vec2(ax, -ox * ${fl(1 - 2 * WEATHER_PAD)}) / ${fl(WEATHER_BAY)}, gy = vec2(ay, -oy * ${fl(1 - 2 * WEATHER_PAD)}) / ${fl(WEATHER_BAY)}, lr, lr2;
  vec4 bm = stamped(bay, storey, key, u, down, gx, gy, lr);
  if (both) {
    vec4 b2 = stamped(bay, storey, keys.y, u, down, gx, gy, lr2);
    bm = mix(bm, b2, share);
    lr = mix(lr, lr2, share);
  }
  bm *= uWeatherReady;
  float o = float(side) * 5.3;
  int f0 = ${WEATHER_BAYS} + (side & 1), f1 = ${WEATHER_BAYS} + ((side & 1) ^ ${WEATHER_FIELDS > 1 ? 1 : 0});
  vec4 m0 = textureGrad(uWeather, vec3((along + o) / ${fl(WEATHER_FIELD)}, -over / ${fl(WEATHER_FIELD)}, float(f0)), vec2(ax, -ox) / ${fl(WEATHER_FIELD)}, vec2(ay, -oy) / ${fl(WEATHER_FIELD)});
  vec4 m1 = textureGrad(uWeather, vec3((along * ${fl(FIELD_TWO)} + 3.7 + o) / ${fl(WEATHER_FIELD)}, (-over * ${fl(FIELD_TWO)} + 1.3) / ${fl(WEATHER_FIELD)}, float(f1)), vec2(ax, -ox) * ${fl(FIELD_TWO / WEATHER_FIELD)}, vec2(ay, -oy) * ${fl(FIELD_TWO / WEATHER_FIELD)});
  vec4 none = vec4(${FIELD_NONE.map(fl).join(", ")});
  vec4 fm = mix(none, mix(m0, m1, smoothstep(0.3, 0.7, surfaceNoise(vec2(p.x / 9.0 + p.z / 9.0, p.y / 6.0)))), uWeatherReady);
  float damp = fm.r, hold = fm.g, patina = fm.b, salt = fm.a;
  // Buildings are much dirtier than their neighbours where a 31 m noise is high; a bay's leaks are its own.
  float dirty = smoothstep(0.5, 0.75, surfaceNoise(vec2(p.x / 31.0 + 11.3, p.z / 31.0 + 5.7)));
  float wet = (0.55 + 0.9 * surfaceNoise(vec2(p.x / 41.0 + 3.1, p.z / 41.0 + 7.7))) * (1.0 + dirty), leak = (0.3 + 0.7 * lr.x) * wet, worn = 0.65 * wet;
  vec4 x = WX[id], y = WY[id];
  if (x.z > 0.0) {
    float gone = smoothstep(0.62, 0.7, surfaceNoise(vec2(along / 6.0, over / 5.0 + float(side) * 17.0)) + 0.25 * dirty);
    float t = 1.0 - (0.88 * gone + x.z * worn * 0.4 * (1.0 - gone)) * fade, lost = smoothstep(t, t + 0.02, hold), rim = smoothstep(t - 0.04, t, hold) - lost;
    float chalk = 0.3 * x.z * fade * smoothstep(0.2, 0.8, damp), grey = (albedo.r + albedo.g + albedo.b) / 3.0;
    vec3 bare = vec3(0.0);
    if (lost > 0.0) {
      float mc = WF[${CONCRETE}].x * uSurfaceCity[0].w;
      vec3 ph = uWorldPhase[${CONCRETE}];
      bool facesX = side < 2;
      vec2 qc = facesX ? vec2(rel.z / mc + ph.z, -rel.y / mc - ph.y) : vec2(rel.x / mc + ph.x, -rel.y / mc - ph.y);
      vec2 cx = (facesX ? vec2(dpx.z, -dpx.y) : vec2(dpx.x, -dpx.y)) / mc, cy = (facesX ? vec2(dpy.z, -dpy.y) : vec2(dpy.x, -dpy.y)) / mc;
      bare = worldBase(qc, ${CONCRETE}, cx, cy).rgb;
    }
    albedo = (mix(albedo, vec3(grey * 1.1), chalk) * (1.0 - lost) + bare * uSurfaceCity[0].rgb * 0.85 * lost) * (1.0 - 0.3 * rim);
  }
  float runs = bm.r * x.x * leak * (0.7 + 0.3 * open) * fade, wash = (0.12 * x.x * worn + 0.4 * dirty) * fade;
  float below = (over - float(storey) * ${fl(WEATHER_STOREY)}) / ${fl(WEATHER_STOREY)};
  float band = below * below * below * 0.35 * x.x * (0.6 + 0.4 * worn) * (0.7 + 0.3 * open) * fade;
  float edge = (0.35 + 0.65 * surfaceNoise(vec2(along / 9.0, float(side) * 13.0))) * (0.55 + 0.9 * damp) * (1.3 + 0.6 * dirty), foot = (1.0 - smoothstep(edge - 0.06, edge, over)) * x.y * fade;
  float growth = (1.0 - smoothstep(0.1, 0.45 * (0.6 + damp), over)) * foot * clamp(uSurfaceCity[1].z * 2.5 + 0.2, 0.0, 1.0);
  float footprint = max(length(vec2(ax, ox)), length(vec2(ay, oy)));
  float joints = x.w > 0.0 ? formwork(along, over, footprint) * x.w * fade : 0.0;
  float dirt = (1.0 - smoothstep(0.0, ${fl(EDGE_DIRT)}, over - float(storey) * ${fl(WEATHER_STOREY)})) * fade;
  float drips = bm.g * y.x * (0.6 + 0.4 * leak) * fade;
  float rust = bm.b * y.x * lr.y * fade;
  float splash = storey == 0 ? bm.a * y.y * fade * (1.0 - smoothstep(0.8, 1.2, over)) : 0.0;
  // The sun bleaches a wall facing it under an open sky, in a patina's patches; facing away in the shade it greens.
  float sunward = dot(face.xz, vec2(${SUN_FACE.map(fl).join(", ")}));
  float bleach = y.z * smoothstep(0.0, 0.85, sunward) * smoothstep(0.35, 0.9, open) * (0.4 + 0.6 * smoothstep(0.3, 0.8, patina)) * fade;
  float algae = y.w * clamp(uSurfaceCity[1].z * 2.5 + 0.2, 0.0, 1.0) * smoothstep(0.0, 0.8, 0.2 - sunward) * (1.0 - 0.6 * open) * smoothstep(0.45, 0.8, patina + 0.4 * bm.r) * fade;
  float salted = WZ[id] * smoothstep(0.7, 0.92, salt) * min(1.0, 1.0 - smoothstep(edge * 0.7, edge + 0.25, over) + 0.5 * bm.r) * fade;
  float grey = (albedo.r + albedo.g + albedo.b) / 3.0;
  albedo += (vec3(grey * 1.15) + albedo * 0.08 - albedo) * 0.35 * bleach;
  albedo *= (1.0 + (WL[id] - 1.0) * runs) * (1.0 + (WL[id] - 1.0) * drips * 0.8) * (1.0 - 0.5 * foot) * (1.0 - 0.4 * joints) * (1.0 - 0.3 * dirt) * (1.0 - wash) * (1.0 - band) * (1.0 - 0.32 * splash);
  albedo += (albedo * vec3(${RUST.map(fl).join(", ")}) - albedo) * rust * 0.8;
  albedo *= mix(vec3(1.0), vec3(${GROWTH.map(fl).join(", ")}), growth);
  albedo *= 1.0 + (vec3(${ALGAE.map(fl).join(", ")}) - 1.0) * 0.6 * algae;
  albedo += (vec3(${SALT.map(fl).join(", ")}) - albedo) * 0.3 * salted;
  orm.y = min(1.0, orm.y * (1.0 - 0.3 * foot) + 0.08 * splash);
  worldSharp = orm.y < ${fl(WORLD_SHARP)};
}
#endif
#if defined(WORLD_EDGES) || defined(WORLD_EDGE_LINE)
const vec3 WE[${N}] = vec3[${N}](${edgings.map((e) => `vec3(${e.map(fl).join(",")})`).join(",")});
// edgeOf's and edged's twins: face is the static's corners across its face (vFace), edges its outer borders (vEdges),
// painted worldSurface's height there.
void edged(inout vec3 albedo, inout vec3 orm, inout vec3 n, int id, vec2 face, uint edges, float painted, vec3 rel, vec3 dpx, vec3 dpy) {
  vec2 fx = dFdx(face), fy = dFdy(face);
  float height = (painted - WM[id].w) / WM[id].z;
  float det = fx.x * fy.y - fy.x * fx.y;
  // Nothing of an edge shows on a pixel four of the widest arrises wide, nor three of them from the edge.
  float footprint = max(length(dpx), length(dpy));
  if (edges == 0u || abs(det) < 1e-12 || footprint >= ${fl(EDGE_ROUND * 1.4 * 4)}) return;
  vec3 pu = (dpx * fy.y - dpy * fx.y) / det, pv = (dpy * fx.x - dpx * fy.x) / det;
  float w = length(pu), h = length(pv), dist = 1e9, d;
  vec3 o = vec3(0.0);
  d = face.x * w;
  if ((edges & 1u) != 0u && d < dist) { dist = d; o = -pu / w; }
  d = (1.0 - face.x) * w;
  if ((edges & 2u) != 0u && d < dist) { dist = d; o = pu / w; }
  d = face.y * h;
  if ((edges & 4u) != 0u && d < dist) { dist = d; o = -pv / h; }
  d = (1.0 - face.y) * h;
  if ((edges & 8u) != 0u && d < dist) { dist = d; o = pv / h; }
  if (dist > ${fl(EDGE_ROUND * 1.4 * 3)}) return;
  vec3 p = rel + uWorldEye, e = WE[id];
  float arris = ${fl(EDGE_ROUND)} * (0.6 + 0.8 * surfaceNoise(vec2(p.x / 0.37 + p.z / 0.53, p.y / 0.41)));
  albedo *= 1.0 + 0.18 * (1.0 - smoothstep(0.0, arris * 2.5, dist)) * e.x * (1.0 - smoothstep(arris, arris * 4.0, footprint));
#ifdef WORLD_EDGES
  float seen = 1.0 - smoothstep(arris * 0.5, arris * 3.0, footprint);
  n = normalize(n + o * (1.0 - smoothstep(0.0, arris, dist)) * seen);
  float near = 1.0 - smoothstep(0.0, arris * 3.0, dist), top = 0.15 + 0.45 * near;
  float chipped = near > 0.0 ? (1.0 - smoothstep(top - 0.04, top, height)) * e.y * seen : 0.0;
  if (chipped > 0.0) {
    float grey = (albedo.r + albedo.g + albedo.b) / 3.0;
    vec3 bare = e.z == 0.0 ? albedo * 0.8 : e.z == 1.0 ? vec3(0.3, 0.29, 0.27) * uSurfaceCity[0].rgb : e.z == 2.0 ? vec3(0.56, 0.57, 0.58) : e.z == 3.0 ? vec3(grey * 1.3) : albedo * 1.25;
    albedo = mix(albedo, bare, chipped);
    orm.y = mix(orm.y, e.z == 2.0 ? 0.45 : 1.0, chipped);
    if (e.z == 2.0) orm.z = mix(orm.z, 1.0, chipped);
  }
#endif
}
#endif
`;

/**
 * The ground's cover, which follows WORLD_GLSL: its finish by tint, with the desert's (`surfaceIndex`), and the twins of
 * `groundWander`, `groundCover` and `groundMeet`.
 */
export const GROUND_GLSL = `const int GROUND_IDS[256] = int[256](${Array.from({ length: 256 }, (_, i) => surfaceIndex(i, true)).join(",")});
int groundSurface(int tint) {
  return uSurfaceCity[1].w > 0.5 && (${desert.map((c) => `tint == ${c}`).join(" || ")}) ? ${surfaceIndex(desert[0]!, true, "las-vegas")} : GROUND_IDS[tint];
}
vec2 groundBits(float h) { return vec2(floor(h * 4096.0) / 4096.0, fract(h * 4096.0)); }
vec2 groundWander(vec2 p, float footprint) {
  float reach = clamp(2.0 - 4.0 * footprint / ${fl(GROUND_GRAIN)}, 0.0, 1.0) * 2.0 * ${fl(GROUND_WANDER)};
  if (reach == 0.0) return vec2(0.0);
  p /= ${fl(GROUND_GRAIN)};
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return (mix(mix(groundBits(surfaceHash(i)), groundBits(surfaceHash(i + ivec2(1, 0))), f.x), mix(groundBits(surfaceHash(i + ivec2(0, 1))), groundBits(surfaceHash(i + ivec2(1, 1))), f.x), f.y) - 0.5) * reach;
}
int groundCover(ivec4 t, vec2 f) {
  if (all(equal(t, t.xxxx))) return t.x;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  float a = dot(w, vec4(equal(t, t.xxxx))), b = dot(w, vec4(equal(t, t.yyyy))), c = dot(w, vec4(equal(t, t.zzzz))), d = dot(w, vec4(equal(t, t.wwww)));
  int best = t.x;
  float most = a;
  if (b > most) { best = t.y; most = b; }
  if (c > most) { best = t.z; most = c; }
  if (d > most) best = t.w;
  return best;
}
// The tint of the other finish with most weight where cover meets it, or -1, and how much of it is wanted.
int groundMeet(int cover, ivec4 t, vec2 f, out float share) {
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  ivec4 s = ivec4(groundSurface(t.x), groundSurface(t.y), groundSurface(t.z), groundSurface(t.w));
  int own = groundSurface(cover);
  float mine = dot(w, vec4(equal(s, ivec4(own))));
  vec4 sums = vec4(dot(w, vec4(equal(s, s.xxxx))), dot(w, vec4(equal(s, s.yyyy))), dot(w, vec4(equal(s, s.zzzz))), dot(w, vec4(equal(s, s.wwww))));
  sums *= vec4(notEqual(s, ivec4(own)));
  int other = -1;
  float most = 0.0;
  if (sums.x > most) { other = t.x; most = sums.x; }
  if (sums.y > most) { other = t.y; most = sums.y; }
  if (sums.z > most) { other = t.z; most = sums.z; }
  if (sums.w > most) { other = t.w; most = sums.w; }
  share = other < 0 ? 0.0 : clamp((most / (mine + most) - 0.5) * ${fl(GROUND_MEET)} + 0.5, 0.0, 1.0);
  return other;
}
const int GROUND_WALK = ${GROUND_WALK};
bool groundWalks(ivec4 t) {
  return groundSurface(t.x) == GROUND_WALK || groundSurface(t.y) == GROUND_WALK || groundSurface(t.z) == GROUND_WALK || groundSurface(t.w) == GROUND_WALK;
}
float walkMeet(float share, float footprint) {
  return clamp((share - 0.5) / max(footprint * ${fl(GROUND_MEET / TERRAIN_CELL)}, 0.001) + 0.5, 0.0, 1.0);
}
`;

/** The finishes a street's band may draw over: what the ground of a street, a verge or a walk is made of. Any other among a cell's four is left as it is drawn. */
const STREET_SOFT = ["asphalt", "sidewalk", "grass", "dirt", "gravel", "paving", "sand"].map((n) => SURFACE_NAMES.indexOf(n as (typeof SURFACE_NAMES)[number]));
/** The tint a verge takes where none of a cell's four samples is of its finish and its kind names none: rough grass. */
const BEYOND_TINT = 150;
/** The verges that are rough (streets.ts VERGES: grass, dirt, gravel), whose far edge is ragged. */
const STREET_ROUGH = [2, 3, 5];
/**
 * How ragged a street's edges are: metres between the noise's points along them, and the most each edge moves, end to
 * end: a flush kerb's asphalt, a worn kerb's, and a rough verge's far edge.
 */
export const STREET_MESSY = { grain: 1.3, flush: 0.36, worn: 0.12, verge: 0.9 } as const;

/**
 * A walk's way along from its kinds' byte (streets.ts alongByte, the diamond angle of half a turn), into `out` as x and z.
 */
export function alongOf(b: number, out: Float64Array): void {
  const p = (b & 127) / 64, x = p < 1 ? 1 - p : -(p - 1), z = p < 1 ? p : 2 - p, l = Math.sqrt(x * x + z * z);
  out[0] = x / l;
  out[1] = z / l;
}

/**
 * The ground's cover from the streets where they are near (STREETS_GLSL `streetCover`'s twin): of a cell's four tints
 * a, b, c, d at (fx, fz), with `e` the distances to the kerb, the verge's end and the walk's end (StreetPlanes) and
 * `kinds` the side's kinds byte, the band the point is in (0 carriageway, 1 verge, 2 walk, 3 past them) and its tint, the
 * band across its nearer edge and that one's tint, and how much of it is wanted, half on the edge and none half a pixel
 * `footprint` metres wide from it: so each edge is a straight line. A band's tint is the one of its finish among the four
 * with most weight, else the band's own (STREET_TINT, a verge's VERGE_TINTS, WALK_TINT); past the bands, the four's cover
 * with no street's or walk's tint in it, or as it is where all four are paved. False, and nothing set, where one of the four is of a finish no band draws over
 * (a footprint's, the water's). Into `out`: band, tint, other band, other tint, share.
 */
export function streetCover(a: number, b: number, c: number, d: number, fx: number, fz: number, e: ArrayLike<number>, kinds: number, footprint: number, finish: (tint: number) => number, out: Float64Array, x = 0, z = 0): boolean {
  const tints = [a, b, c, d], f = tints.map(finish);
  if (f.some((s) => !STREET_SOFT.includes(s))) return false;
  const w = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
  const verge = e[1]! < e[0]! - 0.01, walk = e[2]! < e[1]! - 0.01;
  // A flush or worn kerb's asphalt crumbles at its edge, and a rough verge (grass, dirt, gravel) meets what is past it
  // raggedly: each edge moved by a smooth noise along it (STREET_MESSY), the walk's never.
  const kerb = (kinds >> 5) & 3, rough = STREET_ROUGH.includes(kinds & 7);
  const e0 = e[0]! + (kerb === 0 ? 0 : (surfaceNoise(x / STREET_MESSY.grain, z / STREET_MESSY.grain) - 0.5) * (kerb === 1 ? STREET_MESSY.flush : STREET_MESSY.worn));
  const e1 = e[1]! + (rough ? (surfaceNoise(x / STREET_MESSY.grain + 7.1, z / STREET_MESSY.grain + 3.3) - 0.5) * STREET_MESSY.verge : 0);
  const e2 = walk ? e[2]! : e1;
  const band = e0 < 0 ? 0 : e1 < 0 ? 1 : e2 < 0 ? 2 : 3;
  const below = band === 0 ? 1e3 : band === 1 ? e0 : band === 2 ? e1 : e2, above = band === 0 ? -e0 : band === 1 ? -e1 : band === 2 ? -e2 : 1e3;
  let lower = band - 1, upper = band + 1;
  if (lower === 2 && !walk) lower = 1;
  if (lower === 1 && !verge) lower = 0;
  if (upper === 1 && !verge) upper = 2;
  if (upper === 2 && !walk) upper = 3;
  const kind = kinds & 7;
  const most = (want: number): number => {
    let best = -1, top = 0;
    for (let k = 0; k < 4; k++) if (f[k] === want && w[k]! > top) { top = w[k]!; best = tints[k]!; }
    return best;
  };
  const tintOf = (bd: number): number => {
    if (bd === 0) { const t = most(SURFACE_NAMES.indexOf("asphalt")); return t >= 0 ? t : STREET_TINT; }
    if (bd === 1) { const own = VERGE_TINTS[kind]?.[0] ?? BEYOND_TINT, t = most(finish(own)); return t >= 0 ? t : own; }
    if (bd === 2) { const t = most(GROUND_WALK); return t >= 0 ? t : WALK_TINT; }
    // Past the bands: the four's cover with each street's and walk's tint taken as the other tint with most weight, so
    // the samples' stepped street stops at the line. Where all four are paved, that is a car park's, a plaza's or more
    // road's ground, drawn as it is.
    let other = -1, top = 0;
    for (let k = 0; k < 4; k++) {
      if (f[k] === GROUND_WALK || f[k] === SURFACE_NAMES.indexOf("asphalt")) continue;
      let sum = 0;
      for (let j = 0; j < 4; j++) if (tints[j] === tints[k]) sum += w[j]!;
      if (sum > top) { top = sum; other = tints[k]!; }
    }
    if (other < 0) return groundCover(a, b, c, d, fx, fz);
    const kept = tints.map((t, k) => (f[k] === GROUND_WALK || f[k] === SURFACE_NAMES.indexOf("asphalt") ? other : t));
    return groundCover(kept[0]!, kept[1]!, kept[2]!, kept[3]!, fx, fz);
  };
  const dist = Math.min(below, above), across = below < above ? lower : upper;
  out[0] = band;
  out[1] = tintOf(band);
  out[2] = across;
  out[3] = across >= 0 && across <= 3 ? tintOf(across) : -1;
  out[4] = out[3] >= 0 ? clamp(0.5 - dist / Math.max(footprint, 1e-3), 0, 0.5) : 0;
  return true;
}

/**
 * The streets' edges on the ground, which follows GROUND_GLSL: `streetsAt` reads the streets' pictures round the camera
 * (streets.ts) and `streetCover` is the twin of streetCover. For the wear (ROAD_GLSL): `streetKerb`, metres in from a
 * raised or worn kerb (0 past it), -2 where the edge is flush, or -1 where the streets say nothing; and `walkPlace`,
 * where a walk's panels are laid out, along its way and across from its inner edge, where `walkAlong`.
 */
export const STREETS_GLSL = `float streetKerb = -1.0;
vec2 walkPlace = vec2(0.0);
bool walkAlong = false;
#ifdef GROUND_STREETS
uniform highp sampler2D uStreets;
uniform highp usampler2D uStreetKinds;
const int STREET_SOFT[${STREET_SOFT.length}] = int[${STREET_SOFT.length}](${STREET_SOFT.join(",")});
const int VERGE_TINT[8] = int[8](${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => VERGE_TINTS[k]?.[0] ?? BEYOND_TINT).join(",")});
// The streets at world point w: the distances to the kerb, the verge's end and the walk's end between the four samples
// round it into e, the nearest sample's kinds into k; false where none is near, past the region round the camera, or
// where the region's place holds another chunk (its tag).
bool streetsAt(vec2 w, out vec3 e, out uvec4 k) {
  vec2 s = w / ${fl(TERRAIN_CELL)};
  ivec2 c = ivec2(floor(s / ${fl(CHUNK_SIDE)})) - ivec2(floor(uWorldEye.xz / ${fl(CHUNK_SIDE * TERRAIN_CELL)}));
  e = vec3(${fl(PLANE_MOST)});
  k = uvec4(0u);
  // Past the region round the camera, or with the frame drawn without them (passes.ts "streets", fFacade.w's third bit).
  if (max(abs(c.x), abs(c.y)) > ${STREET_CHUNKS / 2 - 1} || mod(fFacade.w, 8.0) > 3.5) return false;
  e = (128.0 - texture(uStreets, (s + 0.5) / ${fl(STREET_SIDE)}).rgb * 255.0) / ${fl(PLANE_STEP)};
  if (min(e.x, min(e.y, e.z)) >= ${fl(PLANE_MOST - 0.1)}) return false;
  ivec2 n = ivec2(floor(s + 0.5)), nc = n >> ${Math.log2(CHUNK_SIDE)};
  k = texelFetch(uStreetKinds, n & ${STREET_SIDE - 1}, 0);
  return int(k.y & 15u) == (((nc.x >> 4) & 3) | (((nc.y >> 4) & 3) << 2));
}
bool streetSoft(int s) {
  for (int i = 0; i < ${STREET_SOFT.length}; i++) if (STREET_SOFT[i] == s) return true;
  return false;
}
// Of the four tints, the one of finish want with most weight w, or -1.
int streetMost(ivec4 t, ivec4 f, vec4 w, int want) {
  vec4 m = w * vec4(equal(f, ivec4(want)));
  int best = -1;
  float top = 0.0;
  if (m.x > top) { best = t.x; top = m.x; }
  if (m.y > top) { best = t.y; top = m.y; }
  if (m.z > top) { best = t.z; top = m.z; }
  if (m.w > top) best = t.w;
  return best;
}
int streetTint(int band, ivec4 t, ivec4 f, vec4 w, vec2 at, int kind) {
  if (band == 0) { int s = streetMost(t, f, w, ${SURFACE_NAMES.indexOf("asphalt")}); return s >= 0 ? s : ${STREET_TINT}; }
  if (band == 1) { int own = VERGE_TINT[kind], s = streetMost(t, f, w, groundSurface(own)); return s >= 0 ? s : own; }
  if (band == 2) { int s = streetMost(t, f, w, GROUND_WALK); return s >= 0 ? s : ${WALK_TINT}; }
  bvec4 paved = bvec4(f.x == GROUND_WALK || f.x == ${SURFACE_NAMES.indexOf("asphalt")}, f.y == GROUND_WALK || f.y == ${SURFACE_NAMES.indexOf("asphalt")}, f.z == GROUND_WALK || f.z == ${SURFACE_NAMES.indexOf("asphalt")}, f.w == GROUND_WALK || f.w == ${SURFACE_NAMES.indexOf("asphalt")});
  vec4 keep = vec4(not(paved));
  vec4 sums = vec4(dot(w * keep, vec4(equal(t, t.xxxx))), dot(w * keep, vec4(equal(t, t.yyyy))), dot(w * keep, vec4(equal(t, t.zzzz))), dot(w * keep, vec4(equal(t, t.wwww)))) * keep;
  int other = -1;
  float top = 0.0;
  if (sums.x > top) { other = t.x; top = sums.x; }
  if (sums.y > top) { other = t.y; top = sums.y; }
  if (sums.z > top) { other = t.z; top = sums.z; }
  if (sums.w > top) other = t.w;
  if (other < 0) return groundCover(t, at);
  ivec4 kept = ivec4(paved.x ? other : t.x, paved.y ? other : t.y, paved.z ? other : t.z, paved.w ? other : t.w);
  return groundCover(kept, at);
}
// streetCover's twin: the band's tint into tint, the band across its nearer edge into other and how much of it into
// share; streetKerb and walkPlace set. False where one of the four is of a finish no band draws over.
bool streetCover(ivec4 t, vec2 at, vec3 e, uvec4 k, vec2 w, float footprint, out int tint, out int other, out float share) {
  ivec4 f = ivec4(groundSurface(t.x), groundSurface(t.y), groundSurface(t.z), groundSurface(t.w));
  // A walk's panels along its way (the kinds' third byte, the diamond angle of half a turn) and across from its inner
  // edge, near a street whether or not its bands are drawn here: a walk the data draws beside one lies along it too.
  float p = float(k.z & 127u) / 64.0;
  vec2 along = normalize(p < 1.0 ? vec2(1.0 - p, p) : vec2(1.0 - p, 2.0 - p));
  walkPlace = vec2(dot(w, along), e.y);
  walkAlong = true;
  if (!(streetSoft(f.x) && streetSoft(f.y) && streetSoft(f.z) && streetSoft(f.w))) return false;
  vec4 wt = vec4((1.0 - at.x) * (1.0 - at.y), at.x * (1.0 - at.y), (1.0 - at.x) * at.y, at.x * at.y);
  bool verge = e.y < e.x - 0.01, walk = e.z < e.y - 0.01;
  int kind = int(k.x & 7u);
  uint kerb = (k.x >> 5u) & 3u;
  // Ragged edges: a flush or worn kerb's asphalt, a rough verge's far edge (STREET_MESSY).
  if (kerb != 0u) e.x += (surfaceNoise(w / ${fl(STREET_MESSY.grain)}) - 0.5) * (kerb == 1u ? ${fl(STREET_MESSY.flush)} : ${fl(STREET_MESSY.worn)});
  if (${STREET_ROUGH.map((r) => `kind == ${r}`).join(" || ")}) e.y += (surfaceNoise(w / ${fl(STREET_MESSY.grain)} + vec2(7.1, 3.3)) - 0.5) * ${fl(STREET_MESSY.verge)};
  if (!walk) e.z = e.y;
  int band = e.x < 0.0 ? 0 : e.y < 0.0 ? 1 : e.z < 0.0 ? 2 : 3;
  float below = band == 0 ? 1e3 : band == 1 ? e.x : band == 2 ? e.y : e.z, above = band == 0 ? -e.x : band == 1 ? -e.y : band == 2 ? -e.z : 1e3;
  int lower = band - 1, upper = band + 1;
  if (lower == 2 && !walk) lower = 1;
  if (lower == 1 && !verge) lower = 0;
  if (upper == 1 && !verge) upper = 2;
  if (upper == 2 && !walk) upper = 3;
  int across = below < above ? lower : upper;
  tint = streetTint(band, t, f, wt, at, kind);
  other = across >= 0 && across <= 3 ? streetTint(across, t, f, wt, at, kind) : -1;
  share = other >= 0 ? clamp(0.5 - min(below, above) / max(footprint, 0.001), 0.0, 0.5) : 0.0;
  streetKerb = ((k.x >> 5u) & 3u) != 1u ? max(-e.x, 0.0) : -2.0;
  // A paved verge's panels in rows from the kerb.
  if (kind == ${PAVED_VERGE} && (band == 1 || across == 1)) walkPlace.y = e.x;
  return true;
}
#endif
`;

/**
 * The ground's wear on asphalt, sand and walks, where the tier reads the finishes in full (WORLD_ROAD): the twins of
 * `roadWorn` and `walkWorn`. The frame block's fFacade.w has 1 in it when the frame is drawn without the first (passes.ts
 * "road"), 2 without the second ("walks") and 4 without the streets' edges ("streets").
 */
export const ROAD_GLSL = `#ifdef WORLD_ROAD
const vec3 TAR = vec3(${TAR.map(fl).join(",")});
// Wear onto a finish id's albedo and orm at world point p, and p's change a pixel across and down.
float roadBand(float g, float centre, float wide, float blur) {
  float w = max(wide, blur);
  return (1.0 - smoothstep(w * 0.5, w, abs(g - centre))) * (wide / w);
}
#ifdef GROUND_ROAD
uniform highp usampler2D uRoad;
// The road's frame at window sample point at (roadFrameAt's twin): along and across into frame, their rise a metre along
// x and z into rise, the carriageway's half width, lanes, one way and wear into road; and how sure.
float roadFrame(vec2 at, out vec2 frame, out vec4 rise, out vec4 road) {
  vec2 q = at / ${fl(ROAD_STEP)};
  ivec2 i = clamp(ivec2(floor(q)), ivec2(0), textureSize(uRoad, 0) - 2);
  vec2 f = clamp(q - vec2(i), 0.0, 1.0);
  uvec4 a = texelFetch(uRoad, i, 0), b = texelFetch(uRoad, i + ivec2(1, 0), 0), c = texelFetch(uRoad, i + ivec2(0, 1), 0), d = texelFetch(uRoad, i + ivec2(1, 1), 0);
  frame = vec2(0.0);
  rise = vec4(0.0);
  road = vec4(0.0);
  if (a.x == 0u || b.x == 0u || c.x == 0u || d.x == 0u || any(notEqual(uvec4(b.zw, c.zw), a.zwzw)) || any(notEqual(d.zw, a.zw))) return 0.0;
  vec4 across = (vec4(a.x, b.x, c.x, d.x) - 128.0) / ${fl(ROAD_ACROSS)};
  vec4 along = vec4(a.y, b.y, c.y, d.y) / ${fl(ROAD_ALONG)};
  along.yzw = along.x + mod(along.yzw - along.x + ${fl(ROAD_WRAP / 2)}, ${fl(ROAD_WRAP)}) - ${fl(ROAD_WRAP / 2)};
  float bent = abs(across.x + across.w - across.y - across.z) + abs(along.x + along.w - along.y - along.z);
  rise = vec4((along.y - along.x) * (1.0 - f.y) + (along.w - along.z) * f.y, (along.z - along.x) * (1.0 - f.x) + (along.w - along.y) * f.x,
    (across.y - across.x) * (1.0 - f.y) + (across.w - across.z) * f.y, (across.z - across.x) * (1.0 - f.x) + (across.w - across.y) * f.x) / ${fl(ROAD_CELL)};
  frame = vec2(mix(mix(along.x, along.y, f.x), mix(along.z, along.w, f.x), f.y), mix(mix(across.x, across.y, f.x), mix(across.z, across.w, f.x), f.y));
  road = vec4(float(a.z) / ${fl(ROAD_HALF)}, float(a.w & 7u), (a.w & ${ROAD_ONE_WAY}u) != 0u ? 1.0 : 0.0, float(a.w >> ${ROAD_WEAR_SHIFT}u) / 6.0);
  return clamp(2.0 - 2.0 * bent, 0.0, 1.0) * clamp(1.0 - abs(length(rise.zw) - 1.0) * 4.0, 0.0, 1.0);
}
#endif
void roadWear(inout vec3 albedo, inout vec3 orm, int id, vec3 p, vec2 at, vec3 dpx, vec3 dpy) {
  if (mod(fFacade.w, 2.0) > 0.5 || (id != ${SAND} && id != ${ASPHALT})) return;
  if (id == ${SAND}) {
    vec2 tx = vec2(dpx.x - dpx.z, dpx.x + dpx.z) * ${fl(BEACH_TURN / BEACH_SECOND)}, ty = vec2(dpy.x - dpy.z, dpy.x + dpy.z) * ${fl(BEACH_TURN / BEACH_SECOND)};
    float first = worldOrm(p.xz / ${fl(ROAD_MACRO)}, ${ROAD_LAYER}, dpx.xz / ${fl(ROAD_MACRO)}, dpy.xz / ${fl(ROAD_MACRO)}).g;
    float second = worldOrm(vec2(p.x - p.z, p.x + p.z) * ${fl(BEACH_TURN / BEACH_SECOND)} + vec2(0.37, 0.71), ${ROAD_LAYER}, tx, ty).g;
    albedo *= (1.0 + (first - 0.5) * ${fl(ROAD_LOOK.beach)}) * (1.0 + (second - 0.5) * ${fl(ROAD_LOOK.beach * 0.5)});
    return;
  }
  vec2 frame = vec2(0.0);
  vec4 rise = vec4(0.0), road = vec4(0.0);
  float sure = 0.0, footprint = max(length(dpx.xz), length(dpy.xz));
#ifdef GROUND_ROAD
  sure = roadFrame(at, frame, rise, road);
#endif
  // Along a sure frame, w is across the carriageway and along it, with its steps a pixel across and down; elsewhere x and z.
  bool along = sure > 0.5;
  vec2 w = along ? frame.yx : p.xz;
  vec2 gx = along ? vec2(dot(rise.zw, dpx.xz), dot(rise.xy, dpx.xz)) : dpx.xz, gy = along ? vec2(dot(rise.zw, dpy.xz), dot(rise.xy, dpy.xz)) : dpy.xz;
  vec4 m = worldOrm(w / ${fl(ROAD_MACRO)}, ${ROAD_LAYER}, gx / ${fl(ROAD_MACRO)}, gy / ${fl(ROAD_MACRO)});
  float shade = 1.0 + (m.r - 0.5) * ${fl(ROAD_LOOK.macro)};
  float rough = orm.y * (1.0 + (m.b - 0.5) * ${fl(0.25 * ROAD_LOOK.macroRough)});
  float wide = ${fl(ROAD_REPAIRS)}, from0 = 0.0, joint = 0.0;
  if (along) {
    float s = smoothstep(0.5, 1.0, sure), lane = 2.0 * road.x / road.y, worn = (0.4 + 0.6 * road.w) * s * smoothstep(0.0, 0.3, road.x - abs(w.x));
    float t = (w.x + road.x) / lane, k = floor(t), g = t - k, blur = footprint / lane;
    float wheels = roadBand(g, 0.27, 0.075, blur) + roadBand(g, 0.73, 0.075, blur);
    float oil = roadBand(g, 0.5, 0.07, blur) * (0.4 + 1.2 * surfaceNoise(vec2(w.y / 5.3, k * 3.1)));
    // The gutter along the kerb, from the frame's line where the streets do not draw it (below); none at a flush edge.
    float gutter = streetKerb > -1.5 && streetKerb < 0.0 ? roadBand(abs(w.x), road.x - 0.25, 0.25, footprint) * s : 0.0;
    shade *= (1.0 - wheels * ${fl(ROAD_LOOK.wheels)} * worn) * (1.0 - oil * ${fl(ROAD_LOOK.oil)} * worn) * (1.0 - gutter * ${fl(ROAD_LOOK.gutter)});
    rough += gutter * 0.1 - (wheels * 0.06 + oil * 0.1) * worn;
    float kb = floor(t + 0.5), cell = floor(w.y / ${fl(ROAD_REPAIRS)}), mid = (cell + 0.5) * ${fl(ROAD_REPAIRS)};
    vec2 j = p.xz + rise.xy * (mid - w.y) + rise.zw * ((kb - t) * lane);
    if (kb >= 1.0 && kb < road.y && surfaceHash(ivec2(floor(j / ${fl(ROAD_REPAIRS)})) * ivec2(7, 13) + ivec2(int(kb), 977)) < ${fl(ROAD_LOOK.joint)})
      joint = roadBand((t - kb) * lane + (surfaceNoise(vec2(w.y / 3.1, kb * 5.5)) - 0.5) * 0.08, 0.0, 0.035, footprint) * s;
    wide = lane;
    from0 = -road.x;
  }
  // Where the streets draw the asphalt's edge (STREETS_GLSL), the gutter runs along the kerb's own line, so the two agree.
  if (streetKerb >= 0.0) {
    float gutter = roadBand(streetKerb, 0.25, 0.25, footprint);
    shade *= 1.0 - gutter * ${fl(ROAD_LOOK.gutter)};
    rough += gutter * 0.1;
  }
  // The repairs of this lane's or this square's 8 m: where in their tile, and whether patched and sealed, by where its middle is.
  vec2 size = vec2(wide, ${fl(ROAD_REPAIRS)}), k = floor((w - vec2(from0, 0.0)) / size), mid = vec2(from0, 0.0) + (k + 0.5) * size;
  float h = along ? surfaceHash(ivec2(floor((p.xz + rise.xy * (mid.y - w.y) + rise.zw * (mid.x - w.x)) / ${fl(ROAD_REPAIRS)})) * ivec2(7, 13) + ivec2(k)) : surfaceHash(ivec2(k) * ivec2(8, 14));
  vec2 inside = min(w - vec2(from0, 0.0) - k * size, vec2(from0, 0.0) + (k + 1.0) * size - w);
  float edge = smoothstep(0.0, 0.4, min(inside.x, inside.y));
  vec4 r = worldOrm(w / ${fl(ROAD_REPAIRS)} + vec2(fract(h * 7.13), fract(h * 3.71)), ${REPAIRS_LAYER}, gx / ${fl(ROAD_REPAIRS)}, gy / ${fl(ROAD_REPAIRS)});
  float patched = h < ${fl(ROAD_LOOK.patched)} ? edge : 0.0, sealed = fract(h * 13.7) < ${fl(ROAD_LOOK.sealed)} ? edge : 0.0, from = 0.35 + 0.4 * fract(h * 5.3);
  float fill = r.r * patched, sealant = max(r.g * patched, smoothstep(from, from + 0.15, r.b) * sealed) * 0.9, tar = max(joint * 0.6, sealant);
  albedo = mix(albedo * shade * (1.0 - 0.2 * fill) * (1.0 - 0.3 * r.a * edge), TAR, tar);
  orm.y = clamp(mix(rough - 0.08 * fill, ${fl(TAR_ROUGH)}, sealant), 0.12, 1.0);
}
const vec3 DIRT = vec3(${DIRT.map(fl).join(",")}), GRASS = vec3(${GRASS.map(fl).join(",")});
float covered(float d, float width, float footprint) {
  float f = max(footprint, 0.0001);
  return clamp((width - d) / f + 0.5, 0.0, 1.0) * clamp(2.0 * width / f, 0.0, 1.0);
}
// A walk's wear (walkWorn's twin); fFacade.w's second bit is set when the frame is drawn without it (passes.ts "walks").
void walkWear(inout vec3 albedo, inout vec3 orm, inout vec3 n, int id, vec3 p, vec3 dpx, vec3 dpy) {
  if (mod(fFacade.w, 4.0) > 1.5 || id != GROUND_WALK) return;
  float panel = WF[id].x * uSurfaceCity[0].w * 0.5, footprint = max(length(dpx.xz), length(dpy.xz));
  // Along a street's walk its panels run along it, a row from its inner edge (STREETS_GLSL walkPlace); elsewhere square to the world.
  vec2 g = (walkAlong ? walkPlace : p.xz) / panel, k = floor(g), f = g - k;
  ivec2 ik = ivec2(k);
  float h = surfaceHash(ik * ivec2(5, 9) + ivec2(3, 1));
  vec2 dd = min(f, 1.0 - f) * panel;
  float d = min(dd.x, dd.y);
  float hj = dd.x < dd.y ? surfaceHash(ivec2((ik.x + (f.x > 0.5 ? 1 : 0)) * 7, ik.y * 13 + 5)) : surfaceHash(ivec2(ik.x * 7 + 3, (ik.y + (f.y > 0.5 ? 1 : 0)) * 13));
  float inner = clamp((d - 0.02) / 0.05, 0.0, 1.0);
  float shade = 1.0 + (fract(h * 3.1) - 0.5) * ${fl(WALK_LOOK.tone)}, rough = orm.y;
  if (fract(h * 7.7) < ${fl(WALK_LOOK.stained)}) {
    float m = worldOrm(p.xz / 3.0 + vec2(fract(h * 5.3), fract(h * 9.1)), ${ROAD_LAYER}, dpx.xz / 3.0, dpy.xz / 3.0).r;
    float stain = smoothstep(0.45, 0.75, m) * inner;
    shade *= 1.0 - 0.22 * stain;
    rough += 0.05 * stain;
  }
  if (fract(h * 11.3) < ${fl(WALK_LOOK.cracked)}) {
    float m = worldOrm(p.xz / ${fl(ROAD_REPAIRS)} + vec2(fract(h * 2.9), fract(h * 6.7)), ${REPAIRS_LAYER}, dpx.xz / ${fl(ROAD_REPAIRS)}, dpy.xz / ${fl(ROAD_REPAIRS)}).b;
    float from = 0.2 + 0.2 * fract(h * 4.1), crack = smoothstep(from, from + 0.12, m) * inner;
    shade *= 1.0 - 0.5 * crack;
    rough += 0.1 * crack;
  }
  if (fract(h * 13.9) < ${fl(WALK_LOOK.sunk)}) {
    float a = fract(h * 17.3) * ${fl(2 * Math.PI)};
    n = normalize(n + vec3(cos(a), 0.0, sin(a)) * ${fl(WALK_LOOK.lean)});
    shade *= 1.0 - covered(d, 0.008, footprint) * 0.5;
  }
  albedo *= shade;
  float along = dd.x < dd.y ? g.y : g.x, patchy = surfaceNoise(vec2(along * 6.0 + hj * 50.0, hj * 31.0));
  if (fract(hj * 3.7) < ${fl(WALK_LOOK.grass)}) {
    float tufts = 0.35 + 0.65 * surfaceNoise(vec2(along * 40.0 + hj * 17.0, hj * 13.0));
    float c = covered(d, ${fl(JOINT_GRASS)} * smoothstep(0.35, 0.8, patchy) * tufts, footprint) * 0.9;
    albedo = mix(albedo, GRASS, c);
    rough = mix(rough, 0.9, c);
  } else if (fract(hj * 5.9) < ${fl(WALK_LOOK.dirt)}) {
    float c = covered(d, ${fl(JOINT_DIRT)} * (0.5 + patchy), footprint) * 0.75;
    albedo = mix(albedo, DIRT, c);
    rough = mix(rough, 0.95, c);
  }
  orm.y = clamp(rough, 0.12, 1.0);
}
// The ground's wear reads the packed array's masks, so it comes up with them as the weathering does (uWorldReady 1 to 2).
void groundWorn(inout vec3 albedo, inout vec3 orm, inout vec3 n, int id, vec3 p, vec2 at, vec3 dpx, vec3 dpy) {
  float risen = 2.0 - uWorldReady;
  if (risen <= 0.0) return;
  vec3 a0 = albedo, o0 = orm, n0 = n;
  roadWear(albedo, orm, id, p, at, dpx, dpy);
  walkWear(albedo, orm, n, id, p, dpx, dpy);
  if (risen < 1.0) {
    albedo = mix(a0, albedo, risen);
    orm = mix(o0, orm, risen);
    n = normalize(mix(n0, n, risen));
  }
}
#endif
`;
