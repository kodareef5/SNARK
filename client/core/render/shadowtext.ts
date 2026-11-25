// The sun's shadow maps as shader text: the depth programs that draw each cascade from the sun, and the lookup the lit
// programs make to know how much of the sun reaches a pixel. Shadows are drawn by WebGL alone (D203, D264): the
// software rasterizer lights everything as if in the sun, and the numbers here are what the lit probe holds the GPU to.
//
// A pixel takes the finest cascade whose sphere holds it, and over the last tenth of that sphere it hands over to the
// next by a 4 by 4 pattern on the screen, so it always makes one lookup. Over the last tenth of the farthest sphere the
// shadow hands over to the far map's (farshadow.ts), which a pixel past every sphere takes alone and one within them takes
// for what lies past the near store's chunks, and it fades with the casting strength of the light that owns the
// cascades: the sun's at dusk, and at night the moon's, which then owns them (sky.ts `castLight`). The lookup is moved off the surface along its normal by up to half a texel, the more
// the more the surface turns from the sun, and is filtered by compared taps after Castaño (The Witness, 2013). A device
// whose compared lookups come back hard compares four texels in the shader for each. The far map is the layer after the
// cascades', looked up with one tap.

import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import type { Tier } from "../assets/tiers.ts";
import { FAR_LEAD, FAR_OUT, FAR_RISE, FAR_SPAN, FLAT_LEAST } from "./farshadow.ts";
import { LAMP_CORNER, LAMP_GROUND, LAMP_LONG, LAMP_NEAREST, LAMP_OUT, LAMP_TAN, LAMP_WIDE } from "./lamp.ts";
import { ORB_SEES_GLSL, ORB_SHADE_GLSL } from "./orb-light.ts";
import { BONES_PER_ROW, MAX_CASCADES } from "./packet.ts";
import { BEND_GLSL, BEND_PLACE } from "./bend.ts";
import { PIECE_FIT_GLSL, PIECE_FIT_PLACE } from "./piece-fit.ts";
import { PIECE_END, PIECE_GLSL, PIECE_PLACE } from "./pieces.ts";

/** Texels of the receiver's cascade the lookup is moved along its normal, at most, where the surface runs along the light. */
export const NORMAL_OFFSET = 0.5;
/**
 * The slope-scaled polygon offset, factor and units, of a caster whose material shows both faces: its sunlit face is
 * stored too. A caster that casts its back faces alone gets none, since its back lies a thickness behind what it lights.
 */
export const POLYGON_OFFSET = [1.5, 2] as const;
/** The share of a cascade's sphere over which a pixel hands over to the next, and over which the farthest hands over to the far map. */
export const EDGE = 0.1;
/**
 * Each tap compares the depth the receiver's own plane has there, not the receiver's depth, so the faces where two
 * pieces meet do not shade the ground past the seam through the filter. The plane is taken from the receiver's normal,
 * its depth rising at most this many texels of depth a texel across (a sun about 7 degrees over a floor), and a
 * filtered tap allows half a texel of that rise besides, for the four texels it blends.
 */
export const SLOPE_MOST = 8;
export const SLOPE_SLACK = 0.5;
/** Steps of a 16-bit depth a compared depth is moved toward the sun, for the map's rounding. */
export const DEPTH_SLACK = 1.5;
/**
 * Texels of the street lamp's map (lamp.ts) a lookup of it is moved along the surface's normal, at most, where the
 * surface runs along the lamp's light; it is moved a texel toward the lens besides.
 */
export const LAMP_OFFSET = 1.5;

/**
 * Compared taps along one axis, for one, two and three taps an axis (1, 4 and 9 a lookup). With `s` the lookup's place
 * past the nearest texel corner, 0 to 1, each tap weighs a + b s and is taken (c + d s) / (a + b s) + e texels from
 * the texel centre before that corner. Each tap is a 2 by 2 filtered lookup, so together they spread the lookup over
 * the texels with the weights `shadowKernel` gives.
 */
export const TAP_AXIS: Readonly<Record<number, readonly (readonly [number, number, number, number, number])[]>> = {
  1: [[1, 0, 0, 1, 0]],
  2: [[3, -2, 2, -1, -1], [1, 2, 0, 1, 1]],
  3: [[4, -3, 3, -2, -2], [7, 0, 3, 1, 0], [1, 3, 0, 1, 2]],
};

/** What a texel `d` texels from the lookup weighs, for `m` taps an axis, out of 1 along that axis. */
export function shadowKernel(m: number, d: number): number {
  const a = Math.abs(d);
  if (m === 1) return Math.max(0, 1 - a);
  if (m === 2) return Math.max(0, 2 - a) / 4;
  return (a <= 1 ? 4 - a : a <= 2 ? 5 - 2 * a : Math.max(0, 3 - a)) / 12;
}

/**
 * What each texel along an axis weighs in a lookup of `m` taps an axis, `s` past the nearest texel corner: out[j] is
 * the texel j - m + 1 from the centre before that corner, as the taps' 2 by 2 lookups share them out.
 */
export function axisWeights(m: number, s: number, out: Float64Array): void {
  const rows = TAP_AXIS[m]!;
  const total = rows.reduce((sum, [a, b]) => sum + a + b * s, 0);
  out.fill(0, 0, 2 * m);
  for (const row of rows) {
    const a = row[0], b = row[1], c = row[2], d = row[3], e = row[4];
    const w = a + b * s;
    const at = (c + d * s) / w + e + m - 1;
    const j = Math.min(Math.floor(at), 2 * m - 2);
    out[j]! += (w * (j + 1 - at)) / total;
    out[j + 1]! += (w * (at - j)) / total;
  }
}

/** The step of the 4 by 4 pattern a pixel hands over to the next cascade by, 0 to 1: Bayer's ordered dither. */
export function handOver(x: number, y: number): number {
  const qx = x & 3, qy = y & 3;
  return ((((qx ^ qy) & 1) * 8 + (qy & 1) * 4 + (((qx ^ qy) >> 1) & 1) * 2 + ((qy >> 1) & 1)) + 0.5) / 16;
}

/**
 * The cascade a camera-relative point takes at pixel (x, y), and how far its shadow has faded, from the frame's spheres
 * (x, y, z, radius each) and how many there are: -1 outside every sphere. The twin of the GLSL's choice.
 */
export function shadowCascade(px: number, py: number, pz: number, spheres: ArrayLike<number>, count: number, x: number, y: number): { cascade: number; fade: number } {
  const share = (i: number): number => Math.hypot(px - spheres[i * 4]!, py - spheres[i * 4 + 1]!, pz - spheres[i * 4 + 2]!) / spheres[i * 4 + 3]!;
  let k = 0;
  let t = count > 0 ? share(0) : 1;
  while (t >= 1 && k + 1 < count) t = share(++k);
  if (t >= 1) return { cascade: -1, fade: 1 };
  if (k + 1 < count && (t - 1 + EDGE) / EDGE > handOver(x, y)) t = share(++k);
  return { cascade: k, fade: k + 1 < count ? 0 : Math.min(1, Math.max(0, (t - 1 + EDGE) / EDGE)) };
}

/**
 * The layers of a tier's shadow array: a cascade's each, the far map's, and on a tier whose street lamp casts
 * (lamp.ts) the lamp's after it; none without cascades.
 */
export function shadowLayers(shadows: Tier["shadows"]): number {
  return shadows.cascades > 0 ? shadows.cascades + 1 + (shadows.lamp ? 1 : 0) : 0;
}

/** The layer the map of bit `k` of a frame's maps (packet.ts `cascadesDrawn`) is drawn into: a cascade's own, or the lamp's after the far map's. */
export const shadowLayer = (k: number, cascades: number): number => (k < MAX_CASCADES ? k : cascades + 1);

/** Bytes a tier's shadow maps hold on the card: a 16-bit layer a cascade, the far map's and the lamp's. */
export function shadowBytes(shadows: Tier["shadows"]): number {
  return shadowLayers(shadows) * shadows.size * shadows.size * 2;
}

/**
 * The lines put before a lit program's texts for a tier's shadows, and with `hard` for a device whose compared lookups
 * do not filter. A lookup runs over the frame's cascades (`uCascades`), up to MAX_CASCADES, so the texts are the same
 * with fewer cascades or none, as the governor's steps and the effects turned off have them, and nothing is compiled
 * again for them. Where the tier's street lamp casts, LAMP: a program that lights by `lit` takes its light (`lights`).
 * ORB_SHADE, an orb's own shadow, unless the tier's shadows say not (`orb`).
 */
export function shadowDefines(shadows: Tier["shadows"], hard: boolean, lights = true): string {
  if (shadows.size <= 0) return "";
  return `#define SHADOW_CASCADES ${MAX_CASCADES}\n#define SHADOW_TAPS ${Math.round(Math.sqrt(shadows.taps))}\n#define SHADOW_SIZE ${shadows.size.toFixed(1)}\n${hard ? "#define SHADOW_HARD\n" : ""}${lights && shadows.lamp ? "#define LAMP\n" : ""}${shadows.orb === false ? "" : "#define ORB_SHADE\n"}`;
}

/** A number as GLSL writes it. */
const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The taps of a lookup of `m` an axis, as GLSL, from TAP_AXIS. */
function filterText(m: number): string {
  if (m === 1) return "  return shadowTap(at.xy, layer, at, slope);\n";
  const rows = TAP_AXIS[m]!;
  const total = rows.reduce((sum, [a, b]) => sum + a + b, 0);
  let text = "  vec2 base = floor(at.xy + 0.5);\n  vec2 s = at.xy + 0.5 - base;\n  base -= 0.5;\n  float sum = 0.0;\n";
  rows.forEach(([a, b, c, d, e], i) => (text += `  vec2 w${i} = ${g(a)} + ${g(b)} * s;\n  vec2 p${i} = (${g(c)} + ${g(d)} * s) / w${i} + ${g(e)};\n`));
  rows.forEach((_, j) => rows.forEach((_, i) => (text += `  sum += w${i}.x * w${j}.y * shadowTap(base + vec2(p${i}.x, p${j}.y), layer, at, slope);\n`)));
  return `${text}  return sum / ${g(total * total)};\n`;
}

/**
 * The lookup, which LIT and SURFACE include after the frame block: `sunShadow(rel, normal)` is how much of the light the
 * cascades are cast from (fCast: the sun by day, the moon by night, which the far map is swept toward too) a
 * camera-relative point with that normal gets, 0 to 1, which `lit` takes as `shade`. Without SHADOW_CASCADES defined it
 * is 1 everywhere and reads no texture. `uCascades` is the frame's cascades, 0 while nothing casts, and the far map's
 * layer. The sun turned away from a surface is kept off it by its own back, whatever its normal map says. Places on the
 * map are in texels, the receiver's `at` with its depth, and `slope` is how its plane's depth rises a texel along each
 * axis. `farShadow` is the twin of farshadow.ts `farLookup`; with fFarScale not over 0 there is no far map and the
 * farthest cascade fades to the sun. The far map's lanes are named whether or not there are cascades, since the sky's
 * openness (skyopen.ts) reads them too. Within the cascades, which the near store's pieces cast into and the far city does not, a
 * pixel is shaded by the far map too, looked up where its ray to the sun leaves the chunks the near store holds
 * (`farBeyond`, farshadow.ts `nearLead`), so the far city's shadows reach near the camera and the near pieces' are not
 * cast twice. With LAMP, `sunShadow` first finds how much of the street lamp's light reaches the point (`lampSees`, the
 * twin of lamp.ts `lampReach` but for the shadow): by its pool, distance and facing, and by four compared taps of the
 * lamp's map in its corner of its layer, moved off the surface as the cascades' are; LIGHT's `lit` adds it from gLamp.
 * With ORB_LIGHT it finds an orb's light too, shadows or none (orb-light.ts), which `lit` adds from gOrb. The maps'
 * share is `mapShadow`; with ORB_SHADE the share an orb's own shadow leaves is taken of it (orb-light.ts `orbShade`),
 * whether or not the frame has cascades.
 */
export const SHADOW_GLSL = `${ORB_SEES_GLSL}${ORB_SHADE_GLSL}#define fFarAt fSwell.zw
#define fFarScale fLook.w
#define fFarDepth fSkyAlong.w
#ifdef SHADOW_CASCADES
uniform highp sampler2DArrayShadow uShadow;
uniform int uCascades;
float shadowTexel(vec2 t, float layer, vec3 at, vec2 slope, float slack) {
  return texture(uShadow, vec4(t / SHADOW_SIZE, layer, at.z + dot(slope, t - at.xy) - slack));
}
float shadowTap(vec2 t, float layer, vec3 at, vec2 slope) {
#ifdef SHADOW_HARD
  vec2 c = floor(t - 0.5) + 0.5;
  vec2 f = t - c;
  float a = mix(shadowTexel(c, layer, at, slope, 0.0), shadowTexel(c + vec2(1.0, 0.0), layer, at, slope, 0.0), f.x);
  float b = mix(shadowTexel(c + vec2(0.0, 1.0), layer, at, slope, 0.0), shadowTexel(c + vec2(1.0), layer, at, slope, 0.0), f.x);
  return mix(a, b, f.y);
#else
  return shadowTexel(t, layer, at, slope, ${g(SLOPE_SLACK)} * (abs(slope.x) + abs(slope.y)));
#endif
}
float shadowFilter(vec3 at, vec2 slope, float layer) {
#if SHADOW_TAPS == 1
${filterText(1)}#elif SHADOW_TAPS == 2
${filterText(2)}#else
${filterText(3)}#endif
}
float shadowShare(vec3 rel, int i) {
  return length(rel - fSpheres[i].xyz) / fSpheres[i].w;
}
float farShadow(vec3 rel, vec3 normal) {
  if (fFarScale <= 0.0) return 1.0;
  vec3 sun = fCast.xyz;
  vec3 p = rel + vec3(normal.x, 0.0, normal.z) * (${g(FAR_OUT)} / fFarScale) + sun * (${g(FAR_LEAD)} / (fFarScale * max(length(sun.xz), ${g(FLAT_LEAST)})));
  vec2 t = p.xz * fFarScale + fFarAt;
  return shadowTap(t, float(uCascades), vec3(t, fFarDepth - (p.y + ${g(FAR_RISE)}) / ${g(FAR_SPAN)}), vec2(0.0));
}
#define fNearFrom vec2(fMoon.w, fMoonColor.w)
#define fNearTo vec2(fSkyBelow.w, fCloudSun.w)
float farBeyond(vec3 rel, vec3 normal) {
  if (fFarScale <= 0.0) return 1.0;
  float ground = max(length(fCast.xz), ${g(FLAT_LEAST)});
  vec2 d = fCast.xz / ground;
  d = vec2(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.y) < 1e-6 ? 1e-6 : d.y);
  vec2 a = (fNearFrom - rel.xz) / d, b = (fNearTo - rel.xz) / d;
  vec2 lo = min(a, b), hi = max(a, b);
  float leave = min(hi.x, hi.y);
  float lead = fNearFrom.x <= fNearTo.x && leave >= max(max(lo.x, lo.y), 0.0) ? leave : 0.0;
  return farShadow(rel + fCast.xyz * (lead / ground), normal);
}
#ifdef LAMP
float lampFilter(vec3 at, float layer) {
  vec2 slope = vec2(0.0);
${filterText(2)}}
void lampSees(vec3 rel, vec3 normal) {
  gLamp = vec4(0.0);
  if (fLamp.w <= 0.0) return;
  vec3 d = fLamp.xyz - rel;
  float far = dot(d, d);
  if (far >= fLamp.w * fLamp.w || d.y <= 0.0) return;
  vec2 o = d.xz * (${g(-LAMP_GROUND)} / d.y);
  float ahead = dot(o, fLampWay.xy);
  float q = (ahead - ${g(LAMP_OUT)}) * (ahead - ${g(LAMP_OUT)}) / ${g(LAMP_WIDE * LAMP_WIDE)} + (dot(o, o) - ahead * ahead) / ${g(LAMP_LONG * LAMP_LONG)};
  if (q >= 1.0) return;
  float t = sqrt(q);
  float pool = 1.0 - t * t * (3.0 - 2.0 * t);
  vec3 l = d * inversesqrt(far);
  float w = 1.0 - far * far / (fLamp.w * fLamp.w * fLamp.w * fLamp.w);
  float facing = dot(normal, l);
  float deep = max(d.y, ${g(LAMP_NEAREST)});
  float reach = pool * pool * w * w * sqrt(far) / (deep * deep * deep) * clamp(facing * 20.0, 0.0, 1.0);
  if (reach <= 0.0) return;
  if (fLampColor.w >= 0.0) {
    float texel = ${g((2 * LAMP_TAN) / LAMP_CORNER)} * d.y / SHADOW_SIZE;
    vec3 p = rel + normal * (${g(LAMP_OFFSET)} * texel * sqrt(max(1.0 - facing * facing, 0.0))) + l * texel;
    vec4 c = fLampShadow * vec4(p, 1.0);
    vec3 at = c.xyz / c.w * 0.5 + 0.5;
    at.xy *= SHADOW_SIZE;
    at.z -= ${g(DEPTH_SLACK)} / 65535.0;
    reach *= lampFilter(at, fLampColor.w);
  }
  gLamp = vec4(l, reach);
}
#endif
float mapShadow(vec3 rel, vec3 normal) {
  if (uCascades == 0 || fCast.w <= 0.0) return 1.0;
  int k = 0;
  float t = shadowShare(rel, 0);
  for (int i = 1; i < SHADOW_CASCADES; i++) {
    if (t < 1.0 || i >= uCascades) break;
    k = i;
    t = shadowShare(rel, i);
  }
  float facing = dot(normal, fCast.xyz);
  if (t >= 1.0) return fFarScale > 0.0 ? mix(1.0, farShadow(rel, normal) * clamp(facing * 20.0, 0.0, 1.0), fCast.w) : 1.0;
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  int order = ((q.x ^ q.y) & 1) * 8 + (q.y & 1) * 4 + (((q.x ^ q.y) >> 1) & 1) * 2 + ((q.y >> 1) & 1);
  if (k + 1 < uCascades && (t - ${g(1 - EDGE)}) / ${g(EDGE)} > (float(order) + 0.5) / 16.0) {
    k++;
    t = shadowShare(rel, k);
  }
  float fade = k + 1 < uCascades ? 0.0 : clamp((t - ${g(1 - EDGE)}) / ${g(EDGE)}, 0.0, 1.0);
  float scale = length(fCascades[k][0].xyz);
  vec3 p = rel + normal * (${g(2 * NORMAL_OFFSET)} / (SHADOW_SIZE * scale) * sqrt(max(1.0 - facing * facing, 0.0)));
  vec3 at = (fCascades[k] * vec4(p, 1.0)).xyz * 0.5 + 0.5;
  at.xy *= SHADOW_SIZE;
  at.z -= ${g(DEPTH_SLACK)} / 65535.0;
  vec2 slope = clamp((mat3(fCascades[k]) * normal).xy / (scale * max(facing, 0.05)), -${g(SLOPE_MOST)}, ${g(SLOPE_MOST)}) / SHADOW_SIZE;
  float sun = mix(shadowFilter(at, slope, float(k)) * farBeyond(rel, normal), fade > 0.0 ? farShadow(rel, normal) : 1.0, fade) * clamp(facing * 20.0, 0.0, 1.0);
  return mix(1.0, sun, fCast.w);
}
float sunShadow(vec3 rel, vec3 normal) {
#ifdef LAMP
  lampSees(rel, normal);
#endif
#ifdef ORB_LIGHT
  orbSees(rel, normal);
#endif
#ifdef ORB_SHADE
  return mapShadow(rel, normal) * orbShade(rel);
#else
  return mapShadow(rel, normal);
#endif
}
#else
float sunShadow(vec3 rel, vec3 normal) {
#ifdef ORB_LIGHT
  orbSees(rel, normal);
#endif
  return 1.0;
}
#endif
`;

/**
 * A vertex text drawn into a depth map with what lies sunward of its near face flattened onto it, since WebGL2 has no
 * depth clamp. The depth programs for the ground are the view's own vertex texts made so, which keeps them on the
 * very heights the view draws.
 */
export function clampDepth(vertex: string): string {
  const at = vertex.lastIndexOf("\n}");
  return `${vertex.slice(0, at)}\n  gl_Position.z = max(gl_Position.z, -gl_Position.w);${vertex.slice(at)}`;
}

/**
 * DEPTH: a caster placed as the view places a draw, by `uSkin` (surface.ts skinMode) from the same attributes, and its
 * texture coordinates for a cut-out caster.
 */
export const DEPTH_VERTEX = clampDepth(`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=5) in uvec2 iRegB;
layout(location=6) in uint aBone;
layout(location=7) in vec2 aUv;
layout(location=10) in uvec4 aBones;
layout(location=11) in vec4 aWeights;
uniform mat4 uViewProj;
uniform vec3 uOffset, uCenter, uHalf;
uniform vec4 uUv;
uniform float uSkin;
uniform highp sampler2D uBones;
out vec2 vUv;
mat3x4 bone(int i) {
  int n = i * 3;
  ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
  return mat3x4(texelFetch(uBones, at, 0), texelFetch(uBones, at + ivec2(1, 0), 0), texelFetch(uBones, at + ivec2(2, 0), 0));
}
${BEND_GLSL}${PIECE_GLSL}${PIECE_FIT_GLSL}void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
${PIECE_PLACE}  if (uSkin > 0.5) {
    int first = int(iYaw * 65535.0 + 0.5);
    mat3x4 m;
    if (uSkin > 2.5) m = bone(first + int(aBones.x)) * aWeights.x + bone(first + int(aBones.y)) * aWeights.y + bone(first + int(aBones.z)) * aWeights.z + bone(first + int(aBones.w)) * aWeights.w;
    else m = bone(first + (uSkin > 1.5 ? 0 : int(aBone)));
    vec4 v = vec4(l + iPos, 1.0);
    // Standing in a pose: first its bone of that pose, whose first bone is uOffset.x, about the body's origin.
    if (uSkin > 1.5 && uSkin < 2.5) v = vec4(v * bone(int(uOffset.x) + int(aBone)), 1.0);
    p = v * m;
  } else {
    float a = iYaw * 6.283185307;
    float s = sin(a), c = cos(a);
    if (uSkin < -0.5 && uSkin > -1.5) l *= float(iRegB.y) / ${g(SIZE_UNITS)};
${BEND_PLACE}${PIECE_FIT_PLACE}    p = vec3(c * l.x + s * l.z, l.y, c * l.z - s * l.x) + iPos + uOffset;
  }
  vUv = uUv.xy + aUv * uUv.zw;
  gl_Position = uViewProj * vec4(p, 1.0);
${PIECE_END}}`);

/** What a depth pass writes beside depth: nothing. */
export const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
void main() {}`;

/** A cut-out caster leaves out where its base colour's alpha is under the material's cutoff, tested at the pixel's middle. */
export const DEPTH_CUTOUT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uBase;
uniform float uCutoff;
void main() {
  if (texture(uBase, vUv).a < uCutoff) discard;
}`;
