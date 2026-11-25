// Opaque Tek castings and the optical strips mounted in them.
import { TEK_FIELD } from "./tek-field.ts";

const sat = (n: number): number => Math.max(0, Math.min(1, n));
const ridge = (n: number): number => 1 - Math.abs(2 * (n - Math.floor(n)) - 1);

const ceramic = [.351, .342, .320] as const;
const titanium = [.060, .069, .083] as const;

/** Interrupted cutter tracks have a dull groove and a narrow burnished lip. Fine lines average away first. */
function cutter(u: number, v: number, footprint: number): number {
  const bow = .18 * ridge(.74 * u - .17 * v) + .11 * ridge(1.23 * u + .31 * v);
  const line = 9.3 * v + 2.1 * u + bow, row = Math.floor(line), across = line - row;
  const run = sat(2.6 * ridge(1.35 * u - .33 * v + row * .618) - .79);
  const groove = sat(1 - 7.8 * Math.abs(across - .31)), lip = sat(1 - 9.0 * Math.abs(across - .46));
  const band = ridge(2.83 * v + .62 * u + .47 * bow) - .5;
  return .25 * band * sat(1 - 8 * footprint) + run * (.19 * lip - .33 * groove) * sat(1 - 30 * footprint);
}

/** The stamped recess keeps its ceramic coat. Tool marks polish through it along the raised shoulders. */
function armor(base: Float64Array, orm: Float64Array, paint: Float64Array, height: number, tracks: number): void {
  const peak = Math.max(paint[0]!, paint[1]!, paint[2]!);
  const chroma = peak - Math.min(paint[0]!, paint[1]!, paint[2]!);
  const neutral = sat((peak - .007) * 31) * sat(1 - 3.8 * chroma);
  const shoulder = sat((height - .54) / .23);
  const rubbed = shoulder * shoulder * (3 - 2 * shoulder);
  const tool = sat((height - .25) / .48), grain = .50 + .88 * tool + tracks;
  for (let i = 0; i < 3; i++) {
    const coat = ceramic[i]! * neutral + .70 * paint[i]! + .23 * base[i]!;
    base[i] = Math.min(1, coat * grain + titanium[i]! * rubbed);
  }
  orm[1] = Math.max(.28, Math.min(.72, .565 + .74 * (orm[1]! - .39) - .12 * rubbed - .22 * tracks));
  orm[2] = .14 + .43 * rubbed;
}

export function tekCasting(base: Float64Array, orm: Float64Array, paint: Float64Array, height: number, fixed: boolean,
  x = 0, y = 0, z = 0, nx = 0, ny = 1, nz = 0, footprint = 1): boolean {
  if (!fixed) {
    const horizontal = Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz));
    const u = horizontal || Math.abs(nx) <= Math.abs(nz) ? x : z;
    armor(base, orm, paint, height, cutter(u, horizontal ? z : y, footprint));
    return false;
  }
  const bright = sat((paint[1]! - .035) * 3.2);
  const metal = sat((Math.max(paint[0]!, paint[1]!) - .017) * 13);
  const grain = .91 + .18 * height;
  for (let i = 0; i < 3; i++) {
    const steel = .093 + .30 * paint[i]!;
    base[i] = (.14 * base[i]! + .86 * paint[i]! + metal * steel) * grain;
  }
  orm[1] = Math.max(.24, Math.min(.81, .75 - .27 * metal - .19 * bright + .32 * (orm[1]! - .40)));
  orm[2] = .08 + .72 * metal;
  return orm[1] < .38;
}

export function tekGlass(base: Float64Array, orm: Float64Array, height: number): void {
  base[0] = .008 + .014 * height;
  base[1] = .029 + .033 * height;
  base[2] = .045 + .047 * height;
  orm[1] = .26 + .10 * height;
  orm[2] = .46;
}

/** A travelling caustic passes over etched, alternating chevrons underneath the glass. */
export function tekInlayLight(light: Float64Array, x: number, y: number, z: number, nx: number, ny: number, nz: number,
  vx: number, vy: number, vz: number, phase: number, seed: number, footprint: number, exposure: number): void {
  const horizontal = Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz)), end = Math.abs(nx) > Math.abs(nz);
  const u = horizontal || !end ? x : z, v = horizontal ? z : y;
  const du = horizontal || !end ? vx : vz, dv = horizontal ? vz : vy;
  const rim = 1 - sat(Math.abs(nx * vx + ny * vy + nz * vz));
  const s = u + .020 * du, t = v + .020 * dv;
  const lane = .55 * s + .88 * t + .11 * Math.sin(3.7 * s - 1.4 * t) + (seed & 7) * .125;
  const travel = lane - phase / Math.PI;
  const crest = ridge(travel);
  const wake = crest * crest * crest;
  const focus = Math.max(0, 14 * crest - 13);
  const echo = Math.max(0, 21 * ridge(travel - .072 - .011 * du) - 20);
  const fine = sat(1 - 24 * footprint);
  const etched = Math.max(0, 6 * ridge(5.5 * t + .44 * ridge(4 * s)) - 5);
  const islands = sat(3.2 * ridge(1.7 * s - 1.1 * t) - 1);
  const cut = etched * fine * (.18 + .82 * islands);
  const edge = rim * rim, e = 1 / Math.max(.001, exposure);
  light[0]! += (.010 + .23 * focus + .065 * echo + .075 * cut * wake + .037 * edge) * e;
  light[1]! += (.056 + .19 * wake + .40 * focus + .14 * echo + .33 * cut * (.20 + wake)) * e;
  light[2]! += (.096 + .32 * wake + .25 * focus + .21 * echo + .40 * cut * (.20 + wake) + .12 * edge) * e;
}

export const TEK_INLAY_GLSL = `float tekRidge(float n) { return 1.0 - abs(2.0 * fract(n) - 1.0); }
float tekCutter(vec2 st, float footprint) {
  float bow = 0.18 * tekRidge(dot(st, vec2(0.74, -0.17))) + 0.11 * tekRidge(dot(st, vec2(1.23, 0.31)));
  float line = dot(st, vec2(2.1, 9.3)) + bow, a = fract(line);
  float run = clamp(2.6 * tekRidge(dot(st, vec2(1.35, -0.33)) + floor(line) * 0.618) - 0.79, 0.0, 1.0);
  float groove = max(0.0, 1.0 - 7.8 * abs(a - 0.31)), lip = max(0.0, 1.0 - 9.0 * abs(a - 0.46));
  float band = tekRidge(dot(st, vec2(0.62, 2.83)) + 0.47 * bow) - 0.5;
  return 0.25 * band * max(0.0, 1.0 - 8.0 * footprint) + run * (0.19 * lip - 0.33 * groove) * max(0.0, 1.0 - 30.0 * footprint);
}
bool tekCasting(inout vec3 base, inout vec3 orm, vec3 paint, float height, bool fixedFace, vec3 own, vec3 face, float footprint) {
  if (!fixedFace) {
    vec3 n = abs(face);
    vec2 st = n.y >= max(n.x, n.z) ? own.xz : n.x > n.z ? own.zy : own.xy;
    float tracks = tekCutter(st, footprint);
    float peak = max(max(paint.r, paint.g), paint.b);
    float chroma = peak - min(min(paint.r, paint.g), paint.b);
    float neutral = clamp((peak - 0.007) * 31.0, 0.0, 1.0) * clamp(1.0 - 3.8 * chroma, 0.0, 1.0);
    float rubbed = smoothstep(0.54, 0.77, height);
    float grain = 0.50 + 0.88 * clamp((height - 0.25) / 0.48, 0.0, 1.0) + tracks;
    vec3 coat = vec3(${ceramic.join(", ")}) * neutral + 0.70 * paint + 0.23 * base;
    base = min(vec3(1.0), coat * grain + vec3(${titanium.join(", ")}) * rubbed);
    orm.yz = vec2(clamp(0.565 + 0.74 * (orm.y - 0.39) - 0.12 * rubbed - 0.22 * tracks, 0.28, 0.72), 0.14 + 0.43 * rubbed);
    return false;
  }
  float bright = clamp((paint.g - 0.035) * 3.2, 0.0, 1.0);
  float metal = clamp((max(paint.r, paint.g) - 0.017) * 13.0, 0.0, 1.0);
  vec3 steel = 0.093 + 0.30 * paint;
  base = (mix(base, paint, 0.86) + metal * steel) * (0.91 + 0.18 * height);
  orm.yz = vec2(clamp(0.75 - 0.27 * metal - 0.19 * bright + 0.32 * (orm.y - 0.4), 0.24, 0.81), 0.08 + 0.72 * metal);
  return orm.y < 0.38;
}
bool tekCasting(inout vec3 base, inout vec3 orm, vec3 paint, float height, bool fixedFace) {
  return tekCasting(base, orm, paint, height, fixedFace, vec3(0.0), vec3(0.0, 1.0, 0.0), 1.0);
}
void tekGlass(inout vec3 base, inout vec3 orm, float height) {
  base = vec3(0.008, 0.029, 0.045) + vec3(0.014, 0.033, 0.047) * height;
  orm.yz = vec2(0.26 + 0.10 * height, 0.46);
}
vec3 tekInlayLight(vec3 p, vec3 n, vec3 v, int seed, float footprint) {
  vec3 a = abs(n);
  bool horizontal = a.y >= max(a.x, a.z);
  vec2 st = horizontal ? p.xz : a.x > a.z ? p.zy : p.xy;
  st += 0.020 * (horizontal ? v.xz : a.x > a.z ? v.zy : v.xy);
  float rim = 1.0 - clamp(abs(dot(n, v)), 0.0, 1.0);
  float lane = dot(st, vec2(0.55, 0.88)) + 0.11 * sin(dot(st, vec2(3.7, -1.4))) + float(seed & 7) * 0.125;
  float travel = lane - fMade[${(TEK_FIELD - 1) * 2}].z * 0.318309886;
  float crest = tekRidge(travel), wake = crest * crest * crest;
  float focus = max(0.0, 14.0 * crest - 13.0);
  float du = horizontal || a.x <= a.z ? v.x : v.z;
  float echo = max(0.0, 21.0 * tekRidge(travel - 0.072 - 0.011 * du) - 20.0);
  float fine = clamp(1.0 - 24.0 * footprint, 0.0, 1.0);
  float etched = max(0.0, 6.0 * tekRidge(5.5 * st.y + 0.44 * tekRidge(4.0 * st.x)) - 5.0);
  float islands = clamp(3.2 * tekRidge(dot(st, vec2(1.7, -1.1))) - 1.0, 0.0, 1.0);
  float cut = etched * fine * (0.18 + 0.82 * islands);
  vec3 glow = vec3(0.010, 0.056, 0.096) + vec3(0.0, 0.19, 0.32) * wake;
  glow += vec3(0.23, 0.40, 0.25) * focus + vec3(0.065, 0.14, 0.21) * echo;
  glow += vec3(0.075 * wake, 0.33 * (0.20 + wake), 0.40 * (0.20 + wake)) * cut + vec3(0.037, 0.0, 0.12) * rim * rim;
  return glow / max(0.001, fSunColor.w);
}`;
