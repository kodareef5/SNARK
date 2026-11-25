// The texts small details are drawn with (packet.ts DRAW_DETAILS), and their twins for the rasterizer. A particle is a
// card of two triangles about its middle, its half axes along and across it, drawn from the vertex's index. On a lit tier
// its picture comes from the details atlas on unit 15, which is bound for these draws alone, and is lit as a rough card
// two-sided toward the eye, or as a puff of something, in the sun's shadow and the air. Low poly reads no picture: it
// draws each particle's flat shape, lit as FLAT lights and fogged. A cut-out draw takes coverage from alpha and drops
// pixels by the far fade's ordered pattern as a particle goes; a see-through one fades near the ground under it. What a
// see-through draw gives is its colour weighed by how much of it shows, which is how the card blends it (gl.ts `set`):
// so light with no surface (DETAIL_GLOW) is added over what is behind it, in the same draw as the dust that hides it.

import { STREET_GLSL } from "./street-finish.ts";
import { CELL } from "../../../shared/pack/details.ts";
import { AIR } from "./atmosphere.ts";
import { FADE_ORDER } from "./hand.ts";
import { FIRE_BLOOMS, UNGRADED } from "./fire-light.ts";
import { FIELD_COORDS_GLSL, RIPPLE_GLSL } from "./tek-ripple.ts";
import { DIGITS_GLSL } from "./digits.ts";
import { DETAIL_TEK, DETAIL_DIGITS, DETAIL_GLOW, DETAIL_SCORCH, DETAIL_SMOKE, FRAME_BLOCK, GLOW_STEPS, SMOKE_STEPS, DETAIL_TIRE, DETAIL_GLASS, DETAIL_LAMP, DETAIL_LIT, DETAIL_POOL, DETAIL_PUFF, DETAIL_ROTOR, DETAIL_SHADED_POOL, DETAIL_WAKE, DETAIL_WIRE, MAX_CONTACTS } from "./packet.ts";
import { POOL_ACROSS, POOL_UP, poolShadeGlsl } from "./lamp.ts";
import { AMBIENT, DIFFUSE } from "./shading.ts";
import { DEPTH_SLACK, SHADOW_GLSL } from "./shadowtext.ts";
import { LIGHT } from "./surface.ts";

const f = (n: number): string => n.toFixed(4);

/** The finest mip a picture is read at is the cell's side over this, so no read takes in a neighbouring cell. */
export const SMALLEST_READ = 4;
/** The highest mip level the atlas is read at, for its side of CELL pixels a cell. */
export const MOST_LOD = Math.log2(CELL / SMALLEST_READ);

/** One compared lookup a card of how much of the casting light reaches a puff of smoke's middle, for the tiers that are lit. */
const SMOKE_SHADE = `#ifdef SHADOW_CASCADES
${FRAME_BLOCK}uniform highp sampler2DArrayShadow uShadow;
uniform mediump int uCascades;
// How much of the light the cascades are cast from reaches a puff of smoke's middle: one compared lookup a card, in
// the nearest cascade that holds it, where a surface's pixel takes several.
float smokeShade(vec3 rel) {
  if (uCascades == 0 || fCast.w <= 0.0) return 1.0;
  int k = 0;
  float t = length(rel - fSpheres[0].xyz) / fSpheres[0].w;
  for (int i = 1; i < SHADOW_CASCADES; i++) {
    if (t < 1.0 || i >= uCascades) break;
    k = i;
    t = length(rel - fSpheres[i].xyz) / fSpheres[i].w;
  }
  if (t >= 1.0) return 1.0;
  vec3 at = (fCascades[k] * vec4(rel, 1.0)).xyz * 0.5 + 0.5;
  return mix(1.0, texture(uShadow, vec4(at.xy, float(k), at.z - ${f(DEPTH_SLACK)} / 65535.0)), fCast.w);
}
#endif
`;

/** The details' vertex text; `lit` has a puff of smoke's shadow looked up in it, once a card. */
const vertex = (lit: boolean): string => `#version 300 es
layout(location=0) in vec3 iMiddle;
layout(location=1) in vec3 iAlong;
layout(location=2) in vec3 iAcross;
layout(location=3) in float iFloor;
layout(location=4) in vec4 iA;
layout(location=5) in vec4 iB;
layout(location=6) in uvec4 iMisc;
uniform mat4 uViewProj;
uniform float uCells;
out vec3 vRel, vBulge;
out vec2 vUv, vCorner;
flat out vec3 vA, vB, vNormal, vLens;
flat out float vShows, vGrey, vFloor, vHalf, vShade;
flat out uint vFlags;
${lit ? SMOKE_SHADE : ""}${FIELD_COORDS_GLSL}void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  float width = iMisc.y == ${DETAIL_GLASS}u && c.y > 0.0 ? iFloor : 1.0;
  vec3 p = iMiddle + c.x * width * iAcross + c.y * iAlong;
  float cell = float(iMisc.x);
  vUv = (vec2(mod(cell, uCells), floor(cell / uCells)) + vec2(c.x, -c.y) * 0.5 + 0.5) / uCells;
  vRel = p;
  vCorner = c;
  vA = iA.rgb;
  vB = iB.rgb;
  // A shaded pool's lens, from where its second colour holds it from its middle (lamp.ts lensWord).
  vLens = iMiddle + (iB.rgb - vec3(0.5, 0.0, 0.5)) * vec3(${f(POOL_ACROSS)}, ${f(POOL_UP)}, ${f(POOL_ACROSS)});
  vNormal = normalize(cross(iAcross, iAlong));
  vShows = float(iMisc.z) / 255.0;
  vGrey = float(iMisc.w) / 255.0;
  vFloor = iFloor;
  vHalf = length(iAlong);
  vFlags = iMisc.y;
  // A puff bulges toward the eye: where a point of its card is across it and along it, and across alone for a length of rope.
  if (vFlags == ${DETAIL_TEK}u) {
    vBulge = vec3(fieldCoords(iA) + c * vec2(length(iAcross), vHalf), 0.0);
    vB.xy = fieldCoords(iB);
  } else vBulge = c.x * normalize(iAcross) + (iMisc.w > ${Math.round(1.5 * SMOKE_STEPS)}u ? 0.0 : c.y) * normalize(iAlong);
${lit ? `#ifdef SHADOW_CASCADES
  vShade = iMisc.y == ${DETAIL_SMOKE}u ? smokeShade(iMiddle) : 1.0;
#else
  vShade = 1.0;
#endif` : "  vShade = 1.0;"}
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
export const DETAIL_VERTEX = vertex(false);
export const DETAIL_LIT_VERTEX = vertex(true);

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
  if ((vFlags & ${DETAIL_ROTOR | DETAIL_LAMP | DETAIL_POOL}u) != 0u && uBlend > 0.5 && 1.0 / gl_FragCoord.w + 0.5 * fwidth(1.0 / gl_FragCoord.w) < uFrom) discard;
  if (uBlend > 0.5) return alpha * vShows * ((vFlags & ${DETAIL_PUFF}u) != 0u ? clamp((vRel.y - vFloor) / (0.5 * vHalf), 0.0, 1.0) : 1.0);
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  if (vShows * 16.0 <= FADE_ORDER[q.y * 4 + q.x] + 0.5) return 0.0;
  return clamp((alpha - 0.5) / max(fwidth(alpha), 0.0001) + 0.5, 0.0, 1.0);
}
vec3 facing(vec3 v) {
  if ((vFlags & ${DETAIL_PUFF}u) != 0u) return normalize(vec3(0.0, 1.0, 0.0) + 0.6 * v);
  return dot(vNormal, v) < 0.0 ? -vNormal : vNormal;
}
vec4 weighed(vec3 c, float a) {
  return vec4(uBlend > 0.5 ? c * a : c, a);
}
`;

const INS = `in vec3 vRel, vBulge;
in vec2 vUv, vCorner;
flat in vec3 vA, vB, vNormal;
flat in float vShows, vGrey, vFloor, vHalf, vShade;
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

/** Alpha and hot-core share across the face of an LED strip and its halo. Twin of lampOf below. */
const LAMP_SHAPE = `vec3 lampOf(vec2 c) {
  float r = length(vec2(max(0.0, abs(c.x) - 0.28) / 0.72, c.y));
  float halo = max(0.0, 1.0 - r);
  return vec3(max(1.0 - smoothstep(0.055, 0.34, r), 0.82 * halo * halo * halo), 1.0 - smoothstep(0.025, 0.16, r), 1.0);
}
`;

/**
 * Alpha across a street lamp's soft disc of light, falling off smoothly to nothing at its rim, or across a wire's width
 * (DETAIL_WIRE), soft at its edges. Twins of poolOf and wireOf below.
 */
const POOL_SHAPE = `vec3 poolOf(vec2 c) {
  float a = 1.0 - smoothstep(0.0, 1.0, length(c));
  return vec3(a * a, 0.0, 1.0);
}
vec3 wireOf(vec2 c) {
  return vec3(1.0 - smoothstep(0.35, 1.0, abs(c.y)), 0.0, 1.0);
}
vec3 wakeOf(vec2 c, float seed) {
  float phase=6.283185*seed;
  float spine=c.x-.30*sin(2.8*c.y+phase)-.12*sin(7.*c.y-2.*phase);
  float edge=1.-smoothstep(.48,1.,abs(c.y));
  float veil=1.-smoothstep(.06,.52,abs(spine));
  float lace=sin(8.*spine+1.9*sin(4.*c.y+phase))+.72*sin(10.*c.y+2.*phase);
  float holes=smoothstep(-.55,.8,lace);
  float fringe=(1.-smoothstep(.02,.18,abs(spine-.34)))*smoothstep(-.5,.7,sin(7.*c.y-phase));
  return vec3(edge*(veil*(.12+.73*holes)+.36*fringe),0.,.90+.10*holes);
}
vec3 smokeOf(vec2 c, float seed, float stretch, float torn) {
  float s = 6.2831853 * seed;
  float r, lump, puff = 1.0, rim = 0.82;
  if (stretch > 1.5) {
    float y = c.y * stretch;
    float x = c.x - 0.07 * sin(1.9 * y + s) - 0.04 * sin(4.3 * y + 2.3 * s);
    puff = abs(sin(1.15 * y + 1.7 * s + (x > 0.0 ? 1.6 : 0.0)));
    r = abs(x) / (0.42 + 0.3 * puff + 0.06 * sin(3.7 * y - s));
    r = 0.86 * max(r, (abs(c.y) - 1.0) * stretch + 1.0);
    lump = 0.5 + 0.5 * sin(2.6 * y + 2.1 * s) * sin(5.3 * c.x - 1.3 * s);
  } else {
    r = length(c + 0.17 * vec2(sin(3.9 * c.y + s), sin(3.3 * c.x + 1.7 * s)));
    lump = 0.5 + 0.5 * sin(5.3 * c.x + 2.1 * s) * sin(4.7 * c.y - 1.3 * s);
    rim = 0.6 + 0.2 * lump;
  }
  float a = (1.0 - smoothstep(0.3 + 0.22 * lump, rim, r)) * smoothstep(1.3 * torn - 0.24, 1.3 * torn, lump + 0.3 * (1.0 - r));
  return vec3(a, 0.0, 0.58 + 0.2 * lump + 0.22 * puff);
}
float scorchOf(vec2 c, float seed) {
  float s = 6.2831853 * seed;
  float r = length(c), t = atan(c.y, c.x);
  float soot = 1.0 - smoothstep(0.16, 0.5 + 0.12 * sin(3.1 * c.x + s) * sin(2.7 * c.y - s), r);
  float reach = 0.66 + 0.26 * sin(2.0 * t + 3.0 * s);
  float rays = smoothstep(0.7 + 0.29 * min(1.0, r / reach), 1.0, abs(sin(2.5 * t + s + 0.6 * sin(t + s)))) * (1.0 - smoothstep(0.5 * reach, reach, r));
  return max(soot, 0.7 * rays);
}
vec3 pooled(vec2 c) {
  if (vFlags == ${DETAIL_WAKE}u) return wakeOf(c,vGrey);
  if (vFlags == ${DETAIL_SMOKE}u) return smokeOf(c, vB.r, vGrey * ${f(255 / SMOKE_STEPS)}, vB.g);
  if (vFlags == ${DETAIL_SCORCH}u) return vec3(scorchOf(c, vB.r), 0.0, 1.0);
  return (vFlags & 7u) == ${DETAIL_WIRE & 7}u ? wireOf(c) : poolOf(c);
}
`;

export const DETAIL_FLAT_FRAGMENT = `#version 300 es
precision highp float;
${INS}uniform vec3 uSun, uSky;
uniform vec2 uFog;
uniform float uLight;
out vec4 o;
${SHAPES}${ROTOR_SHAPE}${LAMP_SHAPE}${POOL_SHAPE}${KEEPS}${RIPPLE_GLSL}${DIGITS_GLSL}void main() {
  if (vFlags == ${DETAIL_TEK}u) {
    o = rippleOf() * covers(1.0);
    return;
  }
  if (vFlags == ${DETAIL_DIGITS}u) {
    vec3 g = digitsOf(vCorner);
    if (g.x * vShows < 0.004) discard;
    o = weighed(mix(DIGITS_OUTLINE, vA * g.z, g.y), g.x * vShows);
    return;
  }
  if (vFlags == ${DETAIL_GLOW}u) {
    o = vec4((1.0 - exp(-vA * (vGrey * ${f(255 / GLOW_STEPS)}))) * covers(poolOf(vCorner).x), 0.0);
    return;
  }
  vec3 s = (vFlags & ${DETAIL_POOL}u) != 0u ? pooled(vCorner) : (vFlags & ${DETAIL_LAMP}u) != 0u ? lampOf(vCorner)
         : (vFlags & ${DETAIL_ROTOR}u) != 0u ? rotorOf(vCorner, vGrey) : shapeOf(vFlags & 7u, vCorner);
  float a = covers(s.x);
  if (a < 0.004) discard;
  vec3 n = vFlags == ${DETAIL_SMOKE}u ? normalize(vBulge - normalize(vRel) * sqrt(max(0.0, 1.0 - dot(vBulge, vBulge)))) : facing(-normalize(vRel));
  float light = (vFlags & ${DETAIL_LIT}u) != 0u ? (${f(AMBIENT)} + ${f(DIFFUSE)} * max(dot(n, uSun), 0.0)) * uLight : 1.0;
  float d = length(vRel);
  float fog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = weighed(mix(mix(vA, vB, s.y) * s.z * light, uSky, fog * fog), a);
}`;

export const DETAIL_LIT_FRAGMENT = `#version 300 es
precision highp float;
${INS}flat in vec3 vLens;
uniform sampler2D uDetails;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${AIR}${STREET_GLSL}${poolShadeGlsl(MAX_CONTACTS)}${ROTOR_SHAPE}${LAMP_SHAPE}${POOL_SHAPE}${KEEPS}${RIPPLE_GLSL}${DIGITS_GLSL}vec3 linear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  // A damage number shows its own colours as the HUD would, whatever the light, and is never fogged: it is 2 m off.
  if (vFlags == ${DETAIL_TEK}u) {
    vec4 wave = rippleOf() * covers(1.0);
#ifdef LIGHT_TARGET
    wave.rgb = ${UNGRADED("wave.rgb * wave.rgb")};
#endif
    o = wave;
    return;
  }
  if (vFlags == ${DETAIL_DIGITS}u) {
    vec3 g = digitsOf(vCorner);
    if (g.x * vShows < 0.004) discard;
    o = weighed(shown(mix(linear(DIGITS_OUTLINE), linear(vA) * g.z, g.y) / fSunColor.w, vRel), g.x * vShows);
    return;
  }
  if (vFlags == ${DETAIL_GLOW}u) {
    // Light with no surface, as bright as its grey says, as the finish takes it or as a display shows it.
    vec3 e = linear(vA) * (vGrey * ${f(255 / GLOW_STEPS)});
    vec3 d = (1.0 - exp(-e)) * covers(poolOf(vCorner).x);
#ifdef LIGHT_TARGET
    // The light a display's value stands for, so the finish shows it as a display tier does; white heat brighter yet, for bloom.
    d *= d * (0.76 + 0.24 * d);
    d *= 1.0 + ${f(FIRE_BLOOMS)} * d.b * d.b;
    d = ${UNGRADED("d")};
#endif
    o = vec4(d, 0.0);
    return;
  }
  if (vFlags == ${DETAIL_TIRE}u) {
    float core = max(0.0,1.0-dot(vCorner,vCorner));
    o = vec4(0.0,0.0,0.0,0.90*core*core*(3.0-2.0*core)*vShows);
    return;
  }
  if (vFlags == ${DETAIL_SCORCH}u) {
    o = vec4(0.0, 0.0, 0.0, 0.9 * scorchOf(vCorner, vB.r) * vShows);
    return;
  }
  if (vFlags == ${DETAIL_SMOKE}u) {
    // A ball of smoke, or a length of a rope of it: lit on the side the sun is and shaded on the other, in the sky's
    // light all round, and in shadow where its middle is. No lookup a pixel: smoke is many pixels and little detail.
    vec3 s = smokeOf(vCorner, vB.r, vGrey * ${f(255 / SMOKE_STEPS)}, vB.g);
    float a = covers(s.x);
    if (a < 0.004) discard;
    vec3 n = normalize(vBulge - normalize(vRel) * sqrt(max(0.0, 1.0 - dot(vBulge, vBulge))));
    vec2 key = keyShade(vShade);
    // Light goes a little way through smoke: its shaded side keeps a seventh of the sun, and the sky's light all of it.
    // Its colour is squared for light, which is near enough for a grey and three powers a pixel cheaper.
    float sun = clamp(0.5 + 0.5 * dot(n, fSun.xyz), 0.0, 1.0), moon = clamp(0.5 + 0.5 * dot(n, fMoon.xyz), 0.0, 1.0);
    // Smoke is grey: it takes the sky's light with most of the sky's blue left out.
    vec3 sky = skyOn(n.y);
    o = weighed(shown(vA * vA * s.z * (fSunColor.rgb * ((0.14 + 0.86 * sun * sun) * key.x) + fMoonColor.rgb * ((0.14 + 0.86 * moon * moon) * key.y) + 1.35 * mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, 0.4)), vRel), a);
    return;
  }
  if (vFlags == ${DETAIL_GLASS}u) {
    vec3 eye = -normalize(vRel);
    float nv = dot(vNormal,eye), edge = pow(1.0-min(1.0,abs(nv)),3.0);
    float reflected = min(0.86,(nv < 0.0 ? 0.014+0.09*edge : 0.07+0.74*edge)*(1.0+0.45*fStreetLook.x));
    float band = clamp((vCorner.y-0.55)/0.4,0.0,1.0);
    float tint = (nv < 0.0 ? 0.035 : 0.095)+0.026*vGrey+0.085*band*band;
    float alpha = reflected+(1.0-reflected)*tint;
    vec3 ray = reflect(-eye,vNormal);
    vec3 mirror = streetMirror(skyFrom(ray),ray,vRel,0.12+0.06*vGrey,1.0);
    vec3 smoked = vec3(0.033,0.066,0.071)*skyLight(vec3(0.0,1.0,0.0));
    o = weighed(shown(mix(smoked,mirror,reflected/alpha),vRel),alpha*vShows);
    return;
  }
  bool rotor = (vFlags & ${DETAIL_ROTOR}u) != 0u;
  bool pool = (vFlags & ${DETAIL_POOL}u) != 0u;
  bool lamp = pool || (vFlags & ${DETAIL_LAMP}u) != 0u;
  vec4 t;
  if (lamp || rotor) {
    vec3 s = pool ? pooled(vCorner) : lamp ? lampOf(vCorner) : rotorOf(vCorner, vGrey);
    t = vec4(s.z, s.y, 0.0, s.x);
  } else t = texture(uDetails, vUv);
  float a = covers(t.a) * (vFlags == ${DETAIL_SHADED_POOL}u ? poolShade(vRel, vLens, uint(vFloor + 0.5)) : 1.0);
  if (a < 0.004) discard;
  vec3 v = -normalize(vRel);
  vec3 n = facing(v);
  vec3 albedo = linear(vec3(t.r)) * mix(mix(linear(vA), linear(vB), t.g) / (rotor || vFlags == ${DETAIL_WAKE}u ? 1.0 : vGrey), vec3(1.0), t.b);
  vec3 light = (vFlags & ${DETAIL_LIT}u) != 0u ? lit(albedo, vec3(1.0, 1.0, 0.0), n, v, vec3(0.0), sunShadow(vRel, n)) : albedo / fSunColor.w;
  o = weighed(shown(light, vRel), a);
}`;

/** Twin of the street lamp's soft disc in both shader tiers. */
export function poolOf(x: number, y: number, out: Float64Array | number[]): void {
  const t = Math.min(1, Math.max(0, Math.hypot(x, y)));
  const a = 1 - t * t * (3 - 2 * t);
  out[0] = a * a;
  out[1] = 0;
  out[2] = 1;
}

/** Seeded streak of foam stretched along the flow at a stern socket. Twin of wakeOf in the detail shaders. */
export function wakeFoam(x: number, y: number, seed: number, out: Float64Array | number[]): void {
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t*t*(3-2*t);
  };
  const phase = 6.283185 * seed;
  const spine = x - .30*Math.sin(2.8*y+phase) - .12*Math.sin(7*y-2*phase);
  const edge = 1-smooth(.48,1,Math.abs(y)), veil=1-smooth(.06,.52,Math.abs(spine));
  const lace = Math.sin(8*spine+1.9*Math.sin(4*y+phase))+.72*Math.sin(10*y+2*phase);
  const holes = smooth(-.55,.8,lace);
  const fringe=(1-smooth(.02,.18,Math.abs(spine-.34)))*smooth(-.5,.7,Math.sin(7*y-phase));
  out[0] = edge*(veil*(.12+.73*holes)+.36*fringe);
  out[1] = 0; out[2] = .90+.10*holes;
}

/**
 * A thick puff of smoke with no picture, at corner (x, y) of its card: a soft disc whose outline is bent by its seed, so
 * no two are alike and none shows its card, mottled darker in its creases. A card `stretch` times longer than wide (past
 * one and a half) is a length of a rope of smoke instead: its middle wanders and its width swells along it, and its ends
 * thin into the next. `torn` from 0 to 1 breaks it up where it is thinnest. Twin of smokeOf in the detail shaders.
 */
export function smokeOf(x: number, y: number, seed: number, out: Float64Array | number[], stretch = 1, torn = 0): void {
  const s = 6.2831853 * seed;
  const step = (a: number, b: number, v: number): number => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  let r: number, lump: number, puff = 1, rim = 0.82;
  if (stretch > 1.5) {
    const along = y * stretch;
    const off = x - 0.07 * Math.sin(1.9 * along + s) - 0.04 * Math.sin(4.3 * along + 2.3 * s);
    // Each side swells into puffs of its own, out of step with the other's, and is darker in the creases between them.
    puff = Math.abs(Math.sin(1.15 * along + 1.7 * s + (off > 0 ? 1.6 : 0)));
    r = Math.abs(off) / (0.42 + 0.3 * puff + 0.06 * Math.sin(3.7 * along - s));
    r = 0.86 * Math.max(r, (Math.abs(y) - 1) * stretch + 1);
    lump = 0.5 + 0.5 * Math.sin(2.6 * along + 2.1 * s) * Math.sin(5.3 * x - 1.3 * s);
  } else {
    r = Math.hypot(x + 0.17 * Math.sin(3.9 * y + s), y + 0.17 * Math.sin(3.3 * x + 1.7 * s));
    lump = 0.5 + 0.5 * Math.sin(5.3 * x + 2.1 * s) * Math.sin(4.7 * y - 1.3 * s);
    // A puff's outline is as lumpy as its middle, and no disc.
    rim = 0.6 + 0.2 * lump;
  }
  out[0] = (1 - step(0.3 + 0.22 * lump, rim, r)) * step(1.3 * torn - 0.24, 1.3 * torn, lump + 0.3 * (1 - r));
  out[1] = 0;
  out[2] = 0.58 + 0.2 * lump + 0.22 * puff;
}

/** How much of a scorch shows at corner (x, y) of its card: an uneven patch of soot, and five rays thrown out of it. Twin of scorchOf. */
export function scorchOf(x: number, y: number, seed: number): number {
  const s = 6.2831853 * seed;
  const step = (a: number, b: number, v: number): number => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const r = Math.hypot(x, y), t = Math.atan2(y, x);
  const soot = 1 - step(0.16, 0.5 + 0.12 * Math.sin(3.1 * x + s) * Math.sin(2.7 * y - s), r);
  // Five rays by the turn about its middle, unevenly spaced, each with its own reach, thinning to their points.
  const reach = 0.66 + 0.26 * Math.sin(2 * t + 3 * s);
  const rays = step(0.7 + 0.29 * Math.min(1, r / reach), 1, Math.abs(Math.sin(2.5 * t + s + 0.6 * Math.sin(t + s)))) * (1 - step(0.5 * reach, reach, r));
  return Math.max(soot, 0.7 * rays);
}

/** Twin of a wire's width in both shader tiers: `y` across it. */
export function wireOf(y: number, out: Float64Array | number[]): void {
  const t = Math.min(1, Math.max(0, (Math.abs(y) - 0.35) / 0.65));
  out[0] = 1 - t * t * (3 - 2 * t);
  out[1] = 0;
  out[2] = 1;
}

/** Twin of the analytic lamp shape in both shader tiers. */
export function lampOf(x: number, y: number, out: Float64Array | number[]): void {
  const r = Math.hypot(Math.max(0, Math.abs(x) - .28) / .72, y);
  const halo = Math.max(0, 1 - r);
  const core = Math.min(1, Math.max(0, (r - .055) / (.34 - .055)));
  const hot = Math.min(1, Math.max(0, (r - .025) / (.16 - .025)));
  out[0] = Math.max(1 - core * core * (3 - 2 * core), .82 * halo ** 3);
  out[1] = 1 - hot * hot * (3 - 2 * hot);
  out[2] = 1;
}

/** `rotorOf`'s twin. The result is alpha, tip paint share, shade; it is independent of angular phase/display FPS. */
export function rotorOf(x: number, y: number, density: number, out: Float64Array | number[]): void {
  const r = Math.hypot(x, y);
  const ease = (a: number, b: number) => { const t = Math.max(0, Math.min(1, (r - a) / (b - a))); return t * t * (3 - 2 * t); };
  out[0] = Math.min(.65, density / Math.max(r, .12)) * ease(.09, .17) * (1 - ease(.975, 1));
  out[1] = ease(.91, .94);
  out[2] = 1;
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
    out[0] = clamp((w - edge) / 0.12 + 0.5);
    out[1] = t >= 0.84 ? 1 : 0;
    out[2] = edge < 0.05 ? 1.12 : 1 - (0.3 * edge) / Math.max(w, 0.01);
  } else if (shape === 1) {
    const lump = 0.08 * Math.sin(5 * Math.atan2(y, x) + 1.3);
    const a = clamp((0.92 + lump - r) / 0.5);
    out[0] = a * a;
    out[1] = 0;
    out[2] = 0.88 + 0.12 * y;
  } else if (shape === 2) {
    out[0] = clamp((0.9 - r) / 0.15);
    out[1] = 0;
    out[2] = 0.92 + 0.35 * Math.max(0, 1 - Math.hypot(x + 0.3, y - 0.35) * 2.5);
  }
  else if (shape === 3) { out[0] = clamp(1 - Math.abs(r - 0.78) / 0.14); out[1] = 0; out[2] = 1; }
  else {
    let a = 0;
    for (let k = 0; k < 5; k++) {
      const s = k * 1.37 + 0.4;
      a = Math.max(a, clamp((0.2 - Math.hypot(x - 0.6 * Math.cos(s * 2.3), y - 0.6 * Math.sin(s * 3.1))) / 0.06));
    }
    out[0] = a;
    out[1] = 0;
    out[2] = 0.85 + 0.15 * y;
  }
}

/** Whether a cut-out particle that shows `shows` keeps window pixel (x, y), counted from the bottom left. KEEPS's twin. */
export function detailKeeps(shows: number, x: number, y: number): boolean {
  return shows * 16 > FADE_ORDER[(y & 3) * 4 + (x & 3)]! + 0.5;
}
