// What a frame's finishing pass is told. On a tier with a light target (Tier.post) the scene is drawn as light, exposed
// but not toned, into a multisampled float target of the shell's, which is resolved and finished in one pass: bloom,
// the tone curve, the grade, a slight sharpen and dither. Any other tier, or a device with no such target, draws as
// medium always has, each shader toning its own light onto the canvas.
//
// Bloom spreads what is truly bright: the part of a pixel's light past BLOOM_FROM, which grows from nothing there, so
// no line is drawn where it starts. It is a chain of targets, each half the one before from a quarter of the canvas
// down: the first level takes that part of the scene, each after it the level above filtered down with thirteen taps, then from
// the smallest up each is filtered up with a tent and added to the one above. The first level then holds every level's
// blur of the same light, and over their count is a blur that keeps its energy. The finish takes BLOOM of the bright
// part from where it is and puts the same share of the blur in its place, so light is moved and none is made.

import { GRADE, type GradeKey } from "../../../content/grade.ts";
import type { Tier } from "../assets/tiers.ts";
import { FRAME, FRAME_BLOCK } from "./packet.ts";
import { sunHeight } from "./sky.ts";
import { GRADED, TONE } from "./surface.ts";

/**
 * The light target's formats, best first: RGBA16F, then R11F_G11F_B10F, each where EXT_color_buffer_float makes it
 * drawable and the device can multisample it. A device with neither draws as medium does.
 */
export const LIGHT_FORMATS: readonly number[] = [0x881a, 0x8c3a];
/**
 * The samples the light target is drawn with, as the canvas's own antialiasing is, or as many as the device has under
 * that; none on a canvas drawn at more pixels than the screen's own (ultra's), whose supersample is its antialiasing.
 */
export const LIGHT_SAMPLES = 4;
export const lightSamples = (supersampled: boolean): number => (supersampled ? 0 : LIGHT_SAMPLES);
/**
 * Bloom's levels are R11F_G11F_B10F, half the bytes of the scene's float, and the first is a quarter of the canvas a
 * side (BLOOM_START halvings), read from the scene by its thirteen taps at the spacing of a half-size picture's texels.
 */
export const BLOOM_FORMAT = 0x8c3a;
const BLOOM_START = 2;
/** Halvings a side of level `k`'s target from the canvas: none for the scene (0), BLOOM_START for the first level. */
export const levelShift = (k: number): number => (k > 0 ? k + BLOOM_START - 1 : 0);
/** Halvings a side of the texels a pass from level `from` into level `to` (the canvas for -1) spaces its taps by. */
export const tapShift = (from: number, to: number): number => (from === 0 && to > 0 ? 1 : levelShift(from));
/**
 * Light after exposure past which bloom takes it (a sunlit white wall in the open is about 1.5, the sun's disc 24), the
 * share of it bloom moves, the sharpen's strength, and the fewest pixels tall bloom's smallest level is.
 */
export const BLOOM_FROM = 2;
export const BLOOM = 0.3;
export const SHARPEN = 0.25;
const SMALLEST = 16;
/** Bloom's levels at most: the smallest is 1 / 256 of the canvas, which at 4,320 pixels tall is the SMALLEST's 16. */
const MOST_LEVELS = 7;
/** The brightest light bloom takes, after exposure: the sun's disc is 24. */
const BRIGHTEST = 256;

/**
 * Bytes the light target takes on the card for a canvas `width` by `height` drawn with `samples` (Tier.post), in its
 * larger format: each sample's colour and depth, the resolved scene (with depth of its own where there are no samples),
 * and bloom's levels, a fifteenth of a pixel of four bytes. On ultra's canvas, held to 5,120 by 2,880 and drawn with no
 * samples, that is 181 MB at most; on high at 1,440p, with four, 207 MB.
 */
export const lightBytes = (width: number, height: number, samples: number): number => Math.ceil(width * height * ((samples > 0 ? samples * 12 + 8 : 12) + 4 / 15));

/** Whether a frame of `tier` is drawn into the light target, on a device whose target's format is `light` (0 for none). */
export const drawsLight = (tier: Tier, light: number | boolean): boolean => tier.post !== null && light !== 0 && light !== false;

/** Bloom's levels on a canvas `height` pixels tall, `share` of them kept (Tier.post): the smallest no fewer than SMALLEST tall. */
export function bloomLevels(height: number, share: number): number {
  const all = Math.min(MOST_LEVELS, Math.max(1, Math.floor(Math.log2(height / SMALLEST)) - BLOOM_START + 1));
  return share <= 0 ? 0 : Math.max(1, Math.round(all * share));
}

/** The grade at a sun height (content/grade.ts), each number blended between the keys either side. */
export function gradeAt(height: number): GradeKey {
  const at = GRADE.findIndex((k) => k.sun >= height);
  if (at <= 0) return GRADE[at < 0 ? GRADE.length - 1 : 0]!;
  const [a, b] = [GRADE[at - 1]!, GRADE[at]!];
  const t = (height - a.sun) / (b.sun - a.sun);
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return { sun: height, gain: [mix(a.gain[0], b.gain[0]), mix(a.gain[1], b.gain[1]), mix(a.gain[2], b.gain[2])], saturation: mix(a.saturation, b.saturation), gamma: mix(a.gamma, b.gamma) };
}

/** Fills the frame block's finish (packet.ts fGrade, fFinish) for a frame of `tier` at `hour` on a canvas `height` pixels tall: none without a light target. */
export function postFrame(frame: Float32Array, tier: Tier, hour: number, height: number): void {
  frame.fill(0, FRAME.grade, FRAME.levels + 1);
  if (!tier.post) return;
  const k = gradeAt(sunHeight(hour));
  frame.set(k.gain, FRAME.grade);
  frame[FRAME.saturation] = k.saturation;
  frame[FRAME.gamma] = k.gamma;
  frame[FRAME.bloom] = BLOOM;
  frame[FRAME.sharpen] = SHARPEN;
  frame[FRAME.levels] = bloomLevels(height, tier.post.bloom);
}

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The part of light `c` past BLOOM_FROM in its brightest channel, the hue kept: the light bloom moves. */
const BRIGHT = `vec3 bright(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  return c * (max(peak - ${f(BLOOM_FROM)}, 0.0) / max(peak, 1e-4));
}
`;

/** One triangle over the target, and where each pixel is on it, 0 to 1. */
export const POST_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vUv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

/** What a step of the chain reads: its source on its unit, and `uPass`, a texel of the source across and down, then 1 on the first level. */
const READ = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec4 uPass;
in vec2 vUv;
out vec4 o;
vec3 at(float x, float y) {
  return texture(uSource, vUv + vec2(x, y) * uPass.xy).rgb;
}
`;

/**
 * A level from the one above it, twice its size: thirteen taps, in five groups of four. On the first level, read from
 * the scene, it takes the bright part of each tap, and each group counts as one over one plus its brightness, so that a
 * pixel far brighter than those round it, a glint, does not flicker as a block of bloom; light past BRIGHTEST is held there.
 */
export const BLOOM_DOWN = `${READ}${BRIGHT}vec4 group(vec3 a, vec3 b, vec3 c, vec3 d, float w) {
  vec3 m = (a + b + c + d) * 0.25;
  if (uPass.z > 0.5) {
    m = min((bright(a) + bright(b) + bright(c) + bright(d)) * 0.25, vec3(${f(BRIGHTEST)}));
    w /= 1.0 + dot(m, vec3(0.2126, 0.7152, 0.0722));
  }
  return vec4(m * w, w);
}
void main() {
  vec3 a = at(-2.0, 2.0), b = at(0.0, 2.0), c = at(2.0, 2.0), d = at(-2.0, 0.0), e = at(0.0, 0.0), f = at(2.0, 0.0), g = at(-2.0, -2.0), h = at(0.0, -2.0), i = at(2.0, -2.0);
  vec4 s = group(at(-1.0, 1.0), at(1.0, 1.0), at(-1.0, -1.0), at(1.0, -1.0), 0.5) + group(a, b, d, e, 0.125) + group(b, c, e, f, 0.125) + group(d, e, g, h, 0.125) + group(e, f, h, i, 0.125);
  o = vec4(s.rgb / s.w, 1.0);
}`;

/** A level from the one below it, half its size, by a tent of three by three of the smaller's texels, added to what the level holds. */
export const BLOOM_UP = `${READ}void main() {
  vec3 s = at(-1.0, 1.0) + at(1.0, 1.0) + at(-1.0, -1.0) + at(1.0, -1.0) + 2.0 * (at(0.0, 1.0) + at(-1.0, 0.0) + at(1.0, 0.0) + at(0.0, -1.0)) + 4.0 * at(0.0, 0.0);
  o = vec4(s / 16.0, 1.0);
}`;

/**
 * The finish, into the canvas: the scene resolved, fFinish's share of its bright part taken away and the same share of
 * bloom's first level, over its levels' count, put back; the light taken by fGrade's gain and through the tone curve,
 * then graded; the sharpen, the pixel's toned
 * brightness pushed from the mean of its four neighbours' by fFinish's strength and held within theirs, which takes it
 * nowhere on a smooth surface; then shown, with a step of dither each way against banding in the sky. `uPass` is a
 * texel of the scene.
 */
export const FINISH = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom;
uniform vec4 uPass;
in vec2 vUv;
out vec4 o;
${FRAME_BLOCK}${TONE}${GRADED}${BRIGHT}float toned(vec2 at) {
  return dot(tone(texture(uScene, vUv + at * uPass.xy).rgb * fGrade.rgb), vec3(0.2126, 0.7152, 0.0722));
}
float hash(uvec3 v) {
  uint h = v.x * 1664525u + v.y * 22695477u + v.z * 2654435761u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  if (fFinish.w > 0.0) c += fFinish.y * (texture(uBloom, vUv).rgb / fFinish.w - bright(c));
  vec3 t = tone(c * fGrade.rgb);
  float l = toned(vec2(0.0)), n = toned(vec2(1.0, 0.0)), s = toned(vec2(-1.0, 0.0)), e = toned(vec2(0.0, 1.0)), w = toned(vec2(0.0, -1.0));
  float sharp = clamp(l + fFinish.z * (l - 0.25 * (n + s + e + w)), min(l, min(min(n, s), min(e, w))), max(l, max(max(n, s), max(e, w))));
  t = graded(t * (l > 0.0 ? sharp / l : 1.0));
  uvec3 at = uvec3(gl_FragCoord.xy, 0u);
  o = vec4(encoded(clamp(t, 0.0, 1.0)) + (hash(at) + hash(at + uvec3(0u, 0u, 1u)) - 1.0) / 255.0, 1.0);
}`;
