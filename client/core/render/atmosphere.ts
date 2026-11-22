// The air on the lit tiers: haze over distance, and the dome's sun, moon, stars and two layers of cloud. The haze is
// here twice, as functions on numbers and as GLSL, written from the same constants; the rasterizer draws neither, so
// the twins are what checks hold a GPU's pictures to (D264). The dome's sky itself is the table (sky.ts); what is
// drawn over it here is WebGL only.
//
// Haze thins with height as density · exp(-(y - sea level) / height), summed along a ray in closed form, and is the
// sky table's colour 3 degrees above the horizon in the ray's direction. The end of the view fades into the dome.
//
// The clouds are two pictures (assets/source/core/sky/clouds): red is how much of the sky a cloud hides, green how
// little sun gets through it, both linear. Each layer lies on a shell over a round earth and is lit as the art
// director's light.py proposes: light through it by its thickness, a slope toward the light from a coarse picture,
// a bright rim toward the sun, the sky's light round it, and haze in front of it.

import { EYE_SKY_GLSL, STORM_DEPTH } from "./tide-eye.ts";
import { DROP_SKY_GLSL } from "./supply-sky.ts";
import { FRAME, FRAME_BLOCK, FRAME_FLOATS } from "./packet.ts";
import { MOON_RADIUS, SKY_GLSL, SUN_RADIUS, domeLight, hazeColor, hourOfSun, luminance, skyFrame, sunHeight, trueSun, upCoord, type Sky } from "./sky.ts";
import { LIGHT, skyFromGlsl } from "./surface.ts";
import { WORLD_NEAR } from "./world-surfaces.ts";

/**
 * The haze's density at sea level, per metre, and the height over which it thins by e: 2% at 200 m, 10% at 1 km, 36% at
 * 4 km and 59% at 8 km along the sea. It was 1.6e-4 (47% at 4 km), tuned to the keys from the plan's 2.5e-4, and turned
 * down a third once the views reached past 4 km (D877).
 */
export const HAZE_DENSITY = 1.1e-4;
export const HAZE_HEIGHT = 400;
/** The share of the view after which what is drawn fades into the dome, which it has wholly at the view's end. */
export const VIEW_FADE = 0.8;
/**
 * Where a tier's view starts to fade into the dome: at this share of it, and on a long view no later than this many
 * metres along the ground (about three miles), past which the city is cheap blocks. A long, slow fade to the view's end
 * reads as distance rather than an edge.
 */
export const FADE_SHARE = 0.6;
export const FADE_FROM = 4800;
/** Degrees above the horizon the haze takes its colour from. */
export const HAZE_UP = 3;

/** A cloud layer: metres over the sea, metres a tile of its picture spans, the optical depth of its thickest cloud, and metres toward the light its slope is read over. */
export interface CloudLayer {
  height: number;
  span: number;
  depth: number;
  step: number;
  /** Its wind, x and z in metres a second. */
  wind: readonly [number, number];
}

/**
 * Broken heaped cloud low, thin streaks high. A picture lies with its x along -X and its y along +Z, so that looking
 * north it is seen as the art director's light.py draws it, and the high layer's fibres run along its wind.
 */
export const LOW: CloudLayer = { height: 1500, span: 8000, depth: 9, step: 120, wind: [-3.6, -4.8] };
export const HIGH: CloudLayer = { height: 8000, span: 32000, depth: 1.6, step: 240, wind: [-13, -5.2] };
/** The material whose pictures the dome draws: the moon as base colour, and the low and high layers as the two masks, whose missing picture reads as no cloud. */
export const SKY_MATERIAL = "core:sky/sky";
/** The radius of the earth the layers curve over, in metres. */
export const EARTH = 6371000;
/**
 * How the sky's pictures are asked for: as though a whole one covered this many pixels, so each comes as large as the
 * tier allows, and as urgently as the world's finishes (world-surfaces.ts WORLD_NEAR), each map one it is not drawn
 * without: the clouds are a few kilobytes at their first steps and are over the whole frame.
 */
export const SKY_ASKED = { pixels: 4096, distance: WORLD_NEAR };
/** A layer is drawn once its picture is this many pixels across: a smaller one is too soft to show. */
const LAYER_SMALLEST = 512;

/** Degrees under its own horizon a layer sees the sun go: clouds stay lit after the sun has set on the ground. */
export function dip(layer: CloudLayer): number {
  return (Math.acos(EARTH / (EARTH + layer.height)) * 180) / Math.PI;
}

type Vec = ArrayLike<number>;
type Out = number[] | Float32Array | Float64Array;

/** The share of light haze takes on a ray `dist` metres long that climbs `dy` a metre, from an eye `eye` metres over the sea. */
export function hazeAmount(density: number, height: number, eye: number, dist: number, dy: number): number {
  if (density <= 0) return 0;
  const k = (dist * dy) / height;
  const along = Math.abs(k) < 0.01 ? 1 - k * (0.5 - k / 6) : (1 - Math.exp(-k)) / k;
  return 1 - Math.exp(-density * Math.exp(-eye / height) * dist * along);
}

/** How far into the end of the view's fade a point `dist` metres off is, 0 to 1: none where the fade's end is not past its start. */
export function viewFade(from: number, to: number, dist: number): number {
  if (to <= from) return 0;
  const t = Math.max(0, Math.min(1, (dist - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

const ray = [0, 0, 0];
const air = [0, 0, 0];

/**
 * Light from a point `rel` metres from the eye, after the air between: mixed toward the haze's colour, then over the
 * end of the view toward the dome in its direction. `table` and `sun` are the sky table and fTrueSun. The twin of
 * the GLSL `hazed`.
 */
export function hazed(out: Out, light: Vec, rel: Vec, frame: Float32Array, table: Uint8Array, sun: Vec): void {
  const dist = Math.hypot(rel[0]!, rel[1]!, rel[2]!);
  for (let k = 0; k < 3; k++) ray[k] = rel[k]! / dist;
  const a = hazeAmount(frame[FRAME.haze]!, frame[FRAME.hazeHeight]!, frame[FRAME.eyeHeight]!, dist, ray[1]!);
  hazeColor(table, sun, ray, frame[FRAME.skyScale]!, air);
  for (let k = 0; k < 3; k++) out[k] = a > 1 / 512 ? light[k]! + (air[k]! - light[k]!) * a : light[k]!;
  const end = viewFade(frame[FRAME.ends]!, frame[FRAME.ends + 1]!, dist);
  if (end === 0) return;
  domeLight(table, sun, ray, air);
  for (let k = 0; k < 3; k++) out[k] = out[k]! + (air[k]! * frame[FRAME.skyScale]! - out[k]!) * end;
}

const lifted = new Float32Array(FRAME_FLOATS);
const towardSun = [0, 0, 0];
const glow = [0, 0, 0];
/** Degrees up the sun the low layer sees stands between which its light turns from the colour of the glow low toward it to its own. */
const GLOW_TURN = [5, 15];
/** How bright light in the glow's colour is against the sun's, fitted so that overhead a sunset cloud is the art director's lit cloud within 2 (OKLab x 100). */
const GLOW_DIM = 0.7;

/**
 * Fills the air's part of a frame block: the haze, the end of the view, what the dome draws over the table (the sun,
 * the moon and the stars, and `layers` of cloud, the low one first), where the camera is over each layer's tile after
 * `seconds` of wind, and the sun's light as the low layer sees it. That is as bright as a sun `dip` degrees higher's;
 * with that sun low it is the colour of the sky's glow 3 degrees up toward it, as the light reaching a cloud has come
 * the glow's long way through the air, and as the art director's light.py lights a sunset cloud. `plain` leaves out
 * the haze and all that is drawn over the table, as the rasterizer draws. The frame block's sky must be filled first.
 * What is drawn fades into the dome from `from` metres to the view's end.
 */
export function airFrame(frame: Float32Array, sky: Sky, hour: number, camX: number, camZ: number, seconds: number, view: number, layers: number, plain: boolean, from = view * VIEW_FADE): void {
  frame[FRAME.haze] = plain ? 0 : HAZE_DENSITY;
  frame[FRAME.hazeHeight] = HAZE_HEIGHT;
  frame[FRAME.skyDetail] = plain ? 0 : 1 + layers;
  frame[FRAME.ends] = plain ? 0 : from;
  frame[FRAME.ends + 1] = plain ? 0 : view;
  for (let n = 0; n < 2; n++) {
    const layer = n === 0 ? LOW : HIGH, at = FRAME.clouds + n * 2;
    for (let k = 0; k < 2; k++) {
      const x = ((k === 0 ? -1 : 1) * ((k === 0 ? camX : camZ) + layer.wind[k]! * seconds)) / layer.span;
      frame[at + k] = x - Math.floor(x);
    }
  }
  // The sun's light at the hour of the same half of the day when the sun stands `dip` higher.
  const up = sunHeight(hour) + dip(LOW);
  skyFrame(hourOfSun(up, hour >= 12), sky, lifted);
  const light = [0, 1, 2].map((k) => lifted[FRAME.sunColor + k]!);
  trueSun(frame, towardSun);
  hazeColor(sky.table, towardSun, towardSun, 1, glow);
  const w = smooth((up - GLOW_TURN[0]!) / (GLOW_TURN[1]! - GLOW_TURN[0]!));
  const lit = luminance(light), seen = luminance(glow);
  for (let k = 0; k < 3; k++) frame[FRAME.cloudSun + k] = w * light[k]! + (seen > 0 ? (1 - w) * (glow[k]! / seen) * lit * GLOW_DIM : 0);
}

const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const DEG = Math.PI / 180;

/** What every lit program that shows light reads of the air: the sky table's lookup (surface.ts skyFrom), and `hazed`, which LIGHT's `shown` calls. */
export const AIR = `${skyFromGlsl(SKY_GLSL)}float hazeAmount(float dist, float dy) {
  if (fHaze.x <= 0.0) return 0.0;
  float k = dist * dy / fHaze.y;
  float along = abs(k) < 0.01 ? 1.0 - k * (0.5 - k / 6.0) : (1.0 - exp(-k)) / k;
  return 1.0 - exp(-fHaze.x * exp(-fHaze.z / fHaze.y) * dist * along);
}
vec3 hazed(vec3 light, vec3 rel) {
  float dist = length(rel);
  vec3 d = rel / max(dist, 1e-6);
  // The table is read only where it adds a step's worth or more. It has no smaller pictures, so a read in a branch
  // that differs between neighbouring pixels samples it as anywhere else.
  float a = hazeAmount(dist, d.y);
  if (a > ${g(1 / 512)}) light = mix(light, skyAt(uSkyTable, d.xz, ${g(upCoord(HAZE_UP))}) * fSkyScale, a);
  float end = fView.y > fView.x ? smoothstep(fView.x, fView.y, dist) : 0.0;
  if (end > 0.0) light = mix(light, skyFrom(d), end);
  return light;
}
`;

// What the dome draws over the table. Every brightness here is light after exposure, as the tone curve takes it.

/** The sun's disc at its brightest, and how dark its edge is against its middle. */
const SUN_BRIGHT = 24;
const LIMB = 0.6;
/**
 * The glow round the sun within about 3 degrees, which the table leaves to the dome: how bright at its limb, and over
 * how many degrees it falls by e, a tight one and a wider one.
 */
const SUN_GLOW = [1.2, 0.3, 0.3, 0.9];
/** The moon's face: how bright its whitest is, and its tint. */
const MOON_BRIGHT = 0.95;
const MOON_TINT = [1, 0.93, 0.78];
/** The moon's silver halo, as the night key has it: a core about 6 degrees across and a skirt about 12, and its tint. */
const MOON_GLOW = [0.1, 0.6, 0.2, 3.2];
const HALO_TINT = [0.82, 0.88, 1];
/** A glow is not drawn where it is under this, light after exposure: far under a display step even over the night sky. */
const GLOW_LEAST = 1e-4;
/** Degrees from the middle of a disc of `radius` past which its glow `g` (GLSL `glow`) is under GLOW_LEAST. */
const glowReach = (radius: number, g: readonly number[]): number => radius + Math.max(g[1]! * Math.log((2 * g[0]!) / GLOW_LEAST), g[3]! * Math.log((2 * g[2]!) / GLOW_LEAST));
/** Stars: cells a side of each face of a cube of directions, the share of cells with a star, and the brightest. */
export const STAR_CELLS = 128;
export const STAR_SHARE = 0.025;
const STAR_BRIGHT = 0.9;
/** The sky's hash: three multipliers to spread a cell's whole numbers, two to mix them. */
const HASH = [1664525, 22695477, 2654435761, 2246822519, 3266489917];

/** Three whole numbers to 0 to 1, the twin of the dome's GLSL `hash`, of which the stars and the dither are made. */
export function skyHash(x: number, y: number, z: number): number {
  let h = (Math.imul(x, HASH[0]!) + Math.imul(y, HASH[1]!) + Math.imul(z, HASH[2]!)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), HASH[3]!) >>> 0;
  h = Math.imul(h ^ (h >>> 13), HASH[4]!) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/**
 * The moon's light on the clouds, times its luminance: silver-blue and lifted as the night key lifts its sky against
 * its card, so moonlit cloud reads as the art director's light.py has it. The sky's light from straight up, times
 * this, fills a cloud where the light does not get through.
 */
const MOON_ON_CLOUDS = [3, 4.2, 6.6];
const CLOUD_FILL = 0.6;
/**
 * How the low layer's tiles are broken up: a second read turned `turn` radians and moved `at`; a third, soft read at
 * `scale`, turned `chooser` and moved `chooserAt`, that says which of the two has the sky, over a cover of `soft`
 * either side of the mean; and how the other is worn there: `wear` times how far it has lost, less `spare`, up to
 * `most`, sparing parts as thick as 1 / `keep`. Measured over the picture tiled, its mean cover stays the art director's.
 */
export const BREAK = { turn: 0.925, at: [0.41, 0.17], scale: 0.31, chooser: 1.573, chooserAt: [0.73, 0.29], soft: 0.15, wear: 6, spare: 0.3, most: 2.5, keep: 1.2 };
/** Seen between `from` and `to` degrees up, a heap shows its side: its thickness `reach` metres nearer and farther, times `gain`, lights its top and shades its base. */
const SIDES = { from: 4, to: 22, reach: 250, gain: 5 };
/** Metres of the clear air above the haze over which a cloud's light falls by e. */
const CLEAR_AIR = 40000;
/**
 * The low layer far off: past `from` metres it is read softer, by `blur` steps of the picture each time the distance
 * doubles, and worn down toward its thickest by `to` metres, `wear` as BREAK wears it; and it thins into the haze from
 * `thin` degrees up to nothing at `lowest`.
 */
const FAR = { from: 2800, to: 11000, blur: 1.2, wear: 2, thin: 9, lowest: 1.5 };
/**
 * How the high layer is read where it is seen along its fibres, which run `axis` degrees above its picture's x. There
 * the view draws them shorter than across, so their crossings crowd into rungs; the layer is read drawn out along them
 * instead, `taps` reads either side `step` metres apart weighted as a bell `spread` metres wide, no sharper than a
 * texel of 125 m. It is drawn out fully where a step along the fibres looks `full` as long as one across them, and not
 * at all where it looks as long, so overhead the picture is as it is.
 */
const STREAK = { axis: 21.9, taps: 8, step: 150, spread: 500, full: 0.6 };
const STREAK_STEP = [Math.cos(STREAK.axis * DEG), -Math.sin(STREAK.axis * DEG)].map((c) => (c * STREAK.step) / HIGH.span);
const bell = Array.from({ length: STREAK.taps + 1 }, (_, k) => Math.exp(-((k * STREAK.step) ** 2) / (2 * STREAK.spread ** 2)));
const STREAK_W = bell.map((w) => w / (2 * bell.reduce((a, b) => a + b, 0) - bell[0]!));

/**
 * How a cloud is lit, number for number the art director's light.py: light passing through it by its optical depth;
 * with the light low, its base and sides lit from under the layer, brighter on the side away from the light; seen low,
 * its sunlit sides more than its base; a bright rim toward the light where it is thin; the sky's light filling it,
 * which with the light low is the sky's own colour behind it, `lift` of it, so a cloud sits in a pale dawn as at sunset.
 */
export const SHADE = {
  pass: 0.32,
  lowSun: 9,
  under: [0.6, 0.1, 0.15],
  facing: [0.4, 0.6],
  below: 25,
  belowPower: 0.7,
  sides: 0.9,
  direct: 0.95,
  forward: 0.7,
  rim: [0.65, 0.35, 0.9, 3, 0.15],
  rimLow: [0.55, 0.6],
  fill: [0.9, 0.35],
  lift: 0.9,
};

/** What the dome's vertex text works out once a frame for its clouds (SKY_VERTEX). Colours are light after exposure. */
export interface CloudLights {
  /** The light on them: the sun as the low layer sees it, the moon, and the sky. */
  light: number[];
  /** The sky's light from straight up, filling them where the light does not get through. */
  fill: number[];
  /** The way the stronger of the sun and moon lies, and how much the slope toward it counts. */
  way: number[];
  relief: number;
}

const luma = (c: Vec): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const zenith = [0, 0, 0];

/** The clouds' light from a frame block, `table` the sky table and `sun` fTrueSun: the twin of SKY_VERTEX's. */
export function cloudLights(frame: Float32Array, table: Uint8Array, sun: Vec): CloudLights {
  const e = frame[FRAME.exposure]!;
  const at = (k: number, from: number): number => frame[from + k]! * e;
  const sunLight = [0, 1, 2].map((k) => at(k, FRAME.cloudSun));
  const moon = luma([0, 1, 2].map((k) => at(k, FRAME.moonColor)));
  const moonLight = MOON_ON_CLOUDS.map((m) => m * moon);
  const w = luma(sunLight) / Math.max(luma(sunLight) + luma(moonLight), 1e-9);
  domeLight(table, sun, [0, 1, 0], zenith);
  const way = w >= 0.5 ? FRAME.sun : FRAME.moon;
  return {
    light: [0, 1, 2].map((k) => sunLight[k]! + moonLight[k]! + at(k, FRAME.skyAbove)),
    fill: zenith.map((z) => z * frame[FRAME.skyScale]! * CLOUD_FILL * e),
    way: [frame[way]!, frame[way + 1]!, frame[way + 2]!],
    relief: Math.abs(2 * w - 1),
  };
}

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * The low layer's cover and thickness at (u, v), in tiles, once its tiles are broken up: the twin of the GLSL.
 * `read(u, v, side)` gives the picture's cover and thickness there, from its picture `side` pixels across.
 */
export function brokenRead(read: (u: number, v: number, side: number) => readonly number[], u: number, v: number, side: number): [number, number] {
  const b = BREAK;
  const a = read(u, v, side);
  const c = Math.cos(b.turn), s = Math.sin(b.turn);
  const o = read(c * u - s * v + b.at[0]!, s * u + c * v + b.at[1]!, side);
  const cc = Math.cos(b.chooser), sc = Math.sin(b.chooser);
  const m = read((cc * u - sc * v) * b.scale + b.chooserAt[0]!, (sc * u + cc * v) * b.scale + b.chooserAt[1]!, 32)[0]!;
  const w = smooth((m - 0.25) / b.soft + 0.5);
  const worn = (r: readonly number[], e: number): number => Math.max(0, Math.min(1, r[0]! - Math.max(0, Math.min(b.most, e)) * (1 - Math.min(r[1]! * b.keep, 1))));
  const ka = worn(a, b.wear * w - b.spare);
  const kb = worn(o, b.wear * (1 - w) - b.spare);
  return kb > ka ? [kb, o[1]!] : [ka, a[1]!];
}

const hg = (c: number, g: number): number => (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);

/**
 * A cloud's light after exposure, seen along `d`: `thick` is how thick it is, 0 to 1, and `depth` the optical depth of
 * its layer's thickest; `relief` is its slope toward the light and `up` how far it shows its top, seen low; `behind` is the sky
 * behind it, after exposure. The twin of
 * the GLSL `cloudLit`.
 */
export function cloudLit(out: Out, thick: number, depth: number, relief: number, up: number, d: Vec, behind: Vec, l: CloudLights): void {
  const s = SHADE;
  const tau = thick * depth;
  const [wx, wy, wz] = l.way as [number, number, number];
  const side = Math.hypot(wx, wz);
  const low = Math.exp(-Math.max(wy, 0) * s.lowSun);
  const flat = Math.hypot(d[0]! + 1e-9, d[2]! + 1e-9);
  const facing = side > 0.001 ? 0.5 - (0.5 * ((d[0]! + 1e-9) * wx + (d[2]! + 1e-9) * wz)) / (flat * side) : 0.5;
  const below = Math.pow(Math.max(0, Math.min(1, d[1]! / Math.sin(s.below * DEG))), s.belowPower);
  const through = (1 / (1 + s.pass * tau)) * below + s.sides * (1 - below);
  const direct = (1 - low) * through + low * (s.under[0]! * Math.exp(-s.under[1]! * tau) + s.under[2]!) * (s.facing[0]! + s.facing[1]! * facing);
  const rim = (s.rim[0]! * hg(d[0]! * wx + d[1]! * wy + d[2]! * wz, s.forward) + s.rim[1]!) * Math.exp(-s.rim[2]! * tau) * (1 - Math.exp(-s.rim[3]! * tau - s.rim[4]!));
  const lit = s.direct * direct * (1 + relief) * (1 + up) + (s.rimLow[0]! + s.rimLow[1]! * low) * rim;
  for (let k = 0; k < 3; k++) out[k] = l.light[k]! * lit + (l.fill[k]! * (1 - low) + behind[k]! * s.lift * low) * (s.fill[0]! - s.fill[1]! * thick);
}
/** Exposures between which the stars come in: the sun about 8 and 12 degrees down. */
const STARS_FROM = 2500;
const STARS_TO = 60000;
/** The sun's path leans this far toward +Z (sky.ts), and the stars turn about the pole it makes. */
const TILT = Math.atan(0.43);

/** The sky's vertex text: one triangle over the screen, the view's ray through each corner, and what is the same over the whole dome this frame. */
export const SKY_VERTEX = `#version 300 es
uniform mat4 uViewProj;
${FRAME_BLOCK}${skyFromGlsl(SKY_GLSL)}out vec3 vRay;
flat out vec3 vLight, vAmbient, vWay, vSunDisc;
flat out float vRelief, vStars;
flat out vec2 vTurn;
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vRay = inverse(mat3(uViewProj[0].xyw, uViewProj[1].xyw, uViewProj[2].xyw)) * vec3(at, 1.0);
  gl_Position = vec4(at, 1.0, 1.0);
  // The clouds are lit by the sun as they see it and the moon, with the sky's light, from the way of the stronger.
  // The slope toward the light fades out where the two are even, which is where the way changes.
  vec3 sun = fCloudSun.rgb * fSunColor.w, moon = luma(fMoonColor.rgb) * vec3(${MOON_ON_CLOUDS.map(g).join(", ")}) * fSunColor.w;
  float w = luma(sun) / max(luma(sun) + luma(moon), 1e-9);
  vLight = sun + moon + fSkyAbove.rgb * fSunColor.w;
  vWay = w >= 0.5 ? fSun.xyz : fMoon.xyz;
  vRelief = abs(2.0 * w - 1.0);
  vAmbient = skyFrom(vec3(0.0, 1.0, 0.0)) * ${g(CLOUD_FILL)} * fSunColor.w;
  vSunDisc = fSunColor.rgb / max(luma(fSunColor.rgb), 1e-9);
  vStars = clamp(log2(fSunColor.w / ${g(STARS_FROM)}) / ${g(Math.log2(STARS_TO / STARS_FROM))}, 0.0, 1.0);
  // How far the sun has gone round the pole since it rose: the stars turn with it.
  vec3 s = fTrueSun;
  float turn = atan(dot(s, vec3(0.0, ${g(Math.cos(TILT))}, ${g(Math.sin(TILT))})), -s.x);
  vTurn = vec2(cos(turn), sin(turn));
}`;

/** The layers' pictures are masks: a picture that has not come reads as 0, no cloud. */
const read = "rg";

/** The sky's fragment text: the table in the view's direction, and over it the stars, the moon, the sun and the clouds, shown with half a step of dither (none into a light target, whose finish dithers). */
export const SKY_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRay;
flat in vec3 vLight, vAmbient, vWay, vSunDisc;
flat in float vRelief, vStars;
flat in vec2 vTurn;
uniform sampler2D uMoon, uLow, uHigh;
out vec4 o;
${LIGHT}${AIR}
float hash(uvec3 v) {
  uint h = v.x * ${HASH[0]}u + v.y * ${HASH[1]}u + v.z * ${HASH[2]}u;
  h = (h ^ (h >> 15u)) * ${HASH[3]}u;
  h = (h ^ (h >> 13u)) * ${HASH[4]}u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
float hg(float c, float g) {
  return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}
// Metres along a ray that climbs dy a metre to a shell 'above' metres over the eye, on a round earth.
float shell(float dy, float above) {
  float r = ${g(EARTH)} + fHaze.z;
  float c = above * (2.0 * r + above);
  float b = r * dy;
  return b >= 0.0 ? c / (b + sqrt(b * b + c)) : sqrt(b * b + c) - b;
}
// Stars on a grid of directions in the sky's own frame, which turns about the pole once a day. 'px' is a pixel's angle.
vec3 stars(vec3 d, float px) {
  vec3 q = vec3(-d.x, dot(d, vec3(0.0, ${g(Math.cos(TILT))}, ${g(Math.sin(TILT))})), dot(d, vec3(0.0, ${g(Math.sin(TILT))}, ${g(-Math.cos(TILT))})));
  q.xy = vec2(vTurn.x * q.x + vTurn.y * q.y, vTurn.x * q.y - vTurn.y * q.x);
  vec3 a = abs(q);
  float face;
  vec2 f;
  if (a.x >= a.y && a.x >= a.z) { f = q.yz / a.x; face = q.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { f = q.xz / a.y; face = q.y > 0.0 ? 2.0 : 3.0; }
  else { f = q.xy / a.z; face = q.z > 0.0 ? 4.0 : 5.0; }
  vec2 cell = (f * 0.5 + 0.5) * ${g(STAR_CELLS)};
  vec2 c = floor(cell);
  uvec3 n = uvec3(uvec2(c), uint(face));
  float h = hash(n);
  if (h > ${g(STAR_SHARE)}) return vec3(0.0);
  h /= ${g(STAR_SHARE)};
  vec2 at = c + 0.25 + 0.5 * vec2(hash(n + 7u), hash(n + 13u));
  float r = length(cell - at) * ${g(2 / STAR_CELLS)} / (1.0 + dot(f, f));
  float size = max(px * 0.8, 1e-5);
  float bright = ${g(STAR_BRIGHT)} * pow(h, 10.0) * vStars * smoothstep(0.0, 0.2, d.y);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(n + 21u));
  return tint * bright * exp(-r * r / (size * size));
}
// A glow about a disc of radius r, 'a' radians from its middle: two falls, each a brightness at the limb and degrees.
float glow(float a, float r, vec4 g) {
  float out_ = max(a - r, 0.0) * ${g(1 / DEG)};
  return g.x * exp(-out_ / g.y) + g.z * exp(-out_ / g.w);
}
// The sun's disc, darker at its limb, and the moon's face, each with its glow and cut by the horizon. Past glowReach
// of each its glow is under GLOW_LEAST, and none of it is worked out. 'dx' and 'dy' are the ray's derivatives.
vec3 discs(vec3 d, float px, vec3 dx, vec3 dy) {
  float above = smoothstep(-px, px, d.y);
  vec3 s = fTrueSun;
  vec3 c = vec3(0.0);
  if (dot(d, s) > ${g(Math.cos(glowReach(SUN_RADIUS, SUN_GLOW) * DEG))}) {
    float a = atan(length(cross(d, s)), dot(d, s));
    float r = ${g(SUN_RADIUS * DEG)};
    float x = min(a / r, 1.0);
    c = vSunDisc * ${g(SUN_BRIGHT)} * (1.0 - ${g(LIMB)} * (1.0 - sqrt(1.0 - x * x))) * smoothstep(r + px, r - px, a) + mix(vSunDisc, vec3(1.0), 0.6) * glow(a, r, vec4(${SUN_GLOW.map(g).join(", ")}));
  }
  vec3 m = fMoon.xyz;
  if (dot(d, m) > ${g(Math.cos(glowReach(MOON_RADIUS, MOON_GLOW) * DEG))}) {
    float b = atan(length(cross(d, m)), dot(d, m));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), m));
    vec3 up = cross(m, right);
    vec2 uv = vec2(dot(d, right), dot(d, up)) / ${g(Math.sin(MOON_RADIUS * DEG))};
    float pxUv = px / ${g(Math.sin(MOON_RADIUS * DEG))};
    float on = smoothstep(1.0 + pxUv, 1.0 - pxUv, length(uv)) * step(0.0, dot(d, m));
    vec2 du = vec2(dot(dx, right), dot(dx, up)) * ${g(0.5 / Math.sin(MOON_RADIUS * DEG))}, dv = vec2(dot(dy, right), dot(dy, up)) * ${g(0.5 / Math.sin(MOON_RADIUS * DEG))};
    vec3 face = textureGrad(uMoon, uv * vec2(0.5, -0.5) + 0.5, du, dv).rgb;
    c += face * vec3(${MOON_TINT.map(g).join(", ")}) * ${g(MOON_BRIGHT)} * on + vec3(${HALO_TINT.map(g).join(", ")}) * glow(b, ${g(MOON_RADIUS * DEG)}, vec4(${MOON_GLOW.map(g).join(", ")})) * (1.0 - on);
  }
  return c * above;
}
// The twin of cloudLit in atmosphere.ts.
vec3 cloudLit(float thick, float depth, float relief, float up, vec3 d, vec3 behind) {
  float tau = thick * depth;
  vec3 way = vWay;
  float side = length(way.xz);
  float low = exp(-max(way.y, 0.0) * ${g(SHADE.lowSun)});
  vec3 fill = mix(vAmbient, behind * ${g(SHADE.lift)}, low);
  float facing = side > 0.001 ? 0.5 - 0.5 * dot(normalize(d.xz + 1e-9), way.xz / side) : 0.5;
  float below = pow(clamp(d.y / ${g(Math.sin(SHADE.below * DEG))}, 0.0, 1.0), ${g(SHADE.belowPower)});
  float through = 1.0 / (1.0 + ${g(SHADE.pass)} * tau) * below + ${g(SHADE.sides)} * (1.0 - below);
  float direct = (1.0 - low) * through + low * (${g(SHADE.under[0]!)} * exp(-${g(SHADE.under[1]!)} * tau) + ${g(SHADE.under[2]!)}) * (${g(SHADE.facing[0]!)} + ${g(SHADE.facing[1]!)} * facing);
  float rim = (${g(SHADE.rim[0]!)} * hg(dot(d, way), ${g(SHADE.forward)}) + ${g(SHADE.rim[1]!)}) * exp(-${g(SHADE.rim[2]!)} * tau) * (1.0 - exp(-${g(SHADE.rim[3]!)} * tau - ${g(SHADE.rim[4]!)}));
  return vLight * (${g(SHADE.direct)} * direct * (1.0 + relief) * (1.0 + up) + (${g(SHADE.rimLow[0]!)} + ${g(SHADE.rimLow[1]!)} * low) * rim) + fill * (${g(SHADE.fill[0]!)} - ${g(SHADE.fill[1]!)} * thick);
}
// A read's cover worn down by e: its thin parts go first and its thickest last, and their edges stay frayed.
float worn(vec2 s, float e) {
  return clamp(s.x - e * (1.0 - min(s.y * ${g(BREAK.keep)}, 1.0)), 0.0, 1.0);
}
// The picture read drawn out 'along' its fibres either side, at lod 'l'.
vec2 drawn(sampler2D map, vec2 uv, vec2 along, float l) {
  vec2 s = ${g(STREAK_W[0]!)} * textureLod(map, uv, l).${read};
${STREAK_W.slice(1).map((w, k) => `  s += ${g(w)} * (textureLod(map, uv + ${g(k + 1)} * along, l).${read} + textureLod(map, uv - ${g(k + 1)} * along, l).${read});`).join("\n")}
  return s;
}
// One layer at 'shape' (metres up, metres a tile, optical depth, metres its slope is read over), its tile moved by
// 'at', in front of 'behind': its colour and how much of the sky it hides. A 'heaped' layer's tiles
// are broken up, and seen low its heaps show their sides.
vec4 layer(sampler2D map, vec3 d, vec3 behind, vec4 shape, vec2 at, bool heaped) {
  float base = shape.x - fHaze.z;
  float t = shell(d.y, base);
  vec2 way2 = vec2(-d.x, d.z) / shape.y;
  vec2 uv = way2 * t + at;
  float size = float(textureSize(map, 0).x);
  float lod = log2(max(max(length(dFdx(uv)), length(dFdy(uv))) * size, 1e-6));
  // Far heaped cloud is read softer, so distance takes its small scraps first.
  if (heaped) lod += ${g(FAR.blur)} * max(log2(t / ${g(FAR.from)}), 0.0);
  vec2 s = textureLod(map, uv, lod).${read};
  // The slope the light finds is read no sharper than a texel of 125 m.
  float coarse = max(lod, log2(size) - 8.0);
  // A streak layer seen along its fibres is read drawn out along them, and so is its slope, so that a band seen end on
  // shows no rungs across it; only where there is cloud within reach, by the picture's mean over about 3 km.
  vec2 along = vec2(0.0);
  float slod = lod;
  if (!heaped) {
    vec2 fibre = vec2(${g(-Math.cos(STREAK.axis * DEG))}, ${g(-Math.sin(STREAK.axis * DEG))});
    float a = dot(fibre, d.xz), b = dot(vec2(-fibre.y, fibre.x), d.xz);
    float looks = sqrt(max(1.0 - a * a, 0.0)) / max(sqrt(max(1.0 - b * b, 0.0)), 1e-3);
    float drawOut = 1.0 - smoothstep(${g(STREAK.full)}, 1.0, looks);
    if (drawOut > 0.01 && textureLod(map, uv, log2(size) - 3.5).x > 0.0) {
      along = drawOut * vec2(${STREAK_STEP.map(g).join(", ")});
      slod = mix(lod, coarse, drawOut);
      s = drawn(map, uv, along, slod);
    }
  }
  mat2 turn = mat2(1.0);
  if (heaped) {
    // The picture read twice, the second time turned and moved, and each worn down to its thickest where a soft
    // third read gives the sky to the other: so the heaps lie differently in every tile, and none is cut.
    mat2 turned = mat2(${g(Math.cos(BREAK.turn))}, ${g(Math.sin(BREAK.turn))}, ${g(-Math.sin(BREAK.turn))}, ${g(Math.cos(BREAK.turn))});
    vec2 other = turned * uv + vec2(${BREAK.at.map(g).join(", ")});
    vec2 b = textureLod(map, other, lod).${read};
    float m = textureLod(map, mat2(${g(Math.cos(BREAK.chooser))}, ${g(Math.sin(BREAK.chooser))}, ${g(-Math.sin(BREAK.chooser))}, ${g(Math.cos(BREAK.chooser))}) * uv * ${g(BREAK.scale)} + vec2(${BREAK.chooserAt.map(g).join(", ")}), log2(size) - 5.0).x;
    float w = smoothstep(0.0, 1.0, clamp((m - 0.25) / ${g(BREAK.soft)} + 0.5, 0.0, 1.0));
    float ka = worn(s, clamp(${g(BREAK.wear)} * w - ${g(BREAK.spare)}, 0.0, ${g(BREAK.most)}));
    float kb = worn(b, clamp(${g(BREAK.wear)} * (1.0 - w) - ${g(BREAK.spare)}, 0.0, ${g(BREAK.most)}));
    if (kb > ka) {
      s = vec2(kb, b.y);
      uv = other;
      turn = turned;
    } else s.x = ka;
    // Far off it is worn down to its thickest, a few soft masses in the haze, and it thins into the haze low down.
    s.x = worn(s, ${g(FAR.wear)} * smoothstep(${g(FAR.from)}, ${g(FAR.to)}, t)) * smoothstep(${g(Math.sin(FAR.lowest * DEG))}, ${g(Math.sin(FAR.thin * DEG))}, d.y);
  }
  float cover = s.x * clamp(d.y / ${g(Math.sin(1.5 * DEG))}, 0.0, 1.0);
  if (cover < 0.002) return vec4(0.0);
  vec3 way = vWay;
  float side = length(way.xz);
  float relief = 0.0;
  if (side > 0.001) {
    vec2 toward = turn * vec2(-way.x, way.z) / side * (shape.w / shape.y);
    vec2 here, there;
    if (along == vec2(0.0)) {
      here = textureLod(map, uv, coarse).${read};
      there = textureLod(map, uv + toward, coarse).${read};
    } else {
      here = s;
      there = drawn(map, uv + toward, along, slod);
    }
    relief = clamp((here.y - there.y) * 3.5 * side, -0.7, 0.7) * vRelief;
  }
  // Seen low, a heap shows its side: where it thins away from the eye reads as its top, lit from above, and where it
  // thickens away as its base.
  float up = 0.0;
  float seen = heaped ? 1.0 - smoothstep(${g(Math.sin(SIDES.from * DEG))}, ${g(Math.sin(SIDES.to * DEG))}, d.y) : 0.0;
  if (seen > 0.0) {
    vec2 away = turn * normalize(way2) * (${g(SIDES.reach)} / shape.y);
    float nearer = textureLod(map, uv - away, coarse).y, farther = textureLod(map, uv + away, coarse).y;
    up = clamp((nearer - farther) * ${g(SIDES.gain)}, -0.6, 0.6) * seen;
  }
  vec3 c = cloudLit(s.y, shape.z, relief, up, d, behind);
  // The haze between, and the clear air above it, which fades cloud many kilometres off.
  return vec4(mix(behind, c, (1.0 - hazeAmount(t, d.y)) * exp(-t / ${g(CLEAR_AIR)})), cover);
}
// The storm over an instrument is the low layer's heaped cloud, lit as the layer is (tide-eye.ts eyeStorm).
#define EYE_LIT
#define EYE_PICTURE
#define EYE_WAY vWay
#define EYE_RELIEF vRelief
vec3 eyeCloudLit(float thick, float relief, vec3 d, vec3 behind) {
  return cloudLit(thick, ${g(STORM_DEPTH)}, relief, 0.0, d, behind);
}
${EYE_SKY_GLSL}${DROP_SKY_GLSL}
void main() {
  vec3 d = normalize(vRay);
  if (fHaze.z < 0.0) {
    o = vec4(fogShown(), 1.0);
    return;
  }
  vec3 behind = skyFrom(d) * fSunColor.w;
  vec4 optics = eyeOptics(d, behind);
  vec3 c = behind;
  if (fHaze.w > 0.0) {
    vec3 dx = dFdx(d), dy = dFdy(d);
    float px = length(dx) + length(dy);
    if (vStars > 0.0) c += stars(d, px * 0.7);
    c += discs(d, px * 0.7, dx, dy);
    if (fHaze.w > 2.5 && textureSize(uHigh, 0).x >= ${LAYER_SMALLEST}) {
      vec4 high = layer(uHigh, d, behind, vec4(${g(HIGH.height)}, ${g(HIGH.span)}, ${g(HIGH.depth)}, ${g(HIGH.step)}), fClouds.zw, false);
      c = mix(c, high.rgb, high.a);
    }
    c = c * optics.a + optics.rgb;
    if (fHaze.w > 1.5 && textureSize(uLow, 0).x >= ${LAYER_SMALLEST}) {
      vec4 low = layer(uLow, d, behind, vec4(${g(LOW.height)}, ${g(LOW.span)}, ${g(LOW.depth)}, ${g(LOW.step)}), fClouds.xy, true);
      c = mix(c, low.rgb + 0.16 * optics.rgb, low.a);
    }
  }
  if (fHaze.w <= 0.) c = c * optics.a + optics.rgb;
  // A supply drop's cast crossing the sky, over the clouds: it is light, and nothing of the sky hides it.
  c += dropStreaks(d, length(fwidth(d)));
  // In a visor's heat view the sky is the coldest there is (D1081).
  if (fOptic.x > 1.5) c = vec3(0.0);
  o = vec4(display(c) + (hash(uvec3(gl_FragCoord.xy, 3u)) - 0.5) * SHOWN_STEP * min(fHaze.w, 1.0), 1.0);
}`;
