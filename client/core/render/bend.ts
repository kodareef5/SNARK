// A bent piece's vertices laid along its bend (shared/world/bends.ts), as the vertex texts do it: the textured pieces'
// (surface.ts), the flat one's (glsl.ts FLAT_MESH_VERTEX) and the casters' (shadowtext.ts DEPTH_VERTEX), each where its
// draw's `uSkin` is -3 (surface.ts skinMode, packet.ts DRAW_BENT). The bend comes as attributes 13 and 14, eight 16-bit
// numbers an instance from a stream of their own beside the instances (scene.ts `bendsOf`). Its twin is bendVertex, which
// the software rasterizer runs (tools/snap/raster.ts).
//
// `bent` takes a vertex as modelled, with its normal and tangent, to the piece's own frame, which the draw's turn and
// place then take to the world as any rigid piece's; it leaves in gBent how far along its kerb line the vertex is, how far
// across from the kerb's face, and its height as modelled, which the textured fragment's wear reads (BENT_WEAR_GLSL).

import { FLUSH_APRON, KERB_BACK, KERB_HEIGHT, MODEL_HALF, MODEL_WALK, SINK_FROM, STATION_WRAP } from "../../../shared/world/bends.ts";

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const BEND_GLSL = `layout(location=13) in vec4 iBendA;
layout(location=14) in vec4 iBendB;
vec3 gBent, gLook;
vec3 bent(vec3 l, inout vec3 n, inout vec3 t) {
  float h = iBendA.x * 0.001, a0 = iBendA.y / 8192.0, a1 = iBendA.z / 8192.0, phi = abs(a1 - a0);
  float u = l.x / ${f(2 * MODEL_HALF)} + 0.5, u2 = u * u, u3 = u2 * u;
  float m = 2.0 * h * (phi < 0.001 ? 1.0 + phi * phi / 16.0 : 2.0 * tan(phi / 4.0) / sin(phi / 2.0));
  vec2 t0 = m * vec2(cos(a0), sin(a0)), t1 = m * vec2(cos(a1), sin(a1));
  vec2 p = vec2(h * (6.0 * u2 - 4.0 * u3 - 1.0), 0.0) + (u3 - 2.0 * u2 + u) * t0 + (u3 - u2) * t1;
  vec2 w = normalize(vec2(h * (12.0 * u - 12.0 * u2), 0.0) + (3.0 * u2 - 4.0 * u + 1.0) * t0 + (3.0 * u2 - 2.0 * u) * t1);
  float wb = iBendB.z < 0.0 ? iBendB.z + 65536.0 : iBendB.z, back = step(32768.0, wb), ahead = step(16384.0, wb - back * 32768.0);
  float walk = (wb - back * 32768.0 - ahead * 16384.0) * 0.001, tactile = step(16384.0, iBendB.y), k = l.z > ${f(KERB_BACK)} ? (walk - ${f(KERB_BACK)}) / ${f(MODEL_WALK - KERB_BACK)} : 1.0, z = l.z > ${f(KERB_BACK)} ? ${f(KERB_BACK)} + (l.z - ${f(KERB_BACK)}) * k : l.z;
  float len = 2.0 * h * (phi < 0.001 ? 1.0 + phi * phi / 24.0 : phi * 0.5 / sin(phi / 2.0));
  float s = (iBendA.w < 0.0 ? iBendA.w + 65536.0 : iBendA.w) * 0.01 + u * len, seed = mod(iBendB.w, 256.0), wear = floor(iBendB.w / 256.0) / 127.0;
  float lift = (0.006 + 0.022 * wear) * (0.4 + 0.6 * seed / 255.0) * (0.6 * sin(6.2831853 * s / 40.0 + seed * 0.37) + 0.4 * sin(6.2831853 * s / 24.0 + seed * 1.3));
  lift *= walk > ${f(KERB_BACK + 0.01)} ? clamp((z - ${f(KERB_BACK)}) / (walk - ${f(KERB_BACK)}), 0.0, 1.0) : 0.0;
  float sink = ahead - back, weight = l.z > ${f(SINK_FROM)} ? clamp(l.y / ${f(KERB_HEIGHT)}, 0.0, 1.0) * abs(sink) : 0.0;
  float fall = weight * (sink > 0.0 ? u : 1.0 - u), rise = iBendB.x * 0.001, grade = (2.0 * rise - ${f(KERB_HEIGHT)} * sink * weight) / len, stretch = len / ${f(2 * MODEL_HALF)};
  vec2 c = vec2(n.x / stretch - grade * n.y, n.z / k), e = vec2(t.x * stretch, t.z * k);
  n = normalize(vec3(w.x * c.x - w.y * c.y, n.y, w.y * c.x + w.x * c.y));
  t = normalize(vec3(w.x * e.x - w.y * e.y, t.y + grade * e.x, w.y * e.x + w.x * e.y));
  gBent = vec3(mod(s, ${f(STATION_WRAP)}), z, l.y);
  gLook = vec3((iBendB.y - tactile * 16384.0) * 0.001, walk, tactile);
  return vec3(p.x - w.y * z, l.y + rise * (2.0 * u - 1.0) + lift - ${f(KERB_HEIGHT)} * fall, p.y + w.x * z);
}
`;

/** Metres of the street atlas's strips a width (assets/source/core/props/street/layout.json `tiles`): a bent piece's faces along it are laid by the station. */
export const STRIP_METRES = 4;

/**
 * A bent piece's variety, drawn where its tier reads the finishes in full (BENT_WEAR, programs.ts) and no frame says
 * `?off=kerbs`: by where a point lies along its kerb line (`along`, metres, within STATION_WRAP), across from its face and
 * up as modelled (bend.ts gBent), its line's seed and wear, its panels' length and its walk's back. None of it reads a
 * texture; every layer is a few hashes of where the point is, so it never repeats with the piece, and each wave's or
 * cell's length divides the wrap, so nothing jumps where the stations start again. The twin of BENT_WEAR_GLSL.
 * - pours: each 6 m of kerb its own tone, a little warmer the more it is worn;
 * - panels: the walk's joints every `panel` metres along, each panel its own tone, a share of them cracked by wear: a
 *   crack mostly across the walk from anywhere in its panel, running part of its width, each as deep as its own;
 * - stains: dark patches on two scales, more the more it is worn, and grime in the gutter;
 * - chips: the kerb's top edge broken back in places, more by wear;
 * - grass: in the walk's joints and behind its back where it is worn;
 * - a crossing's ramp (`tactile`): its apron a faded yellow pad of domes.
 */
export function bentWear(albedo: Float64Array | number[], mro: Float64Array | number[], along: number, across: number, up: number, faceUp: number, code: number, panel: number, walk: number, spread: number, tactile = false): void {
  const seed = code % 256, wear = Math.floor(code / 256) / 127;
  // A crossing's ramp: its apron's dimpled pad, a faded yellow, its domes fading out where a pixel spans them.
  if (tactile && faceUp > 0.8 && across > 0.12 && across < apronOf(walk)) {
    const gx = fract(along / DOME) - 0.5, gy = fract(across / DOME) - 0.5;
    const dome = (1 - smooth(0.18, 0.3, Math.sqrt(gx * gx + gy * gy))) * (1 - smooth(0.01, 0.03, spread));
    for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! + (PAD[c]! * (0.85 + 0.25 * dome) - albedo[c]!) * 0.7;
  }
  const pour = Math.floor(along / 6);
  const tone = 0.94 + 0.12 * hash(pour, seed), warm = hash(seed, pour + 7) * wear;
  for (let c = 0; c < 3; c++) albedo[c]! *= tone * (1 + warm * WARM[c]!);
  if (faceUp > 0.8 && across > KERB_BACK + 0.02 && across < walk - 0.03 && panel > 0) {
    const p = along / panel, cell = Math.floor(p);
    const d = Math.abs(p - cell - 0.5) * panel;
    const joint = 1 - smooth(0.006, 0.02 + spread, panel / 2 - d);
    const own = hash(cell, seed + 3);
    for (let c = 0; c < 3; c++) albedo[c]! *= (1 - 0.45 * joint) * (0.96 + 0.08 * own);
    mro[0]! *= 1 - 0.3 * joint;
    if (own < 0.08 + 0.22 * wear) {
      // A crack mostly across the walk, from anywhere in its panel, running part of the way, its depth its own.
      const a = Math.PI / 2 + (hash(cell, seed + 9) - 0.5) * 1.4, u = (p - cell) * panel, v = across, ca = Math.cos(a), sa = Math.sin(a);
      const cu = panel * (0.2 + 0.6 * hash(cell, 4)), cv = KERB_BACK + (walk - KERB_BACK) * hash(cell, 5);
      const line = Math.abs((u - cu) * -sa + (v - cv) * ca) + (noise(u * 9 + cell, v * 9, 0) - 0.5) * 0.02;
      const reach = (0.25 + 0.6 * hash(cell, 6)) * (walk - KERB_BACK), along = Math.abs((u - cu) * ca + (v - cv) * sa);
      const crack = (1 - smooth(0.0015, 0.004 + spread, Math.abs(line))) * (1 - smooth(reach * 0.7, reach, along));
      for (let c = 0; c < 3; c++) albedo[c]! *= 1 - (0.18 + 0.2 * hash(cell, 7)) * crack;
    }
    const green = joint * smooth(0.55, 0.8, noise(along * 0.8, seed, 480)) * smooth(0.35, 0.7, wear);
    for (let c = 0; c < 3; c++) albedo[c] = albedo[c]! + (GRASS[c]! - albedo[c]!) * green * 0.8;
  }
  const stain = noise(along * 0.7, across * 1.5 + seed, 420) * noise(along * 0.2 + 3.1, seed, 120);
  const dark = 1 - (0.1 + 0.25 * wear) * smooth(0.25, 0.75, stain);
  const gutter = across < 0 || up < 0.03 ? 1 - (0.3 - 0.25 * noise(along * 2, 1, 1200)) * (0.6 + 0.4 * wear) : 1;
  for (let c = 0; c < 3; c++) albedo[c]! *= dark * gutter;
  if (up > 0.115 && across < 0.08 && across > -0.02) {
    const chip = (hash(Math.floor(along / 0.4), seed + 5) < 0.08 + 0.35 * wear ? 1 : 0) * smooth(0.3, 0.7, noise(along * 12, up * 40, 7200));
    for (let c = 0; c < 3; c++) albedo[c]! *= 1 - CHIP[c]! * chip;
    mro[1] = mro[1]! + (1 - mro[1]!) * chip * 0.5;
  }
}

const WARM = [0.03, 0, -0.05], GRASS = [0.09, 0.13, 0.04], CHIP = [0.22, 0.24, 0.28], PAD = [0.62, 0.5, 0.2];
/** A crossing's pad's domes' spacing, and where a flush kerb's apron ends across a walk of `walk` (bends.ts across). */
const DOME = 0.06;
const apronOf = (walk: number): number => KERB_BACK + ((FLUSH_APRON - KERB_BACK) * (walk - KERB_BACK)) / (MODEL_WALK - KERB_BACK);
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);
/** A hash of two numbers, 0 to 1: Hoskins's, with no sine, the same on every card. */
function hash(x: number, y: number): number {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}
/** Value noise of (x, y), repeating every `period` along x where it is given. */
function noise(x: number, y: number, period: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const wrap = (i: number): number => (period > 0 ? i - Math.floor(i / period) * period : i);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number): number => hash(wrap(ix + i), iy + j);
  return (h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy;
}

/** `bentWear` as GLSL, after LIGHT: called with the vertex's gBent, its seed and wear, its panel and walk, and how far `along` moves to the next pixel. */
export const BENT_WEAR_GLSL = `#ifdef BENT_WEAR
float bentHash(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float bentNoise(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p), s = f * f * (3.0 - 2.0 * f);
  vec2 j = vec2(period > 0.0 ? mod(i.x + 1.0, period) : i.x + 1.0, i.y);
  if (period > 0.0) i.x = mod(i.x, period);
  return mix(mix(bentHash(i), bentHash(j), s.x), mix(bentHash(i + vec2(0.0, 1.0)), bentHash(j + vec2(0.0, 1.0)), s.x), s.y);
}
void bentWear(inout vec3 albedo, inout vec3 mro, vec3 at, float faceUp, float code, vec3 look, float spread) {
  float seed = mod(code, 256.0), wear = floor(code / 256.0) / 127.0, along = at.x, across = at.y, up = at.z;
  if (look.z > 0.5 && faceUp > 0.8 && across > 0.12 && across < ${f(KERB_BACK)} + ${f(FLUSH_APRON - KERB_BACK)} * (look.y - ${f(KERB_BACK)}) / ${f(MODEL_WALK - KERB_BACK)}) {
    vec2 g = fract(vec2(along, across) / ${f(DOME)}) - 0.5;
    float dome = (1.0 - smoothstep(0.18, 0.3, length(g))) * (1.0 - smoothstep(0.01, 0.03, spread));
    albedo = mix(albedo, vec3(0.62, 0.5, 0.2) * (0.85 + 0.25 * dome), 0.7);
  }
  float pour = floor(along / 6.0);
  albedo *= (0.94 + 0.12 * bentHash(vec2(pour, seed))) * (1.0 + bentHash(vec2(seed, pour + 7.0)) * wear * vec3(${f(0.03)}, 0.0, ${f(-0.05)}));
  if (faceUp > 0.8 && across > ${f(KERB_BACK + 0.02)} && across < look.y - 0.03 && look.x > 0.0) {
    float p = along / look.x, cell = floor(p), d = abs(p - cell - 0.5) * look.x;
    float joint = 1.0 - smoothstep(0.006, 0.02 + spread, look.x * 0.5 - d), own = bentHash(vec2(cell, seed + 3.0));
    albedo *= (1.0 - 0.45 * joint) * (0.96 + 0.08 * own);
    mro.r *= 1.0 - 0.3 * joint;
    if (own < 0.08 + 0.22 * wear) {
      float a = 1.5707963 + (bentHash(vec2(cell, seed + 9.0)) - 0.5) * 1.4, u = (p - cell) * look.x;
      vec2 c = vec2(look.x * (0.2 + 0.6 * bentHash(vec2(cell, 4.0))), ${f(KERB_BACK)} + (look.y - ${f(KERB_BACK)}) * bentHash(vec2(cell, 5.0))), d = vec2(u, across) - c;
      float line = abs(dot(d, vec2(-sin(a), cos(a)))) + (bentNoise(vec2(u * 9.0 + cell, across * 9.0), 0.0) - 0.5) * 0.02;
      float reach = (0.25 + 0.6 * bentHash(vec2(cell, 6.0))) * (look.y - ${f(KERB_BACK)});
      albedo *= 1.0 - (0.18 + 0.2 * bentHash(vec2(cell, 7.0))) * (1.0 - smoothstep(0.0015, 0.004 + spread, abs(line))) * (1.0 - smoothstep(reach * 0.7, reach, abs(dot(d, vec2(cos(a), sin(a))))));
    }
    float green = joint * smoothstep(0.55, 0.8, bentNoise(vec2(along * 0.8, seed), 480.0)) * smoothstep(0.35, 0.7, wear);
    albedo = mix(albedo, vec3(0.09, 0.13, 0.04), green * 0.8);
  }
  float stain = bentNoise(vec2(along * 0.7, across * 1.5 + seed), 420.0) * bentNoise(vec2(along * 0.2 + 3.1, seed), 120.0);
  albedo *= 1.0 - (0.1 + 0.25 * wear) * smoothstep(0.25, 0.75, stain);
  if (across < 0.0 || up < 0.03) albedo *= 1.0 - (0.3 - 0.25 * bentNoise(vec2(along * 2.0, 1.0), 1200.0)) * (0.6 + 0.4 * wear);
  if (up > 0.115 && across < 0.08 && across > -0.02) {
    float chip = step(bentHash(vec2(floor(along / 0.4), seed + 5.0)), 0.08 + 0.35 * wear) * smoothstep(0.3, 0.7, bentNoise(vec2(along * 12.0, up * 40.0), 7200.0));
    albedo *= 1.0 - vec3(0.22, 0.24, 0.28) * chip;
    mro.g = mix(mro.g, 1.0, chip * 0.5);
  }
}
#endif
`;

/** A flat or depth text's bend of its vertex `l`, which needs no normal. */
export const BEND_PLACE = "    if (uSkin < -2.5) { vec3 bn = vec3(0.0, 1.0, 0.0), bt = vec3(1.0, 0.0, 0.0); l = bent(l, bn, bt); }\n";
