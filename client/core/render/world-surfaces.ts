// Metre-space materials for terrain and meshes without authored surfaces. CPU and GLSL deliberately use the same
// projection, integer hash, noises, blends and weather fields. There is no animation clock here.
import { SURFACE_CITIES, SURFACE_FINISHES, SURFACE_GROUPS, SURFACE_NAMES, surfaceIndex, surfaceMaterial } from "../../../content/surfaces.ts";
import type { PackMaterial, PackTexture } from "../../../shared/pack/pack.ts";
import { STEP0_SIZE, topIn, type TextureFormat } from "../../../shared/pack/texture.ts";
import type { Tier } from "../assets/tiers.ts";
import type { FramePacket } from "./packet.ts";

type Out = Float64Array;
type Numbers = ArrayLike<number>;
/** A finish this smooth or smoother, its wetness's share taken off, mirrors the sky table; a rougher one mirrors the sky's light in that direction. */
export const WORLD_SHARP = 0.6;
/** Each finish's painted roughness, its packed map's one-pixel mip, of 255: what the touch rule's light finish, which reads no packed map, is lit with. */
export const WORLD_ROUGH = [225, 246, 245, 184, 237, 238, 225, 220, 225, 233, 218, 217, 161, 205, 221, 54] as const;
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
const finishes = SURFACE_NAMES.map((name, i) => {
  const f = SURFACE_FINISHES[name], g = SURFACE_GROUPS[f.group];
  return { ...f, metres: f.metres * g.scale, bump: f.bump * g.bump, weather: f.weather * g.weather, tint: g.tint, wetness: g.wetness, growth: g.growth, module: f.module ?? [0, 0], mean: WORLD_ROUGH[i]! / 255 };
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
  material(m: number, pixels: number, distance: number): void;
  holds(t: number): number;
  again(t: number): void;
}

/**
 * The world finishes' materials, a frame at a time: each is asked for as wide as the tier keeps them, and the card is
 * told the side of the array it keeps each role in, a layer a finish, and the finest level every layer has come to.
 * When the side changes the card makes its arrays again, so their textures are taken again from their first step.
 */
export class WorldFinishes {
  private readonly materials: number[];
  /** Each role's textures, a finish each, by their index in the manifest, the role's top, and its top against the base colour's. */
  private readonly textures: number[][];
  private readonly tops: number[];
  private readonly share: number[];
  private side = 0;

  constructor(materials: readonly PackMaterial[], textures: readonly PackTexture[]) {
    const found = SURFACE_NAMES.map((name) => materials.findIndex((m) => m.id === surfaceMaterial(name)));
    this.materials = found.every((m) => m >= 0) ? found : [];
    const roles = ["base", "normal", "mro"] as const;
    this.textures = roles.map((role) => this.materials.map((m) => materials[m]![role]));
    this.tops = this.textures.map((ts) => (ts.length ? textures[ts[0]!]!.top : 0));
    this.share = this.tops.map((top) => top / (this.tops[0] || 1));
  }

  get present(): boolean {
    return this.materials.length > 0;
  }

  frame(p: FramePacket, residency: FinishResidency, tier: Tier): void {
    const side = this.present && tier.lit ? tier.finishes : 0;
    if (side !== this.side) for (const ts of this.textures) for (const t of ts) residency.again(t);
    this.side = side;
    for (const m of this.materials) if (side > 0) residency.material(m, side, 1);
    for (let r = 0; r < 3; r++) {
      const along = Math.min(side * this.share[r]!, topIn(residency.format, this.tops[r]!));
      let level = side > 0 ? 0 : -1;
      for (const t of this.textures[r]!) {
        const held = residency.holds(t);
        level = held < 0 || level < 0 ? -1 : Math.max(level, Math.log2(along / Math.min(along, STEP0_SIZE << held)));
      }
      p.worldSide[r] = along;
      p.worldLevel[r] = level;
    }
    worldPhase(p.worldPhase, p.camX, p.camY, p.camZ, p.surfaceCity);
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
 * height. Into `maps`.
 */
function finishMaps(id: number, u: number, v: number, spread: number, sample: WorldSample, light: boolean, view: Numbers, depth: number): void {
  const f = finishes[id]!, turned = f.module[0] === 0;
  const second = secondShare(u, v), t = light ? 0 : second;
  if (depth > 0) {
    relief(id, u, v, spread, view, depth, t >= 0.5, sample);
    u = met[0]!;
    v = met[1]!;
  }
  const bu = turned ? -v + SHIFT[0] : u + f.module[0] * MODULES[0], bv = turned ? u + SHIFT[1] : v + f.module[1] * MODULES[1];
  for (const r of read) r.fill(0);
  if (t < 1) {
    sample(0, id, u, v, spread, read[0]!);
    if (!light) {
      sample(2, id, u, v, spread, read[1]!);
      sample(1, id, u, v, spread, read[2]!);
    }
  }
  if (t > 0) {
    sample(0, id, bu, bv, spread, read[3]!);
    sample(2, id, bu, bv, spread, read[4]!);
    sample(1, id, bu, bv, spread, read[5]!);
  }
  const s = t <= 0 ? 0 : t >= 1 ? 1 : higher(read[1]![3]!, read[4]![3]!, t);
  maps.patch = light ? second : s;
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
  if (light) maps.mro.set([1, f.mean, 0, 0.5]);
}

/**
 * Writes linear albedo, ORM and the bumped normal of finish `index` at world point (x, y, z), and returns the height
 * there in millimetres with the finish's lift. `palette` is the palette colour as light. `footprint` is metres covered
 * by one screen pixel on the projection. `light` is the touch rule's finish (assets/tiers.ts `finish`): the base colour
 * of one copy alone, and no stain. (nx, ny, nz) is the face's normal, which chooses the projection and where growth
 * takes; `smooth`, where given, is the normal the light falls on and the bump turns (the ground's, from its heights),
 * and otherwise the face's is. `eye`, where given, is the way to the eye, and the finish is read where that ray meets
 * its painted height (assets/tiers.ts `relief`).
 */
export function worldSurface(albedo: Out, orm: Out, normal: Out, palette: Numbers, index: number, x: number, y: number, z: number,
  nx: number, ny: number, nz: number, footprint: number, city: Numbers, sample: WorldSample, light = false, smooth: Numbers | null = null, eye: Numbers | null = null): number {
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
  finishMaps(index, u, v, spread, sample, light, tangent, depth);
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

const fl = (n: number): string => Number.isInteger(n) ? n.toFixed(1) : String(n);
const vectors = (name: string, rows: readonly (readonly number[])[]): string => {
  const t = `vec${rows[0]!.length}`;
  return `const ${t} ${name}[16] = ${t}[16](${rows.map((a) => `${t}(${a.map(fl).join(",")})`).join(",")});\n`;
};
/** Adds a material index to FLAT's mesh vertex texts, and gives the colour as light, keeping the low-poly texts byte-for-byte. */
export function worldVertex(vertex: string): string {
  const table = Array.from({ length: 256 }, (_, i) => surfaceIndex(i, false));
  const lookup = `flat out int vSurface;\nconst int SURFACE_IDS[256] = int[256](${table.join(",")});\n`;
  const light = "  vColor = mix(vColor / 12.92, pow((vColor + 0.055) / 1.055, vec3(2.4)), step(0.04045, vColor));\n";
  return vertex.replace("out vec3 vRel;", lookup + "out vec3 vRel;").replace("  vRel = p;", `  vSurface = SURFACE_IDS[int(i)];\n${light}  vRel = p;`);
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
uniform vec3 uWorldPhase[16];
uniform vec4 uSurfaceCity[3];
uniform float uWorldReady;
uniform highp sampler2DArray uWorldBase, uWorldNormal, uWorldOrm;
${vectors("WF", finishes.map((f) => [f.metres, f.bump, f.rough, f.metal]))}
${vectors("WT", finishes.map((f) => [...f.tint, f.palette]))}
${vectors("WW", finishes.map((f) => [f.weather, f.wetness, f.growth, f.mean]))}
${vectors("WM", finishes.map((f) => [...f.module, f.height, f.lift]))}const float WS[16] = float[16](${finishes.map((f) => fl(f.patch)).join(",")});

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
  float layer = float(id);
  float above = 1.0 - textureGrad(uWorldOrm, vec3(second ? secondAt(q, id) : q, layer), gx, gy).a, under = 0.0;
  int k = 1;
  for (; k <= ${RELIEF_STEPS}; k++) {
    vec2 p = q + along * float(k);
    under = textureGrad(uWorldOrm, vec3(second ? secondAt(p, id) : p, layer), gx, gy).a - (1.0 - float(k) / ${fl(RELIEF_STEPS)});
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
  float t = 0.0;
#else
  float t = second;
#endif
#ifdef WORLD_RELIEF
  if (depth > 0.0) q = worldRelief(id, q, dx, dy, view, depth, t >= 0.5);
#endif
  vec2 qb = secondAt(q, id);
  vec2 bx = turned ? vec2(-dx.y, dx.x) : dx, by = turned ? vec2(-dy.y, dy.x) : dy;
  float layer = float(id);
  vec4 b0 = vec4(0.0), r0 = vec4(0.0), b1 = vec4(0.0), r1 = vec4(0.0);
  vec2 n0 = vec2(0.0), n1 = vec2(0.0);
  if (t < 1.0) {
    b0 = textureGrad(uWorldBase, vec3(q, layer), dx, dy);
#ifndef WORLD_LIGHT
    r0 = textureGrad(uWorldOrm, vec3(q, layer), dx, dy);
    n0 = lean(textureGrad(uWorldNormal, vec3(q, layer), dx, dy));
#endif
  }
  if (t > 0.0) {
    b1 = textureGrad(uWorldBase, vec3(qb, layer), bx, by);
    r1 = textureGrad(uWorldOrm, vec3(qb, layer), bx, by);
    n1 = lean(textureGrad(uWorldNormal, vec3(qb, layer), bx, by));
    if (turned) n1 = vec2(-n1.y, n1.x);
  }
  float s = t <= 0.0 ? 0.0 : t >= 1.0 ? 1.0 : higher(r0.a, r1.a, t, 1.0, ${fl(WORLD_BAND)});
#ifdef WORLD_LIGHT
  tone = second;
#else
  tone = s;
#endif
  base = mix(b0, b1, s);
  mro = mix(r0, r1, s);
  bump = mix(n0, n1, s);
#ifdef WORLD_LIGHT
  mro = vec4(1.0, WW[id].w, 0.0, 0.5);
#endif
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
`;
