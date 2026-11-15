// The sea on the lit tiers, seen from above (D270): a flat plane at sea level, still the swim surface, roughened by two
// scrolled pictures of wave slopes (assets/source/core/water). It mirrors the sky table where the eye's ray is
// reflected to, by Fresnel's term, and glints where it mirrors the sun and the moon. Under that is the water itself:
// clear in the shallows and the deep blue of open sea, by how deep the water is there, read from the terrain's own
// heights, and see-through over its last 30 cm at the shore. Then haze, exposure and the tone curve, as
// everything lit is shown.
//
// The maths is here twice, as GLSL and as functions on numbers, written from the same constants. The rasterizer does
// not draw it (D264): the twins are what the lit probe holds a GPU's pictures to. Under water, and in a plain sky, the
// sea is drawn as it always was.

import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { AIR, hazed } from "./atmosphere.ts";
import { SEE_THROUGH_SPLIT } from "./glsl.ts";
import { FRAME, SOURCE_MAP, SOURCE_WINDOW } from "./packet.ts";
import { domeLight, trueSun } from "./sky.ts";
import { LIGHT, linearToSrgb, skyOn, tone } from "./surface.ts";
import { COARSE, type GroundSize } from "./terrain.ts";

/** What water reflects head on, and how rough its surface is between the waves the pictures hold. */
export const SEA_F0 = 0.02;
export const SEA_ROUGH = 0.06;
/** A glint is never narrower than the sun's disc it mirrors: half its radius of a degree, which the half-way vector spreads. */
const DISC = 0.0087;
/** Metres of depth over which the sea fades out at the shore. */
export const SHORE = 0.3;
/** How much light the water lets through, per metre it travels in it: the eye's way to the bottom and the light's way down. */
export const CLEAR = 0.35;
/** What the water's own colour is lit as: turquoise in the shallows, the deep blue of open sea, turning over about TURN metres. */
export const SHALLOW = [0.0, 0.5, 0.56] as const;
export const DEEP = [0.003, 0.02, 0.07] as const;
export const TURN = 4;
/** How much more light water bends than air: the eye's ray goes steeper into it. */
const BEND = 1.333;
/** Where the map has no ground, past its edges, the sea is this deep. */
const OPEN_SEA = 200;
/** Samples inside the window's edge over which the depth is eased from the window's heights into the whole map's. */
const EASE = 16;
/** Above this light after exposure a glint covers what is under it, wholly by twice it, whatever the water lets through. */
const GLARE = 0.6;
/**
 * How the facets seen low lean toward the eye: by the variance of the slopes not drawn over how low they are seen plus
 * LEAN times their spread; and a facet is always seen at least FACING (a cosine) from its edge.
 */
const LEAN = 0.8;
const FACING = 0.04;

/**
 * A picture of wave slopes (assets/source/core/water/waves.ts): the metres one tile spans, how far it is turned from
 * the world's x, the speed it is blown along its own x in metres a second, and how strong its slopes are drawn.
 */
export interface WaveLayer {
  span: number;
  turn: number;
  speed: number;
  gain: number;
}

/** Long waves and the short ripples on them, each blown along its own way, the two at an angle so their tiles never line up. */
export const LONG: WaveLayer = { span: 61, turn: 0.35, speed: 1.1, gain: 0.6 };
export const SHORT: WaveLayer = { span: 7.3, turn: -0.62, speed: 0.45, gain: 0.55 };
/**
 * How strong the waves are by the sun's height, as the keys paint them and a tropical sea breeze blows: calm while the
 * sun is under `calm` degrees, at dawn, dusk and night, so the sea mirrors the glow low on the sky and the sun's path is
 * narrow; a light breeze `breeze` times as strong once it is over `blown`, so the sea by day mirrors higher, bluer sky.
 */
export const BREEZE = { calm: 5, blown: 30, breeze: 1.3 };
/** The material whose two masks are the long and the short waves. A picture that has not come reads as a calm sea. */
export const WATER_MATERIAL = "core:water/waves";
/** How the waves' pictures are asked for: as large as they are made, and as soon as what is near. */
export const WATER_ASKED = { pixels: 4096, distance: 50 };
/**
 * A picture's red and green are the slopes along its x and y, -SLOPE_MOST at 1 and SLOPE_MOST at 255, 128 level; its
 * blue the mean of their squares, SQUARE_MOST at 255, so that a coarser picture, being the mean of finer ones, also
 * says how much slope it has lost; alpha the height, which nothing reads yet. Each is made with RMS_SLOPE.
 */
export const SLOPE_MOST = 0.4;
export const SQUARE_MOST = 0.1;
export const RMS_SLOPE = 0.1;
/** The smallest picture of waves drawn: a smaller one is the neutral pixel of a picture that has not come. */
const WAVES_SMALLEST = 16;

type Out = number[] | Float32Array | Float64Array;
type Vec = ArrayLike<number>;

/** Where the camera is over a layer's tiles after `seconds` of its wind, a share of a tile along each of the picture's axes. */
function over(layer: WaveLayer, x: number, z: number, seconds: number, out: Out, at: number): void {
  const [c, s] = [Math.cos(layer.turn), Math.sin(layer.turn)];
  const u = (c * x + s * z - layer.speed * seconds) / layer.span;
  const v = (c * z - s * x) / layer.span;
  out[at] = u - Math.floor(u);
  out[at + 1] = v - Math.floor(v);
}

/** How strong the waves are with the sun `height` degrees up (BREEZE). */
export function waveStrength(height: number): number {
  const t = Math.max(0, Math.min(1, (height - BREEZE.calm) / (BREEZE.blown - BREEZE.calm)));
  return 1 + (BREEZE.breeze - 1) * t * t * (3 - 2 * t);
}

/**
 * Fills the sea's part of a frame block, whose sky must be filled first: where the camera is over the two wave layers,
 * and where it is in the samples of each of the ground's two pairs of pictures (terrain.ts), the window drawn
 * (`window` as the packet's groundWindow has it) and the whole map's; sea level among the heights; how strong the
 * waves are at the hour. Core works these out in double precision.
 */
export function seaFrame(frame: Float32Array, hf: Heightfield, size: GroundSize, window: Int32Array, x: number, z: number, seconds: number): void {
  over(LONG, x, z, seconds, frame, FRAME.waves);
  over(SHORT, x, z, seconds, frame, FRAME.waves + 2);
  const cell = size.cell;
  frame[FRAME.ground] = window[0]! >= 0 ? x / cell[SOURCE_WINDOW]! - window[1]! : -1e6;
  frame[FRAME.ground + 1] = window[0]! >= 0 ? z / cell[SOURCE_WINDOW]! - window[2]! : -1e6;
  frame[FRAME.ground + 2] = x / cell[SOURCE_MAP]!;
  frame[FRAME.ground + 3] = z / cell[SOURCE_MAP]!;
  frame[FRAME.sea] = (hf.seaLevel - hf.minY) / hf.stepY;
  frame[FRAME.sea + 1] = hf.stepY;
  frame[FRAME.sea + 2] = 1 / cell[SOURCE_WINDOW]!;
  frame[FRAME.sea + 3] = waveStrength((Math.asin(Math.max(-1, Math.min(1, -frame[FRAME.moon + 1]!))) * 180) / Math.PI);
}

/** The height, in the field's units, of a pair's ground at (u, v) in its samples, on the triangles collision splits a cell into. */
function floorAt(sample: (i: number, j: number) => number, last: [number, number], u: number, v: number): number {
  const cu = Math.max(0, Math.min(last[0], u));
  const cv = Math.max(0, Math.min(last[1], v));
  const i = Math.min(Math.floor(cu), last[0] - 1);
  const j = Math.min(Math.floor(cv), last[1] - 1);
  const [fu, fv] = [cu - i, cv - j];
  const [h00, h11] = [sample(i, j), sample(i + 1, j + 1)];
  if (fu >= fv) {
    const h10 = sample(i + 1, j);
    return h00 + (h10 - h00) * fu + (h11 - h10) * fv;
  }
  const h01 = sample(i, j + 1);
  return h00 + (h11 - h01) * fu + (h01 - h00) * fv;
}

/**
 * Metres of sea over the ground at a point `rx`, `rz` metres from the camera, read as the WATER program reads it from
 * a frame block `seaFrame` filled: from the window round the camera, eased into the whole map's pair over the window's
 * last EASE samples, and OPEN_SEA past the map's edges. Under 0 where the ground is above the sea.
 */
export function seaDepth(frame: Float32Array, hf: Heightfield, size: GroundSize, window: Int32Array, rx: number, rz: number): number {
  const lastMap: [number, number] = [size.width[SOURCE_MAP]! - 1, size.height[SOURCE_MAP]! - 1];
  const mu = frame[FRAME.ground + 2]! + (rx * frame[FRAME.sea + 2]!) / COARSE;
  const mv = frame[FRAME.ground + 3]! + (rz * frame[FRAME.sea + 2]!) / COARSE;
  if (mu < 0 || mv < 0 || mu > lastMap[0] || mv > lastMap[1]) return OPEN_SEA;
  const lastWin: [number, number] = window[0]! >= 0 ? [size.width[SOURCE_WINDOW]! - 1, size.height[SOURCE_WINDOW]! - 1] : [-1, -1];
  const wu = frame[FRAME.ground]! + rx * frame[FRAME.sea + 2]!;
  const wv = frame[FRAME.ground + 1]! + rz * frame[FRAME.sea + 2]!;
  const ease = Math.max(0, Math.min(1, Math.min(wu, wv, lastWin[0] - wu, lastWin[1] - wv) / EASE));
  const coarse = (i: number, j: number): number => hf.heights[Math.min(j * COARSE, hf.nz - 1) * hf.nx + Math.min(i * COARSE, hf.nx - 1)]!;
  const fine = (i: number, j: number): number => hf.heights[(window[2]! + j) * hf.nx + window[1]! + i]!;
  let h = ease < 1 ? floorAt(coarse, lastMap, mu, mv) : 0;
  if (ease > 0) h += (floorAt(fine, lastWin, wu, wv) - h) * ease;
  return (frame[FRAME.sea]! - h) * frame[FRAME.sea + 1]!;
}

/** What the WATER program makes of a pixel before it is shown: the light it adds over what is under it, and how much of that it covers. */
export interface SeaPixel {
  light: number[];
  cover: number;
}

const mirror = [0, 0, 0];
const sky = [0, 0, 0];
const reflected = [0, 0, 0];
const sun = [0, 0, 0];

/**
 * Adds a light's glint off the sea, from the way `way` in `frame` and its colour at `colour`: the facets' slopes
 * spread as a sea's are, by Gauss (Beckmann's lobe, as Cox and Munk measured sun glitter), with variance `a2`, then
 * Smith's term and Schlick's edge from SEA_F0, as surface.ts `direct` has them.
 */
function glint(out: Out, frame: Vec, way: number, colour: number, a2: number, n: Vec, v: Vec, nv: number): void {
  const [lx, ly, lz] = [frame[way]!, frame[way + 1]!, frame[way + 2]!];
  const nl = Math.max(n[0]! * lx + n[1]! * ly + n[2]! * lz, 0);
  if (nl === 0) return;
  const [hx, hy, hz] = [lx + v[0]!, ly + v[1]!, lz + v[2]!];
  const hl = Math.max(Math.hypot(hx, hy, hz), 1e-6);
  const nh = Math.min(Math.max((n[0]! * hx + n[1]! * hy + n[2]! * hz) / hl, 1e-4), 1);
  const vh = Math.min(Math.max((v[0]! * hx + v[1]! * hy + v[2]! * hz) / hl, 0), 1);
  const c2 = nh * nh;
  const gloss = ((Math.exp((c2 - 1) / (c2 * a2)) / (a2 * c2 * c2)) * 0.5) / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
  const f = SEA_F0 + (1 - SEA_F0) * Math.pow(1 - vh, 5);
  for (let c = 0; c < 3; c++) out[c]! += frame[colour + c]! * nl * gloss * f;
}

/**
 * The facet that mirrors the sky to the eye, on a surface of normal `n` whose waves have `spread` of their mean square
 * of slope too fine to draw. Seen low, facets tilted toward the eye show more of themselves and those tilted away hide,
 * so the facet seen leans toward the eye by the slopes' variance over how low it is seen (by about the slope itself at
 * the horizon), mirroring higher sky with less of Fresnel's edge. It is never seen from behind.
 */
function facing(out: Out, n: Vec, v: Vec, spread: number): void {
  const nv = n[0]! * v[0]! + n[1]! * v[1]! + n[2]! * v[2]!;
  const side = [0, 1, 2].map((k) => v[k]! - n[k]! * nv);
  const along = Math.max(Math.hypot(side[0]!, side[1]!, side[2]!), 1e-6);
  const tilt = spread / 2 / (Math.max(nv, 0) + LEAN * Math.sqrt(spread / 2) + 1e-4);
  for (let k = 0; k < 3; k++) out[k] = n[k]! + (side[k]! / along) * tilt;
  const m = out[0]! * v[0]! + out[1]! * v[1]! + out[2]! * v[2]!;
  const lift = Math.max(0, FACING - m / Math.hypot(out[0]!, out[1]!, out[2]!));
  for (let k = 0; k < 3; k++) out[k] = out[k]! + v[k]! * lift;
  const length = Math.hypot(out[0]!, out[1]!, out[2]!);
  for (let k = 0; k < 3; k++) out[k] = out[k]! / length;
}

const seen = [0, 0, 0];

/**
 * The twin of the WATER program for a pixel whose surface normal is `n` (straight up for a calm sea), seen along `v`,
 * the way to the eye, over water `depth` metres deep, its waves' slopes having lost `spread` of their mean square to
 * distance. `table` is the sky table.
 */
export function seaPixel(frame: Float32Array, table: Uint8Array, n: Vec, v: Vec, depth: number, spread: number): SeaPixel {
  const nv = Math.min(Math.max(n[0]! * v[0]! + n[1]! * v[1]! + n[2]! * v[2]!, 0.001), 1);
  const a2 = Math.pow(SEA_ROUGH, 4) + DISC * DISC + spread;
  facing(seen, n, v, spread);
  const mv = seen[0]! * v[0]! + seen[1]! * v[1]! + seen[2]! * v[2]!;
  const f = SEA_F0 + (1 - SEA_F0) * Math.pow(1 - Math.min(Math.max(mv, 0), 1), 5);
  const r = [0, 1, 2].map((k) => 2 * mv * seen[k]! - v[k]!);
  trueSun(frame, sun);
  domeLight(table, sun, r, reflected);
  skyOn(sky, frame, seen[1]!);
  const a = Math.min(Math.sqrt(a2), 1);
  for (let k = 0; k < 3; k++) mirror[k] = f * (reflected[k]! * frame[FRAME.skyScale]! * (1 - a) + sky[k]! * a);
  const shine = [0, 0, 0];
  const lights = Float64Array.of(sun[0]!, sun[1]!, sun[2]!, 0, ...[0, 1, 2].map((k) => frame[FRAME.sunColor + k]! * frame[FRAME.casting]!));
  glint(shine, lights, 0, 4, a2, n, v, nv);
  glint(shine, frame, FRAME.moon, FRAME.moonColor, a2, n, v, nv);
  const d = Math.max(depth, 0);
  const up = Math.abs(v[1]!);
  const steep = Math.sqrt(1 - (1 - up * up) / (BEND * BEND));
  const through = Math.exp(-CLEAR * d * (1 + 1 / steep));
  const deep = 1 - Math.exp(-d / TURN);
  skyOn(sky, frame, 1);
  const light = [0, 0, 0];
  let peak = 0;
  for (let k = 0; k < 3; k++) {
    const lit = sky[k]! + frame[FRAME.sunColor + k]! * Math.max(frame[FRAME.sun + 1]!, 0) + frame[FRAME.moonColor + k]! * Math.max(frame[FRAME.moon + 1]!, 0);
    const body = (SHALLOW[k]! + (DEEP[k]! - SHALLOW[k]!) * deep) * lit;
    light[k] = mirror[k]! + shine[k]! + (1 - f) * (1 - through) * body;
    peak = Math.max(peak, (mirror[k]! + shine[k]!) * frame[FRAME.exposure]!);
  }
  const under = 1 - (1 - f) * through;
  const glare = Math.max(0, Math.min(1, (peak - GLARE) / GLARE));
  const cover = under + (1 - under) * glare;
  return { light: light.map((c) => c / cover), cover: cover * Math.max(0, Math.min(1, d / SHORE)) };
}

/**
 * A sea pixel as the screen shows it, 0 to 255, over `below` (what is under it as shown, 0 to 255), `rel` metres from
 * the eye: the light hazed, exposed, toned and shown, then blended over `below` as the GPU blends it.
 */
export function seaShown(px: SeaPixel, rel: Vec, below: Vec, frame: Float32Array, table: Uint8Array): number[] {
  const s = [0, 0, 0];
  trueSun(frame, s);
  const air = [0, 0, 0];
  hazed(air, px.light, rel, frame, table, s);
  const e = frame[FRAME.exposure]!;
  const toned = [0, 0, 0];
  tone(toned, air.map((c) => c * e));
  return toned.map((c, k) => 255 * linearToSrgb(Math.min(Math.max(c, 0), 1)) * px.cover + below[k]! * (1 - px.cover));
}

const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec3 = (c: readonly number[]): string => `vec3(${c.map(g).join(", ")})`;

/** Where a layer's picture is read for the camera-relative point `rel`: in its turned tiles, moved by `at`. */
const tiles = (layer: WaveLayer, at: string): string => {
  const [c, s] = [Math.cos(layer.turn) / layer.span, Math.sin(layer.turn) / layer.span];
  return `vec2(${g(c)} * rel.x + ${g(s)} * rel.y, ${g(c)} * rel.y - ${g(s)} * rel.x) + ${at}`;
};

/** A layer's slopes from its texel `t`, turned back to the world's x and z and drawn at its strength. */
const slopes = (layer: WaveLayer, t: string): string => {
  const [c, s] = [Math.cos(layer.turn), Math.sin(layer.turn)].map((v) => (v * SLOPE_MOST * layer.gain) / 127) as [number, number];
  return `mat2(${g(c)}, ${g(s)}, ${g(-s)}, ${g(c)}) * (${t}.xy * 255.0 - 128.0)`;
};

/**
 * The WATER fragment text, drawn from FLAT's vertex text over tiles of the flat mesh `core:water`: the twins' maths,
 * from the frame block, with the waves' pictures on the units of a material's masks, and the ground's heights, the
 * whole map's and the window's, on theirs.
 */
export const WATER_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRel;
flat in vec3 vColor;
uniform highp usampler2D uMapHeight, uWindowHeight;
uniform sampler2D uWaveLong, uWaveShort;
out vec4 o;
${LIGHT}${AIR}${SEE_THROUGH_SPLIT}float floorAt(highp usampler2D h, vec2 at, vec2 last) {
  vec2 c = clamp(at, vec2(0.0), last);
  ivec2 k = ivec2(min(floor(c), last - 1.0));
  vec2 f = c - vec2(k);
  float h00 = float(texelFetch(h, k, 0).r), h11 = float(texelFetch(h, k + 1, 0).r);
  if (f.x >= f.y) {
    float h10 = float(texelFetch(h, k + ivec2(1, 0), 0).r);
    return h00 + (h10 - h00) * f.x + (h11 - h10) * f.y;
  }
  float h01 = float(texelFetch(h, k + ivec2(0, 1), 0).r);
  return h00 + (h11 - h01) * f.x + (h01 - h00) * f.y;
}
// The twin of glint: a light's glint off facets whose slopes spread by Gauss with variance a2.
vec3 glint(vec3 l, vec3 colour, float a2, vec3 n, vec3 v, float nv) {
  float nl = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  float c2 = max(dot(n, h), 0.0001);
  c2 *= c2;
  float vh = clamp(dot(v, h), 0.0, 1.0);
  float gloss = exp((c2 - 1.0) / (c2 * a2)) / (a2 * c2 * c2) * 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2));
  return colour * nl * gloss * (${g(SEA_F0)} + ${g(1 - SEA_F0)} * pow(1.0 - vh, 5.0));
}
// The twin of seaDepth: metres of sea over the ground 'rel' from the camera.
float seaDepth(vec2 rel) {
  vec2 lastMap = vec2(textureSize(uMapHeight, 0) - 1);
  vec2 m = fGround.zw + rel * (fSea.z / ${g(COARSE)});
  if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, lastMap))) return ${g(OPEN_SEA)};
  vec2 lastWin = vec2(textureSize(uWindowHeight, 0) - 1);
  vec2 w = fGround.xy + rel * fSea.z;
  float ease = clamp(min(min(w.x, w.y), min(lastWin.x - w.x, lastWin.y - w.y)) / ${g(EASE)}, 0.0, 1.0);
  float h = ease < 1.0 ? floorAt(uMapHeight, m, lastMap) : 0.0;
  if (ease > 0.0) h = mix(h, floorAt(uWindowHeight, w, lastWin), ease);
  return (fSea.x - h) * fSea.y;
}
void main() {
  dropNearer();
  float depth = seaDepth(vRel.xz);
  if (depth <= 0.0) discard;
  float dist = length(vRel);
  vec3 v = -vRel / dist;
  // The waves: each picture's slopes, and how much of their mean square its coarser pictures have lost to distance.
  vec3 n = vec3(0.0, 1.0, 0.0);
  float spread = 0.0;
  if (textureSize(uWaveLong, 0).x >= ${WAVES_SMALLEST} && textureSize(uWaveShort, 0).x >= ${WAVES_SMALLEST}) {
    vec2 rel = vRel.xz;
    vec4 wl = texture(uWaveLong, ${tiles(LONG, "fWaves.xy")}), ws = texture(uWaveShort, ${tiles(SHORT, "fWaves.zw")});
    vec2 sa = fSea.w * ${slopes(LONG, "wl")}, sb = fSea.w * ${slopes(SHORT, "ws")};
    vec2 s = sa + sb;
    n = normalize(vec3(-s.x, 1.0, -s.y));
    spread = max(wl.z * ${g(SQUARE_MOST * LONG.gain * LONG.gain)} * fSea.w * fSea.w - dot(sa, sa), 0.0) + max(ws.z * ${g(SQUARE_MOST * SHORT.gain * SHORT.gain)} * fSea.w * fSea.w - dot(sb, sb), 0.0);
  }
  float nv = clamp(dot(n, v), 0.001, 1.0);
  float a2 = ${g(Math.pow(SEA_ROUGH, 4) + DISC * DISC)} + spread;
  // The twin of facing: the facet seen, leaning toward the eye, mirrors the sky.
  vec3 side = v - n * dot(n, v);
  vec3 m = n + side / max(length(side), 1e-6) * (spread * 0.5 / (max(dot(n, v), 0.0) + ${g(LEAN)} * sqrt(spread * 0.5) + 1e-4));
  m = normalize(m + v * max(0.0, ${g(FACING)} - dot(m, v) / length(m)));
  float mv = dot(m, v);
  float f = ${g(SEA_F0)} + ${g(1 - SEA_F0)} * pow(1.0 - clamp(mv, 0.0, 1.0), 5.0);
  float a = min(sqrt(a2), 1.0);
  vec3 mirror = f * mix(skyFrom(reflect(-v, m)), skyOn(m.y), a);
  // The sun's glint where the sun is, as much as its disc is up; the moon's.
  vec3 shine = glint(fTrueSun, fSunColor.rgb * fSun.w, a2, n, v, nv) + glint(fMoon.xyz, fMoonColor.rgb, a2, n, v, nv);
  float up = abs(v.y);
  float through = exp(-${g(CLEAR)} * depth * (1.0 + 1.0 / sqrt(1.0 - (1.0 - up * up) / ${g(BEND * BEND)})));
  vec3 lit = skyOn(1.0) + fSunColor.rgb * max(fSun.y, 0.0) + fMoonColor.rgb * max(fMoon.y, 0.0);
  vec3 body = mix(${vec3([...SHALLOW])}, ${vec3([...DEEP])}, 1.0 - exp(-depth / ${g(TURN)})) * lit;
  vec3 light = mirror + shine + (1.0 - f) * (1.0 - through) * body;
  vec3 top = (mirror + shine) * fSunColor.w;
  float under = 1.0 - (1.0 - f) * through;
  float cover = under + (1.0 - under) * clamp((max(top.r, max(top.g, top.b)) - ${g(GLARE)}) / ${g(GLARE)}, 0.0, 1.0);
  o = vec4(shown(light / cover, vRel), cover * clamp(depth / ${g(SHORE)}, 0.0, 1.0));
}`;
