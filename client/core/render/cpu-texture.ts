// CPU texture filtering shared by the software rasterizer and the browser self-check twins.
import type { TextureRole } from "../../../shared/pack/texture.ts";
import { srgbToLinear } from "./surface.ts";
import { WORLD_MIN_MIP } from "./world-surfaces.ts";

/** A texture on the card: its pictures as numbers from 0 to 1, smallest first, picture k being 1 << k pixels across. A base colour is held as light. */
export interface Texture {
  channels: number;
  pictures: Float32Array[];
}

const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Pictures of the rgba variant as a texture: two channels for a normal map and four for the rest. */
export function decodeTexture(role: TextureRole, pictures: readonly ArrayLike<number>[]): Texture {
  return {
    channels: role === "normal" ? 2 : 4,
    pictures: pictures.map((bytes) => Float32Array.from(bytes, (b, i) => ((role === "base" || role === "layer") && (i & 3) !== 3 ? TO_LINEAR[b]! : b / 255))),
  };
}

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
export function sample(t: Texture, u: number, v: number, spread: number, out: Float64Array): void {
  const top = t.pictures.length - 1;
  // How many halvings below the top picture a pixel of the texture is as large as a pixel of the screen.
  const level = top + spread > 0 ? Math.min(top + spread, top) : 0;
  const whole = Math.floor(level);
  out.fill(0);
  bilinear(t, top - whole, u, v, 1 - (level - whole), out);
  if (level > whole) bilinear(t, top - whole - 1, u, v, level - whole, out);
}

const worldMean = new Float64Array(4);

/** Atlas filtering matching worldRead: clamp within the finish, then fade to its isolated mean. */
export function sampleWorldTexture(t: Texture, u: number, v: number, spread: number, out: Float64Array): void {
  const top = t.pictures.length - 1;
  const lod = Math.max(0, Math.min(top + spread, Math.max(0, top - WORLD_MIN_MIP)));
  const x = Math.floor(u * 4) / 4, y = Math.floor(v * 4) / 4;
  const fade = Math.max(0, Math.min(1, (spread + WORLD_MIN_MIP) / (WORLD_MIN_MIP - 2)));
  if (fade > 0) sample(t, x + 0.125, y + 0.125, -Math.min(top, 4), worldMean);
  if (fade >= 1) { out.set(worldMean); return; }
  const margin = 0.5 * 2 ** (Math.ceil(lod) - top);
  sample(t, Math.max(x + margin, Math.min(x + 0.25 - margin, u)), Math.max(y + margin, Math.min(y + 0.25 - margin, v)), lod - top, out);
  if (fade > 0) for (let c = 0; c < t.channels; c++) out[c] = out[c]! * (1 - fade) + worldMean[c]! * fade;
}
