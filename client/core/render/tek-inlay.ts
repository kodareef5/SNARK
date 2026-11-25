// Opaque Tek castings and the optical strips mounted in them.
import { TEK_FIELD } from "./tek-field.ts";

const sat = (n: number): number => Math.max(0, Math.min(1, n));
const ridge = (n: number): number => 1 - Math.abs(2 * (n - Math.floor(n)) - 1);

/** Ceramic seals, bead-blasted armor and bright machined lands share the sampled relief. */
export function tekCasting(base: Float64Array, orm: Float64Array, paint: Float64Array, height: number, fixed: boolean): boolean {
  const bright = sat((paint[1]! - .035) * 3.2);
  const metal = fixed ? sat((Math.max(paint[0]!, paint[1]!) - .017) * 13) : .84;
  const grain = .91 + .18 * height;
  for (let i = 0; i < 3; i++) {
    const steel = .093 + .30 * paint[i]!;
    base[i] = (.14 * base[i]! + .86 * paint[i]! + metal * steel) * grain;
  }
  orm[1] = Math.max(.24, Math.min(.81, .75 - .27 * metal - (fixed ? .19 * bright : 0) + .32 * (orm[1]! - .40)));
  orm[2] = .08 + .72 * metal;
  return fixed && orm[1] < .38;
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

export const TEK_INLAY_GLSL = `bool tekCasting(inout vec3 base, inout vec3 orm, vec3 paint, float height, bool fixedFace) {
  float bright = clamp((paint.g - 0.035) * 3.2, 0.0, 1.0);
  float metal = fixedFace ? clamp((max(paint.r, paint.g) - 0.017) * 13.0, 0.0, 1.0) : 0.84;
  vec3 steel = 0.093 + 0.30 * paint;
  base = (mix(base, paint, 0.86) + metal * steel) * (0.91 + 0.18 * height);
  orm.yz = vec2(clamp(0.75 - 0.27 * metal - (fixedFace ? 0.19 * bright : 0.0) + 0.32 * (orm.y - 0.4), 0.24, 0.81), 0.08 + 0.72 * metal);
  return fixedFace && orm.y < 0.38;
}
void tekGlass(inout vec3 base, inout vec3 orm, float height) {
  base = vec3(0.008, 0.029, 0.045) + vec3(0.014, 0.033, 0.047) * height;
  orm.yz = vec2(0.26 + 0.10 * height, 0.46);
}
float tekRidge(float n) { return 1.0 - abs(2.0 * fract(n) - 1.0); }
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
