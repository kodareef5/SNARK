// How the lit tiers light what they draw. A mesh with materials has its base colour dyed by the instance's region
// colours; a flat draw (LIT) is its palette colour on a fully rough surface that is not metal. Either is lit in linear
// light by the sun, the moon and the sky as the frame block has them, then exposed, put through the tone curve and
// shown. The maths is here twice: as functions on numbers, which the software rasterizer runs, and as GLSL, which a
// WebGL2 shell compiles as is. Both are written from the constants below, and the GLSL's functions are named as
// their twins here.
//
// Directions are in the world and of length 1. Colours are linear until `shown`.

import { SEED_GLSL, STREET_GLSL } from "./street-finish.ts";
import type { TextureFormat, TextureRole } from "../../../shared/pack/texture.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import { HAND_GLSL, HAND_VERTEX } from "./hand.ts";
import { BONES_PER_ROW, DRAW_GROUND, DRAW_ONE_BONE, DRAW_SIZED, DRAW_SKINNED, FRAME, FRAME_BLOCK, type FramePacket } from "./packet.ts";
import { CONTACT_GLSL } from "./contact.ts";
import { SHADOW_GLSL } from "./shadowtext.ts";
import { OVER_GROUND_GLSL, SKY_OPEN_GLSL } from "./skyopen.ts";
import { WEAR_GLSL, wearAlpha } from "./wear.ts";

/** What a surface that is not metal reflects head on. */
export const DIELECTRIC = 0.04;
/** The smoothest a surface is lit as. The sun is a point, and a highlight narrower than this would fall between pixels. */
export const SMOOTHEST = 0.08;
/** The four numbers of `skyShare`'s fit. */
const FIT_ROUGH = 0.7;
const FIT_LEAN = 2.6;
const FIT_EDGE = 4;
const FIT_DULL = 5;
/** A normal map's x and y are stored with 128 of 255 as 0 and 255 as 1. */
const BUMP_SCALE = 255 / 127;
const BUMP_ZERO = 128 / 127;
/** Where the tone curve begins to bend, and how fast what is above it turns toward white: Khronos PBR Neutral's shoulder, without its toe. */
export const KNEE = 0.8;
const WHITEN = 0.15;

/**
 * What a texture a material lacks reads as, in bytes: white, a normal that points straight out (in every variant's
 * channels), no occlusion on a fully rough surface that is not metal, and no colour region. A normal or packed map
 * that has not arrived reads the same.
 */
export const NEUTRAL: Readonly<Record<TextureRole, readonly [number, number, number, number]>> = {
  base: [255, 255, 255, 255],
  normal: [128, 128, 128, 128],
  mro: [255, 255, 0, 255],
  mask: [0, 0, 0, 0],
  mask2: [0, 0, 0, 0],
  layer: [0, 0, 0, 0],
};

/**
 * A body's layer is drawn at a level from 0 to 1: the three hurt stages, a sixth each, then a corpse's three decay
 * stages after the fresh corpse at a half. A draw carries it in LAYER_LEVELS steps (packet.ts `drawLayer`), so a body
 * moving from one stage to the next is drawn through sixteen steps between.
 */
export const LAYER_STAGES = 6;
export const LAYER_LEVELS = LAYER_STAGES * 16;
/**
 * A texel of the layer fades in over the inverse of this share of the level, a little under a quarter of a stage, once
 * the level passes it: so a hurt texel of alpha 191, 106 or 21 is whole by stages 1, 2 and 3, and a decay texel so by decay's.
 */
const LAYER_EDGE = 26;
/** A corpse fully decayed is this much toward grey, a little warm, and this much darker. */
const DULL = 0.55;
const DULL_TINT = [1.04, 0.97, 0.86] as const;
const DARKEN = 0.3;
/** A fresh wound is wet: its roughness goes to this, drying as the corpse decays. */
const WET = 0.32;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

type Numbers = ArrayLike<number>;
type Out = number[] | Float32Array | Float64Array;

/**
 * Street lamps that still work light at dusk and go out at dawn: wholly on with the true sun (sky.ts `trueSun`) at the
 * horizon or under it, wholly off from LAMPS_OFF up, between the two by smoothstep. So does a material that glows only
 * by night (shared/pack/pack.ts `MATERIAL_NIGHT`), its emissive scaled by this for the frame.
 */
export const LAMPS_OFF = 0.12;

/** How much the lamps are on in this frame, 0 to 1. */
export function lampsOn(frame: Numbers): number {
  // The true sun is the moon's direction turned round.
  const t = Math.min(1, Math.max(0, (LAMPS_OFF + frame[FRAME.moon + 1]!) / LAMPS_OFF));
  return t * t * (3 - 2 * t);
}

/** A display value as light, and light as a display value: the sRGB curve. */
export function srgbToLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

/**
 * What each of an instance's six regions dyes with, three numbers a region: its palette colour as light, over the
 * material's grey, so that a dyed surface averages the palette colour. Colour 0 does not dye.
 */
export function regionDyes(out: Out, palette: Uint8Array, regions: Numbers, at: number, grey: number): void {
  for (let k = 0; k < 6; k++) {
    const colour = regions[at + k]!;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = colour === 0 ? 1 : srgbToLinear(palette[colour * 4 + c]! / 255) / grey;
  }
}

/** The base colour under the material's tint and the instance's dye. `mask` and `mask2` are how much of regions 0 to 2 and 3 to 5 the pixel has. */
export function dyed(out: Out, base: Numbers, tint: Numbers, dyes: Numbers, mask: Numbers, mask2: Numbers): void {
  const undyed = 1 - (mask[0]! + mask[1]! + mask[2]! + mask2[0]! + mask2[1]! + mask2[2]!);
  for (let c = 0; c < 3; c++) {
    const dye = undyed + mask[0]! * dyes[c]! + mask[1]! * dyes[3 + c]! + mask[2]! * dyes[6 + c]! + mask2[0]! * dyes[9 + c]! + mask2[1]! * dyes[12 + c]! + mask2[2]! * dyes[15 + c]!;
    out[c] = base[c]! * tint[c]! * dye;
  }
}

/**
 * The dyed colour `albedo` and the packed map `mro` as a body's layer leaves them at `level` (LAYER_STAGES). `layer` is
 * the layer sampled: its colour as light, and in alpha how soon it shows, 1 at once and 0 never. A texel shows once
 * the level passes 1 less its alpha, fading in over a quarter stage; it takes the place of the dyed colour and is wet
 * while the body is fresh. A corpse's decay dulls and darkens all of it. `late` is the stages a road vehicle's wear
 * story holds the texel back where it lies (wear.ts).
 */
export function wounded(albedo: Out, mro: Out, layer: Numbers, level: number, late = 0): void {
  const shows = Math.min(Math.max((level - 1 + wearAlpha(layer[3]!, late, LAYER_STAGES)) * LAYER_EDGE, 0), 1);
  const decay = Math.min(Math.max(level * 2 - 1, 0), 1);
  for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! + (layer[c]! - albedo[c]!) * shows;
  const grey = albedo[0]! * LUMA[0] + albedo[1]! * LUMA[1] + albedo[2]! * LUMA[2];
  for (let c = 0; c < 3; c++) albedo[c] = (albedo[c]! + (grey * DULL_TINT[c]! - albedo[c]!) * decay * DULL) * (1 - decay * DARKEN);
  mro[1] = mro[1]! + (WET - mro[1]!) * shows * (1 - decay);
}

/**
 * The normal to light by. `x` and `y` are the normal map's two channels as sampled, 0 to 1, and the third is what
 * length 1 leaves. They are set on the surface's tangent, its bitangent (the normal crossed with the tangent, on the
 * side the tangent's fourth number says) and its normal, as the vertices carry them. A face seen from behind is lit
 * as its other side.
 */
export function bumped(out: Out, normal: Numbers, tangent: Numbers, x: number, y: number, back: boolean): void {
  const bx = Math.min(Math.max(x * BUMP_SCALE - BUMP_ZERO, -1), 1);
  const by = Math.min(Math.max(y * BUMP_SCALE - BUMP_ZERO, -1), 1);
  const bz = Math.sqrt(Math.max(1 - bx * bx - by * by, 0));
  const nx = normal[0]!, ny = normal[1]!, nz = normal[2]!;
  const tx = tangent[0]!, ty = tangent[1]!, tz = tangent[2]!;
  const side = by * tangent[3]!;
  const ox = bx * tx + side * (ny * tz - nz * ty) + bz * nx;
  const oy = bx * ty + side * (nz * tx - nx * tz) + bz * ny;
  const oz = bx * tz + side * (nx * ty - ny * tx) + bz * nz;
  const scale = (back ? -1 : 1) / Math.hypot(ox, oy, oz);
  out[0] = ox * scale;
  out[1] = oy * scale;
  out[2] = oz * scale;
}

/**
 * The share of a sky of one colour that a surface's highlight sends to the eye. `f0` is what the surface reflects
 * head on and `nv` the cosine between its normal and the eye. Fitted to the integral, over the sky, of the highlight
 * `lit` gives the sun. Without Fresnel's part it is exact at roughness 1.
 */
export function skyShare(f0: number, rough: number, nv: number): number {
  skyParts(rough, nv);
  return f0 * parts[0]! + (1 - f0) * parts[1]!;
}

const parts = new Float64Array(2);

/** `skyShare`'s two parts, which do not hang on `f0`: what a white metal sends, and what is added at the edge. */
function skyParts(rough: number, nv: number): void {
  const a = rough * rough;
  parts[0] = 1 - nv * Math.log(1 + 1 / nv) * Math.pow(a, FIT_ROUGH * rough + FIT_LEAN * (1 - rough) * nv);
  parts[1] = Math.pow(1 - nv, 5 - FIT_EDGE * rough) / ((1 + FIT_DULL * a) * (1 + FIT_DULL * a));
}

/**
 * The sky's light on a surface whose normal is `up` high, -1 to 1: the frame block's light from above on a surface
 * facing up and from below on one facing down, mixed by how much of each it faces.
 */
export function skyOn(out: Out, frame: Numbers, up: number): void {
  const t = 0.5 + 0.5 * up;
  for (let c = 0; c < 3; c++) out[c] = frame[FRAME.skyBelow + c]! * (1 - t) + frame[FRAME.skyAbove + c]! * t;
}

/**
 * The sky's light on land, on a surface whose normal is `n`: `skyOn`'s, and on a face turned sideways more, from the
 * bright low sky (fSkySide), most when upright; and round from the sun's side, by how far the face is turned toward
 * the sun's way round (fSkySun) and by the square of that (fSkyAlong), which together hold a glow low on the sun's
 * side and a darker far side.
 */
export function skyLight(out: Out, frame: Numbers, n: Numbers): void {
  const y = n[1]!;
  const side = 1 - y * y;
  const sx = -frame[FRAME.moon]!, sz = -frame[FRAME.moon + 2]!;
  const toward = (n[0]! * sx + n[2]! * sz) / Math.sqrt(Math.max(sx * sx + sz * sz, 1e-12));
  skyOn(out, frame, y);
  for (let c = 0; c < 3; c++) out[c]! += frame[FRAME.skySide + c]! * side + (frame[FRAME.skySun + c]! + frame[FRAME.skyAlong + c]! * toward) * toward;
}

/**
 * Adds one light's share: the frame block's direction at `way` and colour at `colour`, `shade` of it reaching the
 * surface. Lambert and a GGX highlight as wide as the roughness squared, shadowed by Smith's term and edged by Schlick's.
 */
function direct(out: Out, frame: Numbers, way: number, colour: number, albedo: Numbers, metal: number, a2: number, n: Numbers, v: Numbers, nv: number, shade = 1): void {
  const lx = frame[way]!, ly = frame[way + 1]!, lz = frame[way + 2]!;
  const nl = Math.max(n[0]! * lx + n[1]! * ly + n[2]! * lz, 0);
  // What the shader works out and adds as nothing.
  if (nl === 0 || shade === 0 || frame[colour]! + frame[colour + 1]! + frame[colour + 2]! === 0) return;
  const hx = lx + v[0]!, hy = ly + v[1]!, hz = lz + v[2]!;
  const hl = Math.max(Math.hypot(hx, hy, hz), 1e-6);
  const nh = Math.min(Math.max((n[0]! * hx + n[1]! * hy + n[2]! * hz) / hl, 0), 1);
  const vh = Math.min(Math.max((v[0]! * hx + v[1]! * hy + v[2]! * hz) / hl, 0), 1);
  // GGX and Smith's term together, times pi.
  const d = nh * nh * (a2 - 1) + 1;
  const gloss = ((a2 / (d * d)) * 0.5) / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
  const edge = Math.pow(1 - vh, 5);
  for (let c = 0; c < 3; c++) {
    const f0 = DIELECTRIC + (albedo[c]! - DIELECTRIC) * metal;
    out[c]! += shade * frame[colour + c]! * nl * (albedo[c]! * (1 - metal) + gloss * (f0 + (1 - f0) * edge));
  }
}

const sky = new Float64Array(3);

/**
 * The light a pixel sends to the eye, from the frame block `frame`. `mro` is occlusion, roughness and metalness, `n`
 * the normal, `v` the way to the eye, and `mirror` the sky's light from where the eye's ray is reflected to. The sun
 * and the moon each light by `direct`. The sky lights from all round as `skyLight` has it, less where the surface is
 * occluded: the colour under the highlight, and the highlight itself, which shows `mirror` where the surface is smooth
 * and turns to the same light as the colour's as it roughens. `shade` is how much of the sun reaches the pixel, which
 * only the GPU's shadow maps know (shadowtext.ts), so the rasterizer leaves it 1.
 */
export function lit(out: Out, albedo: Numbers, mro: Numbers, n: Numbers, v: Numbers, frame: Numbers, mirror: Numbers, shade = 1): void {
  const rough = Math.max(mro[1]!, SMOOTHEST);
  const metal = mro[2]!;
  const a = rough * rough;
  const nv = Math.min(Math.max(n[0]! * v[0]! + n[1]! * v[1]! + n[2]! * v[2]!, 0.001), 1);
  skyLight(sky, frame, n);
  skyParts(rough, nv);
  for (let c = 0; c < 3; c++) {
    const f0 = DIELECTRIC + (albedo[c]! - DIELECTRIC) * metal;
    out[c] = mro[0]! * (sky[c]! * albedo[c]! * (1 - metal) + (f0 * parts[0]! + (1 - f0) * parts[1]!) * (mirror[c]! * (1 - a) + sky[c]! * a));
  }
  direct(out, frame, FRAME.sun, FRAME.sunColor, albedo, metal, a * a, n, v, nv, shade);
  direct(out, frame, FRAME.moon, FRAME.moonColor, albedo, metal, a * a, n, v, nv);
}

const behind = new Float64Array(3);

/**
 * A thin sheet's light from behind, added to `out`: `sheet` of what its other face, facing away from `n`, takes from the
 * sky, the sun and the moon, as a face that is not metal and fully rough would show it (shared/pack/finish.ts). `shade`
 * is how much of the sun reaches that face.
 */
export function through(out: Out, albedo: Numbers, mro: Numbers, n: Numbers, frame: Numbers, sheet: number, shade = 1): void {
  if (sheet <= 0) return;
  for (let c = 0; c < 3; c++) behind[c] = -n[c]!;
  skyLight(sky, frame, behind);
  const sun = Math.max(behind[0]! * frame[FRAME.sun]! + behind[1]! * frame[FRAME.sun + 1]! + behind[2]! * frame[FRAME.sun + 2]!, 0) * shade;
  const moon = Math.max(behind[0]! * frame[FRAME.moon]! + behind[1]! * frame[FRAME.moon + 1]! + behind[2]! * frame[FRAME.moon + 2]!, 0);
  for (let c = 0; c < 3; c++) out[c]! += sheet * mro[0]! * albedo[c]! * (1 - mro[2]!) * (sky[c]! + frame[FRAME.sunColor + c]! * sun + frame[FRAME.moonColor + c]! * moon);
}

/**
 * The tone curve. Light under KNEE is kept as it is. A colour whose brightest channel is over it is brought under 1,
 * keeping its hue, and turned toward white the further over it was. It meets the line with slope 1 at the knee.
 */
export function tone(out: Out, c: Numbers): void {
  const peak = Math.max(c[0]!, c[1]!, c[2]!);
  const d = 1 - KNEE;
  const top = peak <= KNEE ? peak : 1 - (d * d) / (peak + d - KNEE);
  const white = peak <= KNEE ? 0 : 1 - 1 / (WHITEN * (peak - top) + 1);
  for (let k = 0; k < 3; k++) {
    const kept = peak <= KNEE ? c[k]! : (c[k]! * top) / peak;
    out[k] = kept * (1 - white) + top * white;
  }
}

/** `tone` undone, for a toned colour whose brightest channel is under 1: that channel is the curve's top, which says the light's peak. */
export function untone(out: Out, t: Numbers): void {
  const top = Math.max(t[0]!, t[1]!, t[2]!);
  const d = 1 - KNEE;
  const peak = top <= KNEE ? top : (d * d) / (1 - top) - d + KNEE;
  const white = top <= KNEE ? 0 : 1 - 1 / (WHITEN * (peak - top) + 1);
  for (let k = 0; k < 3; k++) out[k] = top <= KNEE ? t[k]! : ((t[k]! - top * white) / (1 - white)) * (peak / top);
}

/**
 * The grade after the tone curve (content/grade.ts), from the frame block's finish: each colour kept `saturation` as far
 * from its grey, then raised to `gamma`. The twin of the GLSL `graded`.
 */
export function graded(out: Out, frame: Numbers): void {
  const grey = out[0]! * LUMA[0] + out[1]! * LUMA[1] + out[2]! * LUMA[2];
  const saturation = frame[FRAME.saturation]!, gamma = frame[FRAME.gamma]!;
  for (let c = 0; c < 3; c++) out[c] = Math.pow(Math.max(grey + (out[c]! - grey) * saturation, 0), gamma);
}

/** `graded` undone, for a colour it did not clamp: the gamma taken back, then the colour as far from its grey as it was, which the grey keeps. */
export function ungraded(out: Out, frame: Numbers): void {
  const saturation = frame[FRAME.saturation]!, gamma = frame[FRAME.gamma]!;
  for (let c = 0; c < 3; c++) out[c] = Math.pow(Math.max(out[c]!, 0), 1 / gamma);
  const grey = out[0]! * LUMA[0] + out[1]! * LUMA[1] + out[2]! * LUMA[2];
  for (let c = 0; c < 3; c++) out[c] = grey + (out[c]! - grey) / saturation;
}

/**
 * What is drawn: light times the frame's exposure and the grade's gain, through the tone curve, graded (post.ts), clamped
 * and shown as display values; a frame with no grade (a gamma of 0) is not graded. Under water it is then in the fog
 * `dist` metres off, the frame's `skyShown`. Above water the GLSL puts the air in first (atmosphere.ts `hazed`), which the rasterizer leaves
 * out (D264). A tier with a light target (post.ts) mixes the fog in as light before the tone curve, as its finishing
 * pass does; its bloom, sharpen and dither are the GPU's alone.
 */
export function shown(out: Out, light: Numbers, dist: number, p: FramePacket): void {
  const f = p.frame, exposure = f[FRAME.exposure]!, post = p.tier.post !== null, grading = f[FRAME.gamma]! > 0;
  let fog = f[FRAME.eyeHeight]! >= 0 ? 0 : (dist - p.fogStart) / (p.fogEnd - p.fogStart);
  fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
  const air = [0, 0, 0];
  for (let c = 0; c < 3; c++) air[c] = srgbToLinear(p.sky[c]!) * (grading ? f[FRAME.grade + c]! : 1);
  for (let c = 0; c < 3; c++) out[c] = light[c]! * exposure * (grading ? f[FRAME.grade + c]! : 1) * (post ? 1 - fog : 1) + (post ? air[c]! * fog : 0);
  tone(out, out);
  if (grading) graded(out, f);
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.min(Math.max(out[c]!, 0), 1)) * (post ? 1 : 1 - fog) + (post ? 0 : p.skyShown[c]! * fog);
}

/**
 * The fog's colour of a frame drawn with no light target, `skyShown`: the sky's colour taken as light, graded and shown
 * as everything else is where the frame is graded, and the sky's colour itself where it is not. Once a frame, so a
 * shader is told it (uSky) and does not grade it again each fragment.
 */
export function skyShown(p: FramePacket): void {
  const f = p.frame, out = p.skyShown;
  if (!(f[FRAME.gamma]! > 0)) return void out.set(p.sky);
  for (let c = 0; c < 3; c++) out[c] = srgbToLinear(p.sky[c]!) * f[FRAME.grade + c]!;
  tone(out, out);
  graded(out, f);
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.min(Math.max(out[c]!, 0), 1));
}

/**
 * How a draw's vertices are placed, which is `uSkin`: 0 a rigid mesh turned by its yaw, -1 the same at the size its instance
 * carries (DRAW_SIZED), -2 the same each vertex on the ground under it (DRAW_GROUND, which only a textured draw follows),
 * 1 each vertex on its own bone, 2 each on its own bone of the pose the draw stands in (DRAW_ONE_BONE) and then on the
 * instance's first bone, 3 each on up to four bones by its skin entry. `entries` says the level has those.
 */
export function skinMode(flags: number, entries: boolean): number {
  if ((flags & DRAW_SKINNED) === 0) return (flags & DRAW_SIZED) !== 0 ? -1 : (flags & DRAW_GROUND) !== 0 ? -2 : 0;
  return (flags & DRAW_ONE_BONE) !== 0 ? 2 : entries ? 3 : 1;
}

/** A number as GLSL writes it. */
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * How a SURFACE program is made: `dyed` reads the instance's region colours and the material's masks, which a
 * material without masks does without; `drops` may leave a fragment out, by a cut-out draw's cutoff or a node's
 * hand-over (hand.ts), which every other draw does without, so a GPU can skip what is hidden before shading it.
 */
export interface SurfaceVariant {
  readonly dyed: boolean;
  readonly drops: boolean;
  /** A body's hurt and decay layer, at `uLevel`. */
  readonly layered: boolean;
}

export const SURFACE_ANY: SurfaceVariant = { dyed: true, drops: true, layered: false };

/**
 * The vertex text. Its attributes 0 and 2 to 6 are the flat program's, `uSkin` is what `skinMode` gives, and `uUv` is
 * what the mesh's stored texture coordinates span (PackMesh.uv): 0, 0, 1, 1 for a mesh that does not say. A layered
 * one passes on where the vertex lies at rest in its mesh's bounds, -1 to 1, for the wear story (wear.ts).
 */
export const surfaceVertex = ({ dyed, drops, layered }: SurfaceVariant): string => `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
layout(location=6) in uint aBone;
layout(location=7) in vec2 aUv;
layout(location=8) in vec3 aNormal;
layout(location=9) in vec4 aTangent;

layout(location=12) in uint iEntity;
flat out float vFinishSeed;
uniform vec3 uWorldEye;
${SEED_GLSL}
layout(location=10) in uvec4 aBones;
layout(location=11) in vec4 aWeights;
uniform mat4 uViewProj;
uniform vec3 uOffset, uCenter, uHalf;
uniform vec4 uUv;
uniform float uSkin${dyed ? ", uGrey" : ""};
uniform highp sampler2D ${dyed ? "uPalette, " : ""}uBones;
uniform highp usampler2D uWindowHeight;
out vec3 vRel, vNormal;
out vec4 vTangent;
out vec2 vUv;
${layered ? "out vec3 vBox;\n" : ""}${dyed ? "flat out mat3 vDye, vDye2;\n" : ""}${drops ? "flat out float vAt;\n" : ""}${FRAME_BLOCK}${drops ? HAND_VERTEX : ""}mat3x4 bone(int i) {
  int n = i * 3;
  ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
  return mat3x4(texelFetch(uBones, at, 0), texelFetch(uBones, at + ivec2(1, 0), 0), texelFetch(uBones, at + ivec2(2, 0), 0));
}
${dyed ? DYE : ""}${ON_GROUND}void main() {

  vFinishSeed = uSkin > 0.5 ? finishSeed(iEntity,vec3(0.0)) : finishSeed(0u,iPos+uOffset+uWorldEye);
  vec3 l = uCenter + aPos * uHalf;
  vec3 p, n, t;
  if (uSkin > 0.5) {
    int first = int(iYaw * 65535.0 + 0.5);
    mat3x4 m;
    if (uSkin > 2.5) m = bone(first + int(aBones.x)) * aWeights.x + bone(first + int(aBones.y)) * aWeights.y + bone(first + int(aBones.z)) * aWeights.z + bone(first + int(aBones.w)) * aWeights.w;
    else m = bone(first + (uSkin > 1.5 ? 0 : int(aBone)));
    vec4 v = vec4(l + iPos, 1.0), nv = vec4(aNormal, 0.0), tv = vec4(aTangent.xyz, 0.0);
    if (uSkin > 1.5 && uSkin < 2.5) {
      // Standing in a pose: first its bone of that pose, whose first bone is uOffset.x, about the body's origin.
      mat3x4 s = bone(int(uOffset.x) + int(aBone));
      v = vec4(v * s, 1.0);
      nv = vec4(nv * s, 0.0);
      tv = vec4(tv * s, 0.0);
    }
    p = v * m;
    n = nv * m;
    t = tv * m;
  } else {
    float a = iYaw * 6.283185307;
    float s = sin(a), c = cos(a);
    mat3 r = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    p = r * (uSkin < -0.5 && uSkin > -1.5 ? l * (float(iRegB.y) / ${f(SIZE_UNITS)}) : l) + iPos + uOffset;
    if (uSkin < -1.5) p.y = onGround(p, l.y);
    n = r * aNormal;
    t = r * aTangent.xyz;
  }
${dyed ? "  vDye = mat3(dye(iRegA.x), dye(iRegA.y), dye(iRegA.z));\n  vDye2 = mat3(dye(iRegA.w), dye(iRegB.x), dye(uSkin < -0.5 && uSkin > -1.5 ? 0u : iRegB.y));\n" : ""}  vRel = p;
${drops ? "  vAt = length(iPos + uOffset);\n" : ""}  vNormal = normalize(n);
  vTangent = vec4(normalize(t), aTangent.w);
  vUv = uUv.xy + aUv * uUv.zw;
${layered ? "  vBox = aPos;\n" : ""}  gl_Position = ${drops ? "handGone(vAt) ? vec4(0.0, 0.0, 2.0, 1.0) : " : ""}uViewProj * vec4(p, 1.0);
}`;

/**
 * The ground under a camera-relative point, camera-relative, by the triangles the terrain draws from the window's samples
 * (heightfield.ts heightAt), `lift` over it; where the window does not reach, the point's own height. Its twin is the
 * rasterizer's (tools/snap/raster.ts `pose`).
 */
const ON_GROUND = `float onGround(vec3 rel, float lift) {
  vec2 last = vec2(textureSize(uWindowHeight, 0) - 1);
  vec2 c = fGround.xy + rel.xz * fSea.z;
  if (any(lessThan(c, vec2(0.0))) || any(greaterThan(c, last))) return rel.y;
  ivec2 k = ivec2(min(floor(c), last - 1.0));
  vec2 f = c - vec2(k);
  float h00 = float(texelFetch(uWindowHeight, k, 0).r), h11 = float(texelFetch(uWindowHeight, k + 1, 0).r);
  float h;
  if (f.x >= f.y) {
    float h10 = float(texelFetch(uWindowHeight, k + ivec2(1, 0), 0).r);
    h = h00 + (h10 - h00) * f.x + (h11 - h10) * f.y;
  } else {
    float h01 = float(texelFetch(uWindowHeight, k + ivec2(0, 1), 0).r);
    h = h00 + (h11 - h01) * f.x + (h01 - h00) * f.y;
  }
  return (h - fSea.x) * fSea.y - fHaze.z + lift;
}
`;

const DYE = `vec3 dye(uint i) {
  if (i == 0u) return vec3(1.0);
  vec3 c = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)) / uGrey;
}
`;

export const SURFACE_VERTEX = surfaceVertex(SURFACE_ANY);

/** `graded` as GLSL, after the frame block. */
export const GRADED = `vec3 graded(vec3 c) {
  float grey = dot(c, vec3(${LUMA.map(f).join(", ")}));
  return pow(max(mix(vec3(grey), c, fGrade.a), 0.0), vec3(fFinish.x));
}
`;

/** `tone` as GLSL, and `encoded`, light as a display value on the sRGB curve: what LIGHT shows by, and the finishing pass (post.ts). */
export const TONE = `vec3 tone(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak <= ${f(KNEE)}) return c;
  float d = 1.0 - ${f(KNEE)};
  float top = 1.0 - d * d / (peak + d - ${f(KNEE)});
  float white = 1.0 - 1.0 / (${f(WHITEN)} * (peak - top) + 1.0);
  return mix(c * (top / peak), vec3(top), white);
}
vec3 encoded(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/**
 * The light's GLSL, which LIT, SURFACE and the dome share: the frame block, the fog's two uniforms, and the twins of
 * `skyShare`, `skyOn`, `skyLight`, `direct`, `lit`, `tone` and `shown`. `shown` takes where the point is from the eye, and the air
 * between (atmosphere.ts `hazed`, which a program defines after this) above water; under water, today's fog. What
 * lights includes SHADOW_GLSL after it, for `lit`'s shade. With LIGHT_TARGET defined (post.ts) it shows light as it
 * is after exposure, for the finishing pass to tone and grade, and the fog's colour as light; `SHOWN_STEP` is a
 * display step, which a text dithering what it shows takes, and 0 there.
 */
export const LIGHT = `${FRAME_BLOCK}${CONTACT_GLSL}uniform vec3 uSky;
uniform vec2 uFog;
vec3 skyShare(vec3 f0, float rough, float nv) {
  float a = rough * rough;
  float whole = 1.0 - nv * log(1.0 + 1.0 / nv) * pow(a, ${f(FIT_ROUGH)} * rough + ${f(FIT_LEAN)} * (1.0 - rough) * nv);
  float edge = pow(1.0 - nv, 5.0 - ${f(FIT_EDGE)} * rough) / ((1.0 + ${f(FIT_DULL)} * a) * (1.0 + ${f(FIT_DULL)} * a));
  return f0 * whole + (1.0 - f0) * edge;
}
vec3 skyOn(float up) {
  return mix(fSkyBelow.rgb, fSkyAbove.rgb, 0.5 + 0.5 * up);
}
vec3 skyLight(vec3 n) {
  float toward = dot(n.xz, fLook.xy);
  return skyOn(n.y) + fSkySide.rgb * (1.0 - n.y * n.y) + (fSkySun.rgb + fSkyAlong.rgb * toward) * toward;
}
vec3 direct(vec3 l, vec3 colour, vec3 albedo, float metal, float a2, vec3 n, vec3 v, float nv) {
  if (colour.r + colour.g + colour.b <= 0.0) return vec3(0.0);
  float nl = max(dot(n, l), 0.0);
  vec3 h = l + v;
  h /= max(length(h), 0.000001);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  float vh = clamp(dot(v, h), 0.0, 1.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float gloss = a2 / (d * d) * 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2));
  vec3 f0 = mix(vec3(${f(DIELECTRIC)}), albedo, metal);
  return colour * nl * (albedo * (1.0 - metal) + gloss * (f0 + (1.0 - f0) * pow(1.0 - vh, 5.0)));
}
vec3 lit(vec3 albedo, vec3 mro, vec3 n, vec3 v, vec3 mirrored, float shade) {
  float rough = max(mro.g, ${f(SMOOTHEST)});
  float a = rough * rough;
  float nv = clamp(dot(n, v), 0.001, 1.0);
  vec3 sky = skyLight(n);
  vec3 f0 = mix(vec3(${f(DIELECTRIC)}), albedo, mro.b);
  vec3 light = mro.r * (sky * albedo * (1.0 - mro.b) + skyShare(f0, rough, nv) * mix(mirrored, sky, a));
  return light + direct(fSun.xyz, fSunColor.rgb, albedo, mro.b, a * a, n, v, nv) * shade + direct(fMoon.xyz, fMoonColor.rgb, albedo, mro.b, a * a, n, v, nv);
}
${TONE}${GRADED}vec3 skyAsLight() {
  return mix(uSky / 12.92, pow((uSky + 0.055) / 1.055, vec3(2.4)), step(0.04045, uSky));
}
#ifdef LIGHT_TARGET
vec3 display(vec3 c) {
  return c;
}
vec3 fogShown() {
  return skyAsLight();
}
const float SHOWN_STEP = 0.0;
#else
vec3 display(vec3 c) {
  return encoded(clamp(fFinish.x > 0.0 ? graded(tone(c * fGrade.rgb)) : tone(c), 0.0, 1.0));
}
vec3 fogShown() {
  return uSky;
}
const float SHOWN_STEP = ${f(1 / 255)};
#endif
vec3 hazed(vec3 light, vec3 rel);
vec3 shown(vec3 light, vec3 rel) {
  if (fHaze.z >= 0.0) return display(hazed(light, rel) * fSunColor.w);
  float fog = clamp((length(rel) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  return mix(display(light * fSunColor.w), fogShown(), fog * fog);
}
`;

/**
 * `through` as GLSL, after LIGHT, and `sunward`, the face of a sheet the sun's shadow is looked up from: the one the sun
 * is on, which for a sheet lit from behind is its far face.
 */
export const THROUGH = `vec3 through(vec3 albedo, vec3 mro, vec3 n, float sheet, float shade) {
  if (sheet <= 0.0) return vec3(0.0);
  vec3 b = -n;
  return sheet * mro.r * albedo * (1.0 - mro.b) * (skyLight(b) + fSunColor.rgb * max(dot(b, fSun.xyz), 0.0) * shade + fMoonColor.rgb * max(dot(b, fMoon.xyz), 0.0));
}
vec3 sunward(vec3 n, float sheet) {
  return sheet > 0.0 && dot(n, fTrueSun) < 0.0 ? -n : n;
}
`;

/**
 * The sky's light from direction `r` into `out`: the sky table read by `look` (sky.ts domeLight on the table, at
 * where the sun is, sky.ts trueSun) and scaled to light. It is what a smooth surface mirrors, and the dome. The GLSL
 * twin is below.
 */
export function skyFrom(out: Out, frame: Float32Array, r: Numbers, look: (view: Numbers, out: Out) => void): void {
  look(r, out);
  for (let c = 0; c < 3; c++) out[c]! *= frame[FRAME.skyScale]!;
}

/** `skyFrom` as GLSL, with the sky table on its unit: `sky` is the table's lookup (sky.ts SKY_GLSL). */
export const skyFromGlsl = (sky: string): string => `uniform highp sampler3D uSkyTable;
${sky}
vec3 skyFrom(vec3 r) {
  return skyLook(uSkyTable, r) * fSkyScale;
}
`;

/**
 * The fragment text for a variant of the textures: `astc` keeps a normal's x in the colour channels and its y in
 * alpha, the others keep them in red and green. The base colour is an sRGB texture, so it is sampled as light, and
 * every texture repeats, since a material may run along a mesh more than once. `uCutoff` is the material's for a
 * cut-out draw and 0 for any other. A cut-out draw writes as alpha how much of the pixel lies on the solid side, for
 * alpha to coverage to take as samples. The rasterizer tests each pixel's middle, so the two differ only along a cut.
 * `air` is the sky table's lookup, which smooth surfaces mirror, and the air (atmosphere.ts AIR). The sun's shadow is
 * looked up off the surface along the mesh's normal, turned to the side seen, and so is the sky's openness, which with
 * the foot of what stands but a body takes the sky's light down (skyopen.ts). A node's draw first drops what its
 * hand-over between the near store and the far one says (hand.ts). With `layered` it draws a body's hurt and decay
 * layer as `wounded` has it, at `uLevel`; without, its text is the one every unhurt body is drawn with. Undyed, the
 * albedo is the base colour under the tint, which is what `dyed` gives with no mask; one that never drops writes alpha 1.
 */
export function surfaceFragment(format: TextureFormat, air: string, { dyed, drops, layered }: SurfaceVariant = SURFACE_ANY): string {
  const albedo = dyed ? "dyed(base.rgb, mask, mask2)" : "base.rgb * uTint";
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 vRel, vNormal;
in vec4 vTangent;
in vec2 vUv;
${dyed ? "flat in mat3 vDye, vDye2;\n" : ""}uniform sampler2D uBase, uNormal, uMro${dyed ? ", uMask, uMask2" : ""};
uniform vec3 uTint;
uniform float uCutoff, uSheet, uSkin, uEmissive;

flat in float vFinishSeed;
uniform float uStreetMaterial;
${layered ? "uniform sampler2D uLayer;\nuniform float uLevel;\n" : ""}out vec4 o;
${LIGHT}${THROUGH}${drops ? HAND_GLSL : ""}${SHADOW_GLSL}${SKY_OPEN_GLSL}${OVER_GROUND_GLSL}${air}${STREET_GLSL}${dyed ? DYED : ""}${layered ? WEAR_GLSL + WOUNDED : ""}vec3 bumped(vec2 b) {
  b = clamp(b * ${f(BUMP_SCALE)} - ${f(BUMP_ZERO)}, -1.0, 1.0);
  vec3 n = normalize(b.x * vTangent.xyz + b.y * vTangent.w * cross(vNormal, vTangent.xyz) + sqrt(max(1.0 - dot(b, b), 0.0)) * vNormal);
  return gl_FrontFacing ? n : -n;
}
void main() {
${drops ? "  if (handDrops()) discard;\n" : ""}  vec4 base = texture(uBase, vUv);
${dyed ? "  vec3 mask = texture(uMask, vUv).rgb;\n  vec3 mask2 = texture(uMask2, vUv).rgb;\n" : ""}  vec3 mro = texture(uMro, vUv).rgb;
  vec2 bump = texture(uNormal, vUv).${format === "astc" ? "ra" : "rg"};
${drops ? "  float cover = uCutoff > 0.0 ? clamp((base.a - uCutoff) / max(fwidth(base.a), 0.0001) + 0.5, 0.0, 1.0) : 1.0;\n  if (cover == 0.0) discard;\n" : "  float cover = 1.0;\n"}  vec3 v = -normalize(vRel);
  vec3 n = bumped(bump);
  float shade = sunShadow(vRel, sunward(normalize(gl_FrontFacing ? vNormal : -vNormal), uSheet));
  float open = skyOpen(vRel, normalize(gl_FrontFacing ? vNormal : -vNormal), overGround(vRel), uSkin > 0.5 ? 0.0 : 1.0) * contact(vRel, normalize(gl_FrontFacing ? vNormal : -vNormal), uSkin > 0.5 ? 0.0 : 1.0);
  vec3 albedo = ${layered ? `wounded(${albedo}, mro)` : albedo};
  vec3 ray = reflect(-v,n), mirror = skyFrom(ray);
  float coat = 0.0;

  float footprint = max(length(dFdx(vUv)),length(dFdy(vUv)));
  if (uStreetMaterial > 0.5) {
    float paint = uStreetMaterial < 1.5 ? ${dyed ? "mask.r" : "0.0"} * clamp((0.72-mro.g)*3.5,0.0,1.0) : 0.0;
    float receives = max(paint,max(clamp(mro.b*1.5,0.0,1.0)*clamp((0.85-mro.g)*3.0,0.0,1.0),clamp((0.34-mro.g)*5.0,0.0,1.0)));
    if (receives > 0.0) {
      float wear = coatWear(vUv,vFinishSeed,footprint);
      mro.g = clamp(mro.g+wear*receives-0.19*paint,0.07,1.0);
      mirror = streetMirror(mirror,ray,vRel,mro.g,receives);
      coat = paint*(0.045+0.22*pow(1.0-clamp(dot(n,v),0.0,1.0),5.0))*(1.0-mro.g);
    }
  }
  vec3 radiance = lit(albedo, mro * vec3(open, 1.0, 1.0), n, v, mirror, shade);
  o = vec4(shown(mix(radiance,mirror*open,coat) + through(albedo, mro, n, uSheet, shade) + albedo * uEmissive, vRel), cover);
}`;
}

const DYED = `vec3 dyed(vec3 base, vec3 mask, vec3 mask2) {
  return base * uTint * (1.0 - dot(mask + mask2, vec3(1.0)) + vDye * mask + vDye2 * mask2);
}
`;

/** `wounded` as GLSL, reading the layer on its unit at the draw's level, held back as the draw's wear story says. */
const WOUNDED = `vec3 wounded(vec3 albedo, inout vec3 mro) {
  vec4 layer = texture(uLayer, vUv);
  float shows = clamp((uLevel - 1.0 + wearAlpha(layer.a, wearLate(), ${f(LAYER_STAGES)})) * ${f(LAYER_EDGE)}, 0.0, 1.0);
  float decay = clamp(uLevel * 2.0 - 1.0, 0.0, 1.0);
  albedo = mix(albedo, layer.rgb, shows);
  float grey = dot(albedo, vec3(${LUMA.map(f).join(", ")}));
  albedo = mix(albedo, grey * vec3(${DULL_TINT.map(f).join(", ")}), decay * ${f(DULL)}) * (1.0 - decay * ${f(DARKEN)});
  mro.g = mix(mro.g, ${f(WET)}, shows * (1.0 - decay));
  return albedo;
}
`;
