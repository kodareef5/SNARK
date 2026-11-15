// The second way to draw a mesh: with materials. A material's base colour is dyed by the instance's region colours,
// lit in linear light by the sun and the sky, and shown as the flat renderer shows its colours. The maths is here twice:
// as functions on numbers, which the software rasterizer runs, and as the GLSL of the SURFACE program, which a WebGL2
// shell compiles as is. Both are written from the constants below, and the fragment text's functions are named as
// their twins here.
//
// Directions are in the world and of length 1. Colours are linear, 0 to 1, until `shown`.

import type { TextureFormat, TextureRole } from "../../../shared/pack/texture.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import { BONES_PER_ROW, DRAW_ONE_BONE, DRAW_SIZED, DRAW_SKINNED, type FramePacket } from "./packet.ts";

/**
 * How strong the sun and the sky's light are. At these a mid-grey surface (128 of 255) that is fully rough and not
 * metal, seen and lit head on, is as bright as the flat renderer draws that grey, in the sun and out of it. A test
 * derives them.
 */
export const SUN = 0.6814;
export const SKY = 0.2715;
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
};

type Numbers = ArrayLike<number>;
type Out = number[] | Float32Array | Float64Array;

/** A display value as light, and light as a display value: the sRGB curve. */
export function srgbToLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

/** The sky's colour as light, before the day's light dims it: what a mirror shows of the sky. The shell sets `uSkyLight` from this. */
export function skyLight(out: Out, p: FramePacket): void {
  for (let c = 0; c < 3; c++) out[c] = srgbToLinear(Math.min(p.sky[c]! / Math.max(p.light, 1 / 255), 1));
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
  const a = rough * rough;
  const whole = 1 - nv * Math.log(1 + 1 / nv) * Math.pow(a, FIT_ROUGH * rough + FIT_LEAN * (1 - rough) * nv);
  const edge = Math.pow(1 - nv, 5 - FIT_EDGE * rough) / ((1 + FIT_DULL * a) * (1 + FIT_DULL * a));
  return f0 * whole + (1 - f0) * edge;
}

/**
 * The light a pixel sends to the eye. `mro` is occlusion, roughness and metalness, `n` the normal, `v` the way to the
 * eye, `sun` the way to the sun and `sky` what `skyLight` gives. The sun lights by Lambert and a GGX highlight as wide
 * as the roughness squared, shadowed by Smith's term and edged by Schlick's. The sky lights from all round, less where
 * the surface is occluded: evenly and white for the colour under the highlight, and for the highlight in the sky's
 * own colour where the surface is smooth, turning to the same white as it roughens.
 */
export function lit(out: Out, albedo: Numbers, mro: Numbers, n: Numbers, v: Numbers, sun: Numbers, sky: Numbers): void {
  const rough = Math.max(mro[1]!, SMOOTHEST);
  const metal = mro[2]!;
  const a = rough * rough;
  const a2 = a * a;
  const nl = Math.max(n[0]! * sun[0]! + n[1]! * sun[1]! + n[2]! * sun[2]!, 0);
  const nv = Math.min(Math.max(n[0]! * v[0]! + n[1]! * v[1]! + n[2]! * v[2]!, 0.001), 1);
  const hx = sun[0]! + v[0]!, hy = sun[1]! + v[1]!, hz = sun[2]! + v[2]!;
  const hl = Math.max(Math.hypot(hx, hy, hz), 1e-6);
  const nh = Math.min(Math.max((n[0]! * hx + n[1]! * hy + n[2]! * hz) / hl, 0), 1);
  const vh = Math.min(Math.max((v[0]! * hx + v[1]! * hy + v[2]! * hz) / hl, 0), 1);
  // GGX and Smith's term together, times pi.
  const d = nh * nh * (a2 - 1) + 1;
  const gloss = ((a2 / (d * d)) * 0.5) / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
  const edge = Math.pow(1 - vh, 5);
  for (let c = 0; c < 3; c++) {
    const diffuse = albedo[c]! * (1 - metal);
    const f0 = DIELECTRIC + (albedo[c]! - DIELECTRIC) * metal;
    const fromSun = SUN * nl * (diffuse + gloss * (f0 + (1 - f0) * edge));
    const fromSky = SKY * diffuse + skyShare(f0, rough, nv) * (sky[c]! + (SKY - sky[c]!) * a);
    out[c] = fromSun + mro[0]! * fromSky;
  }
}

/** What is drawn: the light as display values, under the day's light, in the fog `dist` metres off. The last two are the flat renderer's. */
export function shown(out: Out, light: Numbers, dist: number, p: FramePacket): void {
  let fog = (dist - p.fogStart) / (p.fogEnd - p.fogStart);
  fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
  for (let c = 0; c < 3; c++) out[c] = linearToSrgb(Math.min(Math.max(light[c]!, 0), 1)) * p.light * (1 - fog) + p.sky[c]! * fog;
}

/**
 * How a draw's vertices are placed, which is `uSkin`: 0 a rigid mesh turned by its yaw, -1 the same at the size its instance
 * carries (DRAW_SIZED), 1 each vertex on its own bone, 2 all on the instance's first bone, 3 each on up to four bones by its
 * skin entry. `entries` says the level has those.
 */
export function skinMode(flags: number, entries: boolean): number {
  if ((flags & DRAW_SKINNED) === 0) return (flags & DRAW_SIZED) !== 0 ? -1 : 0;
  return (flags & DRAW_ONE_BONE) !== 0 ? 2 : entries ? 3 : 1;
}

/** A number as GLSL writes it. */
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The vertex text. Its attributes 0 and 2 to 6 are the flat program's, `uSkin` is what `skinMode` gives, and `uUv` is
 * what the mesh's stored texture coordinates span (PackMesh.uv): 0, 0, 1, 1 for a mesh that does not say.
 */
export const SURFACE_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
layout(location=6) in uint aBone;
layout(location=7) in vec2 aUv;
layout(location=8) in vec3 aNormal;
layout(location=9) in vec4 aTangent;
layout(location=10) in uvec4 aBones;
layout(location=11) in vec4 aWeights;
uniform mat4 uViewProj;
uniform vec3 uOffset, uCenter, uHalf;
uniform vec4 uUv;
uniform float uSkin, uGrey;
uniform highp sampler2D uPalette, uBones;
out vec3 vRel, vNormal;
out vec4 vTangent;
out vec2 vUv;
flat out mat3 vDye, vDye2;
mat3x4 bone(int i) {
  int n = i * 3;
  ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
  return mat3x4(texelFetch(uBones, at, 0), texelFetch(uBones, at + ivec2(1, 0), 0), texelFetch(uBones, at + ivec2(2, 0), 0));
}
vec3 dye(uint i) {
  if (i == 0u) return vec3(1.0);
  vec3 c = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)) / uGrey;
}
void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p, n, t;
  if (uSkin > 0.5) {
    int first = int(iYaw * 65535.0 + 0.5);
    mat3x4 m;
    if (uSkin > 2.5) m = bone(first + int(aBones.x)) * aWeights.x + bone(first + int(aBones.y)) * aWeights.y + bone(first + int(aBones.z)) * aWeights.z + bone(first + int(aBones.w)) * aWeights.w;
    else m = bone(first + (uSkin > 1.5 ? 0 : int(aBone)));
    p = vec4(l + iPos, 1.0) * m;
    n = vec4(aNormal, 0.0) * m;
    t = vec4(aTangent.xyz, 0.0) * m;
  } else {
    float a = iYaw * 6.283185307;
    float s = sin(a), c = cos(a);
    mat3 r = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    p = r * (uSkin < -0.5 ? l * (float(iRegB.y) / ${f(SIZE_UNITS)}) : l) + iPos + uOffset;
    n = r * aNormal;
    t = r * aTangent.xyz;
  }
  vDye = mat3(dye(iRegA.x), dye(iRegA.y), dye(iRegA.z));
  vDye2 = mat3(dye(iRegA.w), dye(iRegB.x), dye(uSkin < -0.5 ? 0u : iRegB.y));
  vRel = p;
  vNormal = normalize(n);
  vTangent = vec4(normalize(t), aTangent.w);
  vUv = uUv.xy + aUv * uUv.zw;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

/**
 * The fragment text for a variant of the textures: `astc` keeps a normal's x in the colour channels and its y in
 * alpha, the others keep them in red and green. The base colour is an sRGB texture, so it is sampled as light, and
 * every texture repeats, since a material may run along a mesh more than once. `uCutoff` is the material's for a
 * cut-out draw and 0 for any other. A cut-out draw writes as alpha how much of the pixel lies on the solid side, for
 * alpha to coverage to take as samples. The rasterizer tests each pixel's middle, so the two differ only along a cut.
 */
export function surfaceFragment(format: TextureFormat): string {
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 vRel, vNormal;
in vec4 vTangent;
in vec2 vUv;
flat in mat3 vDye, vDye2;
uniform sampler2D uBase, uNormal, uMro, uMask, uMask2;
uniform vec3 uSun, uSky, uSkyLight, uTint;
uniform vec2 uFog;
uniform float uLight, uCutoff;
out vec4 o;
vec3 dyed(vec3 base, vec3 mask, vec3 mask2) {
  return base * uTint * (1.0 - dot(mask + mask2, vec3(1.0)) + vDye * mask + vDye2 * mask2);
}
vec3 bumped(vec2 b) {
  b = clamp(b * ${f(BUMP_SCALE)} - ${f(BUMP_ZERO)}, -1.0, 1.0);
  vec3 n = normalize(b.x * vTangent.xyz + b.y * vTangent.w * cross(vNormal, vTangent.xyz) + sqrt(max(1.0 - dot(b, b), 0.0)) * vNormal);
  return gl_FrontFacing ? n : -n;
}
vec3 skyShare(vec3 f0, float rough, float nv) {
  float a = rough * rough;
  float whole = 1.0 - nv * log(1.0 + 1.0 / nv) * pow(a, ${f(FIT_ROUGH)} * rough + ${f(FIT_LEAN)} * (1.0 - rough) * nv);
  float edge = pow(1.0 - nv, 5.0 - ${f(FIT_EDGE)} * rough) / ((1.0 + ${f(FIT_DULL)} * a) * (1.0 + ${f(FIT_DULL)} * a));
  return f0 * whole + (1.0 - f0) * edge;
}
vec3 lit(vec3 albedo, vec3 mro, vec3 n, vec3 v) {
  float rough = max(mro.g, ${f(SMOOTHEST)});
  float a = rough * rough;
  float a2 = a * a;
  float nl = max(dot(n, uSun), 0.0);
  float nv = clamp(dot(n, v), 0.001, 1.0);
  vec3 h = uSun + v;
  h /= max(length(h), 0.000001);
  float nh = clamp(dot(n, h), 0.0, 1.0);
  float vh = clamp(dot(v, h), 0.0, 1.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float gloss = a2 / (d * d) * 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2));
  vec3 diffuse = albedo * (1.0 - mro.b);
  vec3 f0 = mix(vec3(${f(DIELECTRIC)}), albedo, mro.b);
  vec3 fromSun = ${f(SUN)} * nl * (diffuse + gloss * (f0 + (1.0 - f0) * pow(1.0 - vh, 5.0)));
  vec3 fromSky = ${f(SKY)} * diffuse + skyShare(f0, rough, nv) * mix(uSkyLight, vec3(${f(SKY)}), a);
  return fromSun + mro.r * fromSky;
}
vec3 shown(vec3 light, float dist) {
  vec3 c = clamp(light, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  float fog = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  return mix(c * uLight, uSky, fog * fog);
}
void main() {
  vec4 base = texture(uBase, vUv);
  vec3 mask = texture(uMask, vUv).rgb;
  vec3 mask2 = texture(uMask2, vUv).rgb;
  vec3 mro = texture(uMro, vUv).rgb;
  vec2 bump = texture(uNormal, vUv).${format === "astc" ? "ra" : "rg"};
  float cover = uCutoff > 0.0 ? clamp((base.a - uCutoff) / max(fwidth(base.a), 0.0001) + 0.5, 0.0, 1.0) : 1.0;
  if (cover == 0.0) discard;
  o = vec4(shown(lit(dyed(base.rgb, mask, mask2), mro, bumped(bump), -normalize(vRel)), length(vRel)), cover);
}`;
}
