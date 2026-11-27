// The capsule mesh carries its lit strips and jet plumes.

/** The rows of the capsule's light strip (the material DROP_LIGHT draws): the lantern's glass, the mast lamp, a seam. */
export const LIGHT_LANTERN = 0;
export const LIGHT_LAMP = 1;
export const LIGHT_SEAM = 2;
/** The jet nozzle's row in the packed glow material. */
export const GLOW_JET = 4;
/** Seconds between a mast lamp's groups of flashes, and between the flashes of a group. */
export const LAMP_PERIOD = 8;
export const LAMP_BEAT = 0.5;
/** A capsule draw carries its tier count, ring and seed in one word. */
export function packEffect(count: number, ringed: boolean, look: number): number {
  return Math.max(0, Math.min(15, count)) + (ringed ? 16 : 0) + 32 * (look & 255);
}

const fract = (v: number): number => v - Math.floor(v);
const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A tier's colour as light: 0xRRGGBB to linear red, green and blue, in `out`. */
export function dropTint(rgb: number, out: Float32Array | number[]): void {
  out[0] = Math.pow(Math.floor(rgb / 65536) / 255, 2.2);
  out[1] = Math.pow((Math.floor(rgb / 256) % 256) / 255, 2.2);
  out[2] = Math.pow((rgb % 256) / 255, 2.2);
}

/**
 * How bright the mast lamp is at `seconds`: `count` flashes half a second apart, then dark to the eighth second. It is
 * never wholly out, so the capsule is found at night between groups.
 */
export function lampBeat(seconds: number, count: number): number {
  const t = seconds - LAMP_PERIOD * Math.floor(seconds / LAMP_PERIOD);
  const k = Math.floor(t / LAMP_BEAT);
  const within = fract(t / LAMP_BEAT);
  return k < count ? 0.12 + 0.88 * smooth(0, 0.08, within) * (1 - smooth(0.3, 0.55, within)) : 0.12;
}

/**
 * The light of a point of the capsule's lit strip, into `out`: `row` is which strip (LIGHT_), `across` where the point
 * is across it from -1 to 1, and `e` the draw's effect.
 */
export function dropLight(out: Float32Array | number[], row: number, across: number, ex: number, ey: number, ez: number, ew: number): void {
  dropTint(ey, out);
  const count = ew % 16;
  // Hotter along the strip's middle, as a tube of glass is.
  const core = 1 - across * across;
  let lit = row === LIGHT_LAMP ? lampBeat(ex, count) : row === LIGHT_SEAM ? 0.25 : 0.2 + 0.8 * ez;
  lit *= 0.55 + 0.45 * core;
  const white = 1.4 * lit * lit * core * core;
  for (let c = 0; c < 3; c++) out[c] = out[c]! * (0.35 + 4.2 * lit) + white;
}

/** The nozzle emits a plume that fades along its length and across its edge. */
export function dropGlow(out: Float32Array | number[], row: number, u: number, facing: number, ex: number, ey: number, ez: number, ew: number): number {
  if (row !== GLOW_JET) return 0;
  dropTint(ey, out);
  const fuel = clamp(1 - u);
  const body = facing * facing;
  const look = Math.floor(ew / 32) % 256;
  const bands = 0.5 + 0.5 * Math.cos(38 * u - 21 * ex + look);
  const heart = fuel * fuel * smooth(0.55, 1, facing) * (0.6 + 0.4 * bands);
  for (let c = 0; c < 3; c++) out[c] = out[c]! * (0.4 + 2.6 * fuel * body) + 5 * heart * heart;
  return ez * fuel * fuel * (3 - 2 * fuel) * Math.min(0.96, 1.4 * body) * (0.8 + 0.2 * bands);
}

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** A tier's colour as light, in GLSL: for the sky's text too (supply-sky.ts). */
export const DROP_TINT_GLSL = `
vec3 dropTint(float rgb) {
  return pow(vec3(floor(rgb/65536.0), mod(floor(rgb/256.0),256.0), mod(rgb,256.0))/255.0, vec3(2.2));
}`;

/** The same in GLSL, for a fragment text that declares `uniform vec4 uEffect`. */
export const DROP_GLSL = `${DROP_TINT_GLSL}
float lampBeat(float seconds, float count) {
  float t = mod(seconds, ${f(LAMP_PERIOD)});
  float k = floor(t/${f(LAMP_BEAT)}), within = fract(t/${f(LAMP_BEAT)});
  return k < count ? 0.12 + 0.88*smoothstep(0.0,0.08,within)*(1.0-smoothstep(0.3,0.55,within)) : 0.12;
}
vec3 dropLight(float row, float across, vec4 e) {
  vec3 tint = dropTint(e.y);
  float core = 1.0 - across*across;
  float lit = row == ${f(LIGHT_LAMP)} ? lampBeat(e.x, mod(e.w,16.0)) : row == ${f(LIGHT_SEAM)} ? 0.25 : 0.2 + 0.8*e.z;
  lit *= 0.55 + 0.45*core;
  return tint*(0.35 + 4.2*lit) + 1.4*lit*lit*core*core;
}
vec4 dropGlow(float row, float u, float facing, vec4 e) {
  vec3 tint = dropTint(e.y);
  if (row != ${f(GLOW_JET)}) return vec4(0.0);
  float fuel = clamp(1.0-u,0.0,1.0);
  float body = facing*facing;
  float look = mod(floor(e.w/32.0),256.0);
  float bands = 0.5 + 0.5*cos(38.0*u - 21.0*e.x + look);
  float heart = fuel*fuel*smoothstep(0.55,1.0,facing)*(0.6 + 0.4*bands);
  return vec4(tint*(0.4 + 2.6*fuel*body) + 5.0*heart*heart, e.z*fuel*fuel*(3.0-2.0*fuel)*min(0.96,1.4*body)*(0.8 + 0.2*bands));
}`;
