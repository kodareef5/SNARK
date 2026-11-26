// How a screen on a prop is drawn (packet.ts DRAW_SCREENS, screens.ts): one quad on its face, its picture a layer of the
// faces' array on UNIT.faces. An LED face is a grid of dots, each showing the picture at its own middle, as the orb's
// pucks do, and changes picture by a line that sweeps down it; a TV or a laptop glows plain and fades between pictures;
// a tube has scanlines. A picture fitted whole has dark bars past its edges. Far off, where its picture's texels are
// much finer than a pixel, a face fades to the picture's mean colour. Its white follows exposure as the orb's does
// (screen-level.ts). `faceLight` is the program's twin.

import { srgbToLinear } from "./color-space.ts";
import { FACE, FACE_CRT, FACE_HIGH, FACE_LED, FACE_TOP, FACE_TOP_BEFORE, FACE_WIDE, FRAME_BLOCK } from "./packet.ts";
import { GRADED, TONE } from "./surface.ts";

/** Metres between an LED face's dots, and a dot's radius as a share of that. */
export const LED_PITCH = 0.08;
export const LED_FILL = 0.44;
/** Pixels a dot spans under which the grid is not drawn, and from which it is drawn in full. */
export const LED_FROM = 1.5;
export const LED_TO = 3;
/** What the dark panel between dots gives back of the day's light, as light after exposure. */
export const LED_TRELLIS = 0.05;
/** How much brighter a dot is than the plain picture, so near and far are as bright: the grid's cell over the dot's disc. */
const LED_GAIN = 1 / (Math.PI * LED_FILL * LED_FILL);
/** The level of the picture's texels from which a face fades to its mean colour, and at which it is that colour alone. */
export const FAR_FROM = 4;
export const FAR_TO = 5.5;
/** A tube's lines from top to bottom, and how dark the gaps between them are. */
export const CRT_LINES = 240;
export const CRT_DEPTH = 0.35;

const g = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));

export const FACE_VERTEX = `#version 300 es
layout(location=0) in vec3 iCorner;
layout(location=1) in vec3 iAcross;
layout(location=2) in vec3 iUp;
layout(location=3) in vec4 iCrop;
layout(location=4) in vec4 iCropBefore;
layout(location=5) in vec4 iShow;
layout(location=6) in uvec3 iWords;
uniform mat4 uViewProj;
out vec3 vRel;
out vec2 vUv;
flat out vec4 vCrop, vCropBefore, vShow;
flat out vec3 vMean, vMeanBefore, vNormal;
flat out vec2 vSize;
flat out uint vFlags;
vec3 linearOf(uint w) {
  vec3 c = vec3(float(w & 255u), float((w >> 8) & 255u), float((w >> 16) & 255u)) / 255.;
  return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c));
}
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec3 p = iCorner + c.x * iAcross + c.y * iUp;
  vRel = p;
  vUv = c;
  vCrop = iCrop;
  vCropBefore = iCropBefore;
  vShow = iShow;
  vMean = linearOf(iWords.y);
  vMeanBefore = linearOf(iWords.z);
  vNormal = normalize(cross(iAcross, iUp));
  vSize = vec2(length(iAcross), length(iUp));
  vFlags = iWords.x;
  gl_Position = uViewProj * vec4(p, 1.);
}`;

export const FACE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 vRel;
in vec2 vUv;
flat in vec4 vCrop, vCropBefore, vShow;
flat in vec3 vMean, vMeanBefore, vNormal;
flat in vec2 vSize;
flat in uint vFlags;
uniform highp sampler2DArray uFaces;
out vec4 o;
${FRAME_BLOCK}${TONE}${GRADED}
vec3 facePicture(float layer, vec4 crop, vec3 mean, vec2 uv, float metres, float top) {
  float lod = log2(max(metres * max(${g(FACE_WIDE)} * crop.x / vSize.x, ${g(FACE_HIGH)} * crop.y / vSize.y), 1.e-6));
  float far = smoothstep(${g(FAR_FROM)}, ${g(FAR_TO)}, lod);
  vec2 at = crop.zw + vec2(uv.x, 1. - uv.y) * crop.xy;
  if (any(lessThan(at, vec2(0.))) || any(greaterThan(at, vec2(1.)))) return vec3(0.);
  if (layer < 0. || far >= 1.) return mean;
  vec3 pic = textureLod(uFaces, vec3(at, layer), clamp(lod, 0., top)).rgb;
  return mix(pic, mean, far);
}
void main() {
  float metres = length(fwidth(vRel)), fp = metres, show = 0., cover = 1.;
  vec2 uv = vUv;
  bool led = (vFlags & ${FACE_LED}u) != 0u;
  if (led) {
    show = smoothstep(${g(LED_FROM)}, ${g(LED_TO)}, ${g(LED_PITCH)} / max(metres, 1.e-5));
    if (show > 0.) {
      vec2 dots = max(floor(vSize / ${g(LED_PITCH)} + .5), 1.);
      vec2 cell = (floor(uv * dots) + .5) / dots;
      float off = length((uv - cell) * vSize) / ${g(LED_PITCH)};
      uv = cell;
      fp = max(metres, ${g(LED_PITCH)});
      cover = 1. - smoothstep(${g(LED_FILL)} - max(.06, metres / ${g(LED_PITCH)}), ${g(LED_FILL)} + max(.06, metres / ${g(LED_PITCH)}), off);
    }
  }
  vec3 now = facePicture(vShow.x, vCrop, vMean, uv, fp, float((vFlags >> ${FACE_TOP}u) & 15u));
  vec3 col = now;
  if (vShow.z < 1.) {
    vec3 before = facePicture(vShow.y, vCropBefore, vMeanBefore, uv, fp, float((vFlags >> ${FACE_TOP_BEFORE}u) & 15u));
    if (led) {
      float front = vShow.z * 1.1 - .05, at = 1. - uv.y, e = (at - front) / max(.012, fp / vSize.y);
      col = (at < front ? now : before) + vec3(.75, .9, 1.) * exp(-e * e);
    } else col = mix(before, now, vShow.z);
  }
  if ((vFlags & ${FACE_CRT}u) != 0u) {
    float lines = metres / vSize.y * ${g(CRT_LINES)};
    col *= mix(1. - ${g(CRT_DEPTH)} * (.5 - .5 * cos(6.2831853 * uv.y * ${g(CRT_LINES)})), 1. - .5 * ${g(CRT_DEPTH)}, smoothstep(.5, 1., lines));
  }
  vec3 light = col * vShow.w;
  vec3 sun = fSun.xyz;
  light = mix(light, light * cover * ${g(LED_GAIN)} + ${g(LED_TRELLIS)} * smoothstep(-.1, .1, sun.y) * (.3 + .7 * max(dot(vNormal, sun), 0.)) * (1. - cover), show);
#ifdef LIGHT_TARGET
  o = vec4(light, 1.);
#else
  o = vec4(encoded(clamp(fFinish.x > 0. ? graded(tone(light * fGrade.rgb)) : tone(light), 0., 1.)), 1.);
#endif
}`;

// ---- The twin.

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Reads layer `layer` of the faces' array at (s, t) and level `lod` into `out`, as linear light: what UNIT.faces holds. */
export type FaceRead = (layer: number, s: number, t: number, lod: number, out: number[]) => void;

/** A face's place in its quad and its sides, in metres, as the vertex text hands them on. */
export interface FacePoint {
  /** Across and up the face, 0 to 1 from its bottom left. */
  u: number;
  v: number;
  /** Metres a pixel spans there. */
  metres: number;
}

const mean = [0, 0, 0], before = [0, 0, 0], picked = [0, 0, 0];

/** sRGB bytes of a word, as the vertex text reads them, into `out` as linear light. */
export function wordColour(w: number, out: number[]): void {
  out[0] = srgbToLinear((w & 255) / 255);
  out[1] = srgbToLinear(((w >>> 8) & 255) / 255);
  out[2] = srgbToLinear(((w >>> 16) & 255) / 255);
}

/** The picture of layer `layer`, cropped by `crop` (s and t scale, then offset, from `at`), at (u, v): the twin of `facePicture`. */
function picture(f: ArrayLike<number>, layer: number, crop: number, meanOf: number[], u: number, v: number, metres: number, wide: number, high: number, top: number, read: FaceRead | null, out: number[]): void {
  const lod = Math.log2(Math.max(metres * Math.max((FACE_WIDE * f[crop]!) / wide, (FACE_HIGH * f[crop + 1]!) / high), 1e-6));
  const far = sstep(FAR_FROM, FAR_TO, lod);
  const s = f[crop + 2]! + u * f[crop]!, t = f[crop + 3]! + (1 - v) * f[crop + 1]!;
  // Past a fitted picture's edges are its bars.
  const bars = s < 0 || s > 1 || t < 0 || t > 1;
  if (bars || layer < 0 || far >= 1 || !read) {
    for (let c = 0; c < 3; c++) out[c] = bars ? 0 : meanOf[c]!;
    return;
  }
  read(layer, s, t, Math.max(0, Math.min(top, lod)), picked);
  for (let c = 0; c < 3; c++) out[c] = picked[c]! + (meanOf[c]! - picked[c]!) * far;
}

/**
 * The light of the face `f` (FACE_FLOATS floats, its words in `w`, both from `at`) at point `p`, into `out` as light
 * after exposure: the twin of the fragment text's `main`. `sun` is the way to the sun.
 */
export function faceLight(f: ArrayLike<number>, w: ArrayLike<number>, at: number, p: FacePoint, sun: ArrayLike<number>, read: FaceRead | null, out: number[]): void {
  const ax = f[at + FACE.across]!, ay = f[at + FACE.across + 1]!, az = f[at + FACE.across + 2]!;
  const ux = f[at + FACE.up]!, uy = f[at + FACE.up + 1]!, uz = f[at + FACE.up + 2]!;
  const wide = Math.hypot(ax, ay, az), high = Math.hypot(ux, uy, uz);
  const flags = w[at + FACE.flags]!, led = (flags & FACE_LED) !== 0;
  let u = p.u, v = p.v, fp = p.metres, show = 0, cover = 1;
  if (led) {
    show = sstep(LED_FROM, LED_TO, LED_PITCH / Math.max(p.metres, 1e-5));
    if (show > 0) {
      const dx = Math.max(Math.floor(wide / LED_PITCH + 0.5), 1), dy = Math.max(Math.floor(high / LED_PITCH + 0.5), 1);
      const cu = (Math.floor(u * dx) + 0.5) / dx, cv = (Math.floor(v * dy) + 0.5) / dy;
      const off = Math.hypot((u - cu) * wide, (v - cv) * high) / LED_PITCH, h = Math.max(0.06, p.metres / LED_PITCH);
      u = cu;
      v = cv;
      fp = Math.max(p.metres, LED_PITCH);
      cover = 1 - sstep(LED_FILL - h, LED_FILL + h, off);
    }
  }
  wordColour(w[at + FACE.mean]!, mean);
  picture(f, f[at + FACE.layer]!, at + FACE.crop, mean, u, v, fp, wide, high, (flags >>> FACE_TOP) & 15, read, out);
  const wipe = f[at + FACE.wipe]!;
  if (wipe < 1) {
    wordColour(w[at + FACE.meanBefore]!, before);
    picture(f, f[at + FACE.before]!, at + FACE.cropBefore, before, u, v, fp, wide, high, (flags >>> FACE_TOP_BEFORE) & 15, read, picked);
    if (led) {
      const front = wipe * 1.1 - 0.05, down = 1 - v, e = (down - front) / Math.max(0.012, fp / high), lead = Math.exp(-e * e);
      if (down >= front) for (let c = 0; c < 3; c++) out[c] = picked[c]!;
      out[0]! += 0.75 * lead;
      out[1]! += 0.9 * lead;
      out[2]! += lead;
    } else for (let c = 0; c < 3; c++) out[c] = picked[c]! + (out[c]! - picked[c]!) * wipe;
  }
  if ((flags & FACE_CRT) !== 0) {
    const lines = (p.metres / high) * CRT_LINES;
    const scan = 1 - CRT_DEPTH * (0.5 - 0.5 * Math.cos(2 * Math.PI * v * CRT_LINES)), k = scan + (1 - 0.5 * CRT_DEPTH - scan) * sstep(0.5, 1, lines);
    for (let c = 0; c < 3; c++) out[c]! *= k;
  }
  const bright = f[at + FACE.bright]!;
  const nx = ay * uz - az * uy, ny = az * ux - ax * uz, nz = ax * uy - ay * ux, nl = Math.hypot(nx, ny, nz) || 1;
  const lit = LED_TRELLIS * sstep(-0.1, 0.1, sun[1]!) * (0.3 + 0.7 * Math.max((nx * sun[0]! + ny * sun[1]! + nz * sun[2]!) / nl, 0));
  for (let c = 0; c < 3; c++) {
    const light = out[c]! * bright;
    out[c] = light + (light * cover * LED_GAIN + lit * (1 - cover) - light) * show;
  }
}
