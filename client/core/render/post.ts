// What a frame's finishing pass is told, and the grade every lit tier takes. Each lit shader shows its light through
// the grade's gain, the tone curve and the grade's saturation and gamma, by the sun's height (content/grade.ts). On a
// tier with a light target (Tier.post) the scene is drawn as light instead, exposed but not toned, into a multisampled
// float target of the shell's, which is resolved and finished in one pass for what needs a pass: bloom, then the same
// gain, tone curve and grade over light that bloom has moved, a slight sharpen and dither. The governor gives the
// scene's pixels first and the target near its last step (governor.ts), and without it the frame keeps its grade.
//
// Bloom spreads what is truly bright: the part of a pixel's light past BLOOM_FROM, which grows from nothing there, so
// no line is drawn where it starts. It is a chain of targets, each half the one before from a quarter of the canvas
// down: the first level takes that part of the scene, each after it the level above filtered down with thirteen taps, then from
// the smallest up each is filtered up with a tent and added to the one above. The first level then holds every level's
// blur of the same light, and over their count is a blur that keeps its energy. The finish takes BLOOM of the bright
// part from where it is and puts the same share of the blur in its place, so light is moved and none is made.
//
// The scene may be drawn at a share of the canvas a side (sceneShare): into the corner of the light target that share
// fills, bloom's levels likewise, and the finish, at the canvas's own size, takes it up with a Catmull-Rom filter held
// within its neighbours, then the sharpen. The interface is the page's, over the canvas, and keeps its own pixels.

import { GRADE, type GradeKey } from "../../../content/grade.ts";
import type { Tier } from "../assets/tiers.ts";
import { FRAME, FRAME_BLOCK, OPTIC_AT, OPTIC_NIGHT } from "./packet.ts";
import { sunHeight } from "./sky.ts";
import { GRADED, TONE } from "./surface.ts";

/**
 * The light target's formats, best first: RGBA16F, then R11F_G11F_B10F, each where EXT_color_buffer_float makes it
 * drawable and the device can multisample it. A device with neither draws as medium does.
 */
export const LIGHT_FORMATS: readonly number[] = [0x881a, 0x8c3a];
/**
 * The samples the light target is drawn with, or as many as the device has under that; none on a canvas drawn at more
 * pixels than the screen's own, whose supersample is its antialiasing. Two: at play distance palm fronds, rails, a
 * tower's edge on the sky and far rooflines show as with four, and the frame on an M5 is about a millisecond quicker.
 */
export const LIGHT_SAMPLES = 2;
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
/**
 * The sharpen of a scene taken up from fewer pixels, more by as much as 0.3 at three quarters a side and under: it
 * gives back a little of a leaf's or a letter's edge, held within the neighbours' light, so nothing rings.
 */
const UPSCALED_SHARPEN = 0.3;
export const sharpenAt = (share: number): number => SHARPEN + UPSCALED_SHARPEN * Math.min(1, Math.max(0, 1 - share) * 4);
const SMALLEST = 16;
/** Bloom's levels at most: the smallest is 1 / 256 of the canvas, which at 4,320 pixels tall is the SMALLEST's 16. */
const MOST_LEVELS = 7;
/** The brightest light bloom takes, after exposure: the sun's disc is 24. */
const BRIGHTEST = 256;

/**
 * Bytes the light target takes on the card for a canvas `width` by `height` drawn with `samples` (Tier.post), in its
 * larger format: each sample's colour and depth, the resolved scene (with depth of its own where there are no samples),
 * and bloom's levels, a fifteenth of a pixel of four bytes: on high and ultra at 1,440p, with two, 119 MB.
 */
export const lightBytes = (width: number, height: number, samples: number): number => Math.ceil(width * height * ((samples > 0 ? samples * 12 + 8 : 12) + 4 / 15));

/** Whether a frame of `tier` is drawn into the light target, on a device whose target's format is `light` (0 for none). */
export const drawsLight = (tier: Tier, light: number | boolean): boolean => tier.post !== null && light !== 0 && light !== false;

/**
 * The render resolutions a player may choose (Settings.resolution): the game's, the canvas's own pixels, or a share of
 * them a side. Each is of a frame drawn into the light target; a tier without one draws the canvas's own.
 */
export const RESOLUTIONS: readonly { readonly label: string; readonly share: number }[] = [{ label: "auto", share: 0 }, { label: "native", share: 1 }, { label: "75%", share: 0.75 }, { label: "50%", share: 0.5 }];
/** The game's share is a whole number of twentieths, and never under a half. */
const TWENTIETHS = 20;
const LEAST_SHARE = 0.5;

/**
 * The share of the canvas a side a frame of `tier` draws its scene at before the governor's steps, on a canvas of
 * `pixels` at the screen's own pixels a CSS pixel: `choice` where the player chose one (RESOLUTIONS), else the most
 * that keeps the scene within the tier's `post.pixels`, in twentieths. 1 on a tier with no light target or no cap.
 */
export function sceneShare(tier: Tier, choice: number, pixels: number): number {
  if (!tier.post) return 1;
  if (choice > 0) return choice;
  const cap = tier.post.pixels;
  return cap > 0 && pixels > cap ? Math.max(LEAST_SHARE, Math.floor(Math.sqrt(cap / pixels) * TWENTIETHS) / TWENTIETHS) : 1;
}

/** The scene's pixels across and down at `share` of a canvas `width` by `height` a side. */
export const sceneSize = (width: number, height: number, share: number): [number, number] => [Math.max(1, Math.round(width * share)), Math.max(1, Math.round(height * share))];

/**
 * What a pass from level `from` into `to` (the canvas for -1) reads, with the scene drawn `w` by `h` in the corner of a
 * light target `roomW` by `roomH`: the share of the source's texture the drawn part fills, across and down, then the
 * farthest a read may go and stay in it, half a texel short of its edge, of the source or, for the finish, of bloom's
 * first level. Its near edges are the texture's own, which hold a read there.
 */
export function passExtent(w: number, h: number, roomW: number, roomH: number, from: number, to: number, out = new Float32Array(4)): Float32Array {
  const part = (n: number, k: number): number => Math.max(1, n >> levelShift(k)), k = to < 0 ? 1 : from;
  out[0] = part(w, from) / part(roomW, from); out[1] = part(h, from) / part(roomH, from);
  out[2] = (part(w, k) - 0.5) / part(roomW, k); out[3] = (part(h, k) - 0.5) / part(roomH, k);
  return out;
}

/** Bloom's levels on a canvas `height` pixels tall, `share` of them kept (Tier.post): the smallest no fewer than SMALLEST tall. */
export function bloomLevels(height: number, share: number): number {
  const all = Math.min(MOST_LEVELS, Math.max(1, Math.floor(Math.log2(height / SMALLEST)) - BLOOM_START + 1));
  return share <= 0 ? 0 : Math.max(1, Math.round(all * share));
}

/** The grade at a sun height (content/grade.ts), each number blended between the keys either side. */
export function gradeAt(height: number): GradeKey {
  const at = GRADE.findIndex((k) => k.sun >= height);
  if (at <= 0) return GRADE[at < 0 ? GRADE.length - 1 : 0]!;
  const a = GRADE[at - 1]!, b = GRADE[at]!;
  const t = (height - a.sun) / (b.sun - a.sun);
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return { sun: height, gain: [mix(a.gain[0], b.gain[0]), mix(a.gain[1], b.gain[1]), mix(a.gain[2], b.gain[2])], saturation: mix(a.saturation, b.saturation), gamma: mix(a.gamma, b.gamma) };
}

/**
 * Fills the frame block's finish (packet.ts fGrade, fFinish) for a frame of `tier` at `hour` into a light target
 * `height` pixels tall, its scene drawn at `share` of the canvas a side: the grade on every lit tier, which each shader
 * takes where there is no light target and the finish where there is, and bloom and the sharpen with a light target alone.
 */
export function postFrame(frame: Float32Array, tier: Tier, hour: number, height: number, share = 1): void {
  frame.fill(0, FRAME.grade, FRAME.levels + 1);
  if (!tier.lit) return;
  const k = gradeAt(sunHeight(hour));
  frame.set(k.gain, FRAME.grade);
  frame[FRAME.saturation] = k.saturation;
  frame[FRAME.gamma] = k.gamma;
  if (!tier.post) return;
  frame[FRAME.bloom] = BLOOM;
  frame[FRAME.sharpen] = sharpenAt(share);
  frame[FRAME.levels] = bloomLevels(height, tier.post.bloom);
}

/** What a visor does to the picture (D1033): its mode (packet.ts OPTIC_), how many times night vision amplifies the light, and the grain the finish adds. */
export interface Optic {
  mode: number;
  gain: number;
  grain: number;
}
/** Night vision's phosphor, a green one's (P43), as linear light at its brightest. */
export const PHOSPHOR: readonly number[] = [0.42, 1, 0.5];

/**
 * Fills the frame block's optic (packet.ts OPTIC_AT) for a frame of `tier` through `optic`, after `postFrame`: night
 * vision amplifies the light by its gain, as the grade's does, and shows its grey in the phosphor's colour, on every lit
 * tier; the grain, moved by `seed` each frame, is the finish's, where there is one. Low poly is shown as it is.
 */
export function opticFrame(frame: Float32Array, tier: Tier, optic: Optic, seed: number): void {
  frame.fill(0, OPTIC_AT, OPTIC_AT + 8);
  if (!tier.lit || (optic.mode === 0 && optic.grain === 0)) return;
  frame[OPTIC_AT] = optic.mode;
  frame[OPTIC_AT + 1] = tier.post ? optic.grain : 0;
  frame[OPTIC_AT + 2] = seed % 4096;
  if (optic.mode !== OPTIC_NIGHT) return;
  for (let c = 0; c < 3; c++) {
    frame[FRAME.grade + c] = frame[FRAME.grade + c]! * optic.gain;
    frame[OPTIC_AT + 4 + c] = PHOSPHOR[c]!;
  }
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

/**
 * What a step of the chain reads: its source on its unit, `uPass`, a texel of the source across and down, then 1 on
 * the first level, and `uExtent`, the part of the source the scene's share fills and how far a read may go (passExtent).
 */
const READ = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec4 uPass, uExtent;
in vec2 vUv;
out vec4 o;
vec3 at(float x, float y) {
  return texture(uSource, min(vUv * uExtent.xy + vec2(x, y) * uPass.xy, uExtent.zw)).rgb;
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
 * texel of the scene, then 1 where the scene is drawn at fewer pixels than the canvas: it is then taken up by
 * Catmull-Rom from five reads, held within the light of the middle read and the four neighbours, so that a bright edge
 * rings nowhere, and the sharpen, stronger (sharpenAt), takes its neighbours a texel of the scene off. `uExtent` is
 * passExtent's.
 */
export const FINISH = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom;
uniform vec4 uPass, uExtent;
in vec2 vUv;
out vec4 o;
${FRAME_BLOCK}${TONE}${GRADED}${BRIGHT}vec3 scene(vec2 at) {
  return texture(uScene, min(at, uExtent.xy - 0.5 * uPass.xy)).rgb;
}
float toned(vec3 c) {
  return dot(tone(c * fGrade.rgb), vec3(0.2126, 0.7152, 0.0722));
}
vec3 upscaled(vec2 at, out vec3 middle) {
  vec2 p = at / uPass.xy - 0.5, c = floor(p), f = p - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (c - 0.5) * uPass.xy, t3 = (c + 2.5) * uPass.xy, t12 = (c + 0.5 + w2 / w12) * uPass.xy;
  middle = scene(t12);
  vec3 s = (scene(vec2(t12.x, t0.y)) * w0.y + scene(vec2(t12.x, t3.y)) * w3.y) * w12.x + (scene(vec2(t0.x, t12.y)) * w0.x + scene(vec2(t3.x, t12.y)) * w3.x) * w12.y + middle * w12.x * w12.y;
  return s / (w12.x * (w0.y + w3.y) + w12.y * (w0.x + w3.x) + w12.x * w12.y);
}
float hash(uvec3 v) {
  uint h = v.x * 1664525u + v.y * 22695477u + v.z * 2654435761u;
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
void main() {
  vec2 uv = vUv * uExtent.xy;
  vec3 cn = scene(uv + vec2(uPass.x, 0.0)), cs = scene(uv - vec2(uPass.x, 0.0)), ce = scene(uv + vec2(0.0, uPass.y)), cw = scene(uv - vec2(0.0, uPass.y)), c, middle;
  if (uPass.w > 0.5) c = clamp(upscaled(uv, middle), min(middle, min(min(cn, cs), min(ce, cw))), max(middle, max(max(cn, cs), max(ce, cw))));
  else c = scene(uv);
  float l = toned(c), n = toned(cn), s = toned(cs), e = toned(ce), w = toned(cw);
  if (fFinish.w > 0.0) c += fFinish.y * (texture(uBloom, min(uv, uExtent.zw)).rgb / fFinish.w - bright(c));
  vec3 t = tone(c * fGrade.rgb);
  float sharp = clamp(l + fFinish.z * (l - 0.25 * (n + s + e + w)), min(l, min(min(n, s), min(e, w))), max(l, max(max(n, s), max(e, w))));
  t = graded(t * (l > 0.0 ? sharp / l : 1.0));
  // A visor's grain (opticFrame), heavier in the dark as an amplified picture's is.
  if (fOptic.y > 0.0) t += (hash(uvec3(gl_FragCoord.xy, uint(fOptic.z) + 7u)) - 0.5) * fOptic.y / sqrt(max(dot(t, vec3(0.2126, 0.7152, 0.0722)), 0.04));
  uvec3 at = uvec3(gl_FragCoord.xy, 0u);
  o = vec4(encoded(clamp(t, 0.0, 1.0)) + (hash(at) + hash(at + uvec3(0u, 0u, 1u)) - 1.0) / 255.0, 1.0);
}`;
