// Opaque Tek castings and the optical strips mounted in them.
import { TEK_FIELD } from "./tek-field.ts";

const sat = (n: number): number => Math.max(0, Math.min(1, n));
const ridge = (n: number): number => 1 - Math.abs(2 * (n - Math.floor(n)) - 1);

/** Ceramic seals, bead-blasted armor and bright machined lands share the sampled relief. */
export function tekCasting(base: Float64Array, orm: Float64Array, paint: Float64Array, height: number, fixed: boolean): boolean {
  const bright = sat((paint[1]! - .035) * 3.2);
  const metal = fixed ? sat((Math.max(paint[0]!, paint[1]!) - .017) * 13) : .84;
  const grain = .91 + .18 * height;
  for (let i = 0; i < 3; i++) base[i] = (.14 * base[i]! + .86 * paint[i]! + metal * .033) * grain;
  orm[1] = Math.max(.24, Math.min(.81, .75 - .27 * metal - (fixed ? .19 * bright : 0) + .32 * (orm[1]! - .40)));
  orm[2] = .08 + .79 * metal;
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
  const crest = ridge(lane - phase / Math.PI);
  const wake = crest * crest * crest;
  const tip = Math.max(0, 8 * crest - 7);
  const fine = sat(1 - 24 * footprint);
  const cut = Math.max(0, 6 * ridge(5.5 * t + .44 * ridge(4 * s)) - 5) * fine;
  const edge = rim * rim, e = 1 / Math.max(.001, exposure);
  light[0]! += (.010 + .18 * tip + .075 * cut * wake + .037 * edge) * e;
  light[1]! += (.074 + .26 * wake + .48 * tip + .33 * cut * (.20 + wake)) * e;
  light[2]! += (.103 + .46 * wake + .22 * tip + .40 * cut * (.20 + wake) + .12 * edge) * e;
}

export const TEK_INLAY_GLSL = `bool tekCasting(inout vec3 base, inout vec3 orm, vec3 paint, float height, bool fixedFace) {
  float bright = clamp((paint.g - 0.035) * 3.2, 0.0, 1.0);
  float metal = fixedFace ? clamp((max(paint.r, paint.g) - 0.017) * 13.0, 0.0, 1.0) : 0.84;
  base = (mix(base, paint, 0.86) + metal * 0.033) * (0.91 + 0.18 * height);
  orm.yz = vec2(clamp(0.75 - 0.27 * metal - (fixedFace ? 0.19 * bright : 0.0) + 0.32 * (orm.y - 0.4), 0.24, 0.81), 0.08 + 0.79 * metal);
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
  float crest = tekRidge(lane - fMade[${(TEK_FIELD - 1) * 2}].z * 0.318309886);
  float wake = crest * crest * crest, tip = max(0.0, 8.0 * crest - 7.0);
  float cut = max(0.0, 6.0 * tekRidge(5.5 * st.y + 0.44 * tekRidge(4.0 * st.x)) - 5.0) * clamp(1.0 - 24.0 * footprint, 0.0, 1.0);
  vec3 glow = vec3(0.010, 0.074, 0.103) + vec3(0.0, 0.26, 0.46) * wake + vec3(0.18, 0.48, 0.22) * tip;
  glow += vec3(0.075 * wake, 0.33 * (0.20 + wake), 0.40 * (0.20 + wake)) * cut + vec3(0.037, 0.0, 0.12) * rim * rim;
  return glow / max(0.001, fSunColor.w);
}`;
