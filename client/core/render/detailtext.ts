// The texts small details are drawn with (packet.ts DRAW_DETAILS), and their twins for the rasterizer. A particle is a
// card of two triangles about its middle, its half axes along and across it, drawn from the vertex's index. On a lit tier
// its picture comes from the details atlas on unit 15, which is bound for these draws alone, and is lit as a rough card
// two-sided toward the eye, or as a puff of something, in the sun's shadow and the air. Low poly reads no picture: it
// draws each particle's flat shape, lit as FLAT lights and fogged. A cut-out draw takes coverage from alpha and drops
// pixels by the far fade's ordered pattern as a particle goes; a see-through one fades near the ground under it.

import { CELL } from "../../../shared/pack/details.ts";
import { AIR } from "./atmosphere.ts";
import { FADE_ORDER } from "./hand.ts";
import { DETAIL_LIT, DETAIL_PUFF, DETAIL_ROTOR } from "./packet.ts";
import { AMBIENT, DIFFUSE } from "./shading.ts";
import { SHADOW_GLSL } from "./shadowtext.ts";
import { LIGHT } from "./surface.ts";

const f = (n: number): string => n.toFixed(4);

/** The finest mip a picture is read at is the cell's side over this, so no read takes in a neighbouring cell. */
export const SMALLEST_READ = 4;
/** The highest mip level the atlas is read at, for its side of CELL pixels a cell. */
export const MOST_LOD = Math.log2(CELL / SMALLEST_READ);

export const DETAIL_VERTEX = `#version 300 es
layout(location=0) in vec3 iMiddle;
layout(location=1) in vec3 iAlong;
layout(location=2) in vec3 iAcross;
layout(location=3) in float iFloor;
layout(location=4) in vec4 iA;
layout(location=5) in vec4 iB;
layout(location=6) in uvec4 iMisc;
uniform mat4 uViewProj;
uniform float uCells;
out vec3 vRel;
out vec2 vUv, vCorner;
flat out vec3 vA, vB, vNormal;
flat out float vShows, vGrey, vFloor, vHalf;
flat out uint vFlags;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 p = iMiddle + c.x * iAcross + c.y * iAlong;
  float cell = float(iMisc.x);
  vUv = (vec2(mod(cell, uCells), floor(cell / uCells)) + vec2(c.x, -c.y) * 0.5 + 0.5) / uCells;
  vRel = p;
  vCorner = c;
  vA = iA.rgb;
  vB = iB.rgb;
  vNormal = normalize(cross(iAcross, iAlong));
  vShows = float(iMisc.z) / 255.0;
  vGrey = float(iMisc.w) / 255.0;
  vFloor = iFloor;
  vHalf = length(iAlong);
  vFlags = iMisc.y;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

/**
 * Low poly's shapes, by the flat shape a picture names (shared/pack/details.ts FLAT_SHAPES), at a corner (x across, y
 * along, each -1 to 1): how much shows, the share of the second colour, and the shade. Twin of `shapeOf`.
 */
const SHAPES = `vec3 shapeOf(uint shape, vec2 c) {
  float r = length(c);
  if (shape == 0u) {
    float t = c.y * 0.5 + 0.5;
    float vane = t < 0.12 ? 0.0 : 0.88 * sqrt(max(0.0, 1.0 - pow((t - 0.56) / 0.44, 2.0)));
    float w = max(vane, t < 0.3 ? 0.07 : 0.0);
    float edge = abs(c.x);
    return vec3(clamp((w - edge) / 0.12 + 0.5, 0.0, 1.0), step(0.84, t), edge < 0.05 ? 1.12 : 1.0 - 0.3 * edge / max(w, 0.01));
  }
  if (shape == 1u) {
    float lump = 0.08 * sin(5.0 * atan(c.y, c.x) + 1.3);
    float a = clamp((0.92 + lump - r) / 0.5, 0.0, 1.0);
    return vec3(a * a, 0.0, 0.88 + 0.12 * c.y);
  }
  if (shape == 2u) return vec3(clamp((0.9 - r) / 0.15, 0.0, 1.0), 0.0, 0.92 + 0.35 * max(0.0, 1.0 - length(c - vec2(-0.3, 0.35)) * 2.5));
  if (shape == 3u) return vec3(clamp(1.0 - abs(r - 0.78) / 0.14, 0.0, 1.0), 0.0, 1.0);
  float a = 0.0;
  for (int k = 0; k < 5; k++) {
    float s = float(k) * 1.37 + 0.4;
    a = max(a, clamp((0.2 - length(c - 0.6 * vec2(cos(s * 2.3), sin(s * 3.1)))) / 0.06, 0.0, 1.0));
  }
  return vec3(a, 0.0, 0.85 + 0.15 * c.y);
}
`;

/** Whether a cut-out particle that shows this much keeps its pixel, by the far fade's pattern, and how much a see-through one shows by the ground. */
const KEEPS = `const float FADE_ORDER[16] = float[16](${FADE_ORDER.map((v) => v.toFixed(1)).join(", ")});
uniform float uBlend, uFrom;
float covers(float alpha) {
  if ((vFlags & ${DETAIL_ROTOR}u) != 0u && uBlend > 0.5 && 1.0 / gl_FragCoord.w + 0.5 * fwidth(1.0 / gl_FragCoord.w) < uFrom) discard;
  if (uBlend > 0.5) return alpha * vShows * ((vFlags & ${DETAIL_PUFF}u) != 0u ? clamp((vRel.y - vFloor) / (0.5 * vHalf), 0.0, 1.0) : 1.0);
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  if (vShows * 16.0 <= FADE_ORDER[q.y * 4 + q.x] + 0.5) return 0.0;
  return clamp((alpha - 0.5) / max(fwidth(alpha), 0.0001) + 0.5, 0.0, 1.0);
}
vec3 facing(vec3 v) {
  if ((vFlags & ${DETAIL_PUFF}u) != 0u) return normalize(vec3(0.0, 1.0, 0.0) + 0.6 * v);
  return dot(vNormal, v) < 0.0 ? -vNormal : vNormal;
}
`;

const INS = `in vec3 vRel;
in vec2 vUv, vCorner;
flat in vec3 vA, vB, vNormal;
flat in float vShows, vGrey, vFloor, vHalf;
flat in uint vFlags;
`;

/** Area coverage of blades swept around their axle: chord / circumference, with softened roots/tips. */
const ROTOR_SHAPE = `vec3 rotorOf(vec2 c, float density) {
  float r = length(c);
  float root = smoothstep(0.09, 0.17, r);
  float edge = 1.0 - smoothstep(0.975, 1.0, r);
  return vec3(min(0.65, density / max(r, 0.12)) * root * edge, smoothstep(0.91, 0.94, r), 1.0);
}
`;

export const DETAIL_FLAT_FRAGMENT = `#version 300 es
precision highp float;
${INS}uniform vec3 uSun, uSky;
uniform vec2 uFog;
uniform float uLight;
out vec4 o;
${SHAPES}${ROTOR_SHAPE}${KEEPS}void main() {
  vec3 s = (vFlags & ${DETAIL_ROTOR}u) != 0u ? rotorOf(vCorner, vGrey) : shapeOf(vFlags & 7u, vCorner);
  float a = covers(s.x);
  if (a < 0.004) discard;
  vec3 n = facing(-normalize(vRel));
  float light = (vFlags & ${DETAIL_LIT}u) != 0u ? (${f(AMBIENT)} + ${f(DIFFUSE)} * max(dot(n, uSun), 0.0)) * uLight : 1.0;
  float d = length(vRel);
  float fog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = vec4(mix(mix(vA, vB, s.y) * s.z * light, uSky, fog * fog), a);
}`;

export const DETAIL_LIT_FRAGMENT = `#version 300 es
precision highp float;
${INS}uniform sampler2D uDetails;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${AIR}${ROTOR_SHAPE}${KEEPS}vec3 linear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  bool rotor = (vFlags & ${DETAIL_ROTOR}u) != 0u;
  vec3 s = rotorOf(vCorner, vGrey);
  vec4 t = rotor ? vec4(s.z, s.y, 0.0, s.x) : texture(uDetails, vUv);
  float a = covers(t.a);
  if (a < 0.004) discard;
  vec3 v = -normalize(vRel);
  vec3 n = facing(v);
  vec3 albedo = linear(vec3(t.r)) * mix(mix(linear(vA), linear(vB), t.g) / (rotor ? 1.0 : vGrey), vec3(1.0), t.b);
  vec3 light = (vFlags & ${DETAIL_LIT}u) != 0u ? lit(albedo, vec3(1.0, 1.0, 0.0), n, v, vec3(0.0), sunShadow(vRel, n)) : albedo / fSunColor.w;
  o = vec4(shown(light, vRel), a);
}`;

/** `rotorOf`'s twin. The result is alpha, tip paint share, shade; it is independent of angular phase/display FPS. */
export function rotorOf(x: number, y: number, density: number, out: Float64Array | number[]): void {
  const r = Math.hypot(x, y);
  const ease = (a: number, b: number) => { const t = Math.max(0, Math.min(1, (r - a) / (b - a))); return t * t * (3 - 2 * t); };
  [out[0], out[1], out[2]] = [Math.min(.65, density / Math.max(r, .12)) * ease(.09, .17) * (1 - ease(.975, 1)), ease(.91, .94), 1];
}

/** `shapeOf`'s twin: how much of a flat shape shows at corner (x, y), the share of the second colour, and the shade. */
export function shapeOf(shape: number, x: number, y: number, out: Float64Array | number[]): void {
  const r = Math.hypot(x, y);
  const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (shape === 0) {
    const t = y * 0.5 + 0.5;
    const vane = t < 0.12 ? 0 : 0.88 * Math.sqrt(Math.max(0, 1 - ((t - 0.56) / 0.44) ** 2));
    const w = Math.max(vane, t < 0.3 ? 0.07 : 0);
    const edge = Math.abs(x);
    [out[0], out[1], out[2]] = [clamp((w - edge) / 0.12 + 0.5), t >= 0.84 ? 1 : 0, edge < 0.05 ? 1.12 : 1 - (0.3 * edge) / Math.max(w, 0.01)];
  } else if (shape === 1) {
    const lump = 0.08 * Math.sin(5 * Math.atan2(y, x) + 1.3);
    const a = clamp((0.92 + lump - r) / 0.5);
    [out[0], out[1], out[2]] = [a * a, 0, 0.88 + 0.12 * y];
  } else if (shape === 2) [out[0], out[1], out[2]] = [clamp((0.9 - r) / 0.15), 0, 0.92 + 0.35 * Math.max(0, 1 - Math.hypot(x + 0.3, y - 0.35) * 2.5)];
  else if (shape === 3) [out[0], out[1], out[2]] = [clamp(1 - Math.abs(r - 0.78) / 0.14), 0, 1];
  else {
    let a = 0;
    for (let k = 0; k < 5; k++) {
      const s = k * 1.37 + 0.4;
      a = Math.max(a, clamp((0.2 - Math.hypot(x - 0.6 * Math.cos(s * 2.3), y - 0.6 * Math.sin(s * 3.1))) / 0.06));
    }
    [out[0], out[1], out[2]] = [a, 0, 0.85 + 0.15 * y];
  }
}

/** Whether a cut-out particle that shows `shows` keeps window pixel (x, y), counted from the bottom left. KEEPS's twin. */
export function detailKeeps(shows: number, x: number, y: number): boolean {
  return shows * 16 > FADE_ORDER[(y & 3) * 4 + (x & 3)]! + 0.5;
}
