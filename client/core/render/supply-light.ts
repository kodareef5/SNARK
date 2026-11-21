// A supply drop's own light (planning/workstreams/supply.md): the lit strips of its capsule, and the light that has no
// surface of its own, its shaft, sheath, halos, class figure and jets. Each is a material of the capsule's atlas, a
// strip a row, as an instrument's channel is (tide-eye.ts); what it shows is worked out here from the strip's row,
// where the point is along and across it, and the draw's effect (packet.ts `drawEffect`), with no texture read.
//
// The effect is four numbers a draw: x seconds since the drop landed (negative before, and it runs on while the
// capsule leaves), y its tier's colour as 0xRRGGBB (0 says the draw is no drop's), z its power from 0 to 1 (how far the
// lantern is open for a strip, how strongly the shaft stands, the thrust of a jet), and w the tier's count, whether the
// drop is ringed and eight bits of its seed, packed (`packEffect`). The colour is the drop's own and not a table's, so
// a tier of any colour an admin gives it is drawn with no change here.
//
// A shaft's pulses run down it while its drop is coming. As it lands they fade where they are, and a new set climbs
// from the foot: the seconds since landing say which, with no switch for anything to flip on.
//
// The functions are written twice: GLSL for the surface programs and the signal program, and the same arithmetic in
// TypeScript for the software renderer (tools/snap/raster.ts) and the tests. Nothing in them runs backwards: a pulse
// travels one way for as long as it is seen, and what changes it is a fade.

/** The rows of the capsule's light strip (the material DROP_LIGHT draws): the lantern's glass, the mast lamp, a seam. */
export const LIGHT_LANTERN = 0;
export const LIGHT_LAMP = 1;
export const LIGHT_SEAM = 2;
/** The rows of the light with no surface (the material DROP_GLOW draws). */
export const GLOW_SHAFT = 0;
export const GLOW_SHEATH = 1;
export const GLOW_HALO = 2;
export const GLOW_FIGURE = 3;
export const GLOW_JET = 4;
export const GLOW_FOOT = 5;
/** Metres of a tube to one unit of its strip's length, as an instrument's channel has it. */
export const GLOW_METRES = 32;
/** Seconds between a mast lamp's groups of flashes, and between the flashes of a group. */
export const LAMP_PERIOD = 8;
export const LAMP_BEAT = 0.5;
/** Metres between the pulses of a group on the shaft, between groups at the least, and metres a second they travel. */
export const PULSE_GAP = 9;
export const PULSE_REST = 36;
export const PULSE_SPEED = 22;

/** Seconds the pulses running down take to fade once a drop has landed, and the seconds from which the standing set shows. */
export const INBOUND_FADE = 1.2;
export const STANDING_FROM = 0.3;
export const STANDING_FULL = 1.8;
/** Metres from its head over which a shaft fades into the sky. */
export const SHAFT_TOP = 90;

/** A draw's `w`: the tier's place among the tiers (1 to 15), ringed, and its look. */
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
 * How bright a set of pulses makes the shaft `metres` up it at `seconds`: groups of `count`, PULSE_GAP apart, a rest
 * between groups, running down for the set of a drop that is coming and up for the `standing` one's. 0 between pulses
 * to 1 at the middle of one.
 */
export function shaftPulse(metres: number, seconds: number, count: number, standing: boolean): number {
  const span = count * PULSE_GAP + PULSE_REST;
  const at = metres + (standing ? -1 : 1) * PULSE_SPEED * seconds;
  const along = at - span * Math.floor(at / span);
  const k = Math.floor(along / PULSE_GAP);
  if (k >= count) return 0;
  const within = fract(along / PULSE_GAP);
  return smooth(0, 0.22, within) * (1 - smooth(0.22, 0.6, within));
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

/**
 * The light of a point of the drop's light that has no surface, into `out`, and how much of what is behind it it
 * covers, which is returned: `row` is which (GLOW_), `u` where the point is along its strip (a jet's plume from 0 at the
 * bell to 1 at its end; a tube's length in units of GLOW_METRES), `facing` how squarely its surface faces the eye from 0
 * at its edge to 1, and `e` the draw's effect.
 */
export function dropGlow(out: Float32Array | number[], row: number, u: number, facing: number, ex: number, ey: number, ez: number, ew: number): number {
  const along = row === GLOW_JET || row === GLOW_FOOT ? u : u * GLOW_METRES;
  dropTint(ey, out);
  const count = ew % 16;
  const look = Math.floor(ew / 32);
  if (row === GLOW_FOOT) {
    // The glow on the ground at its foot: strongest under the capsule, gone at its rim. It is a sheet of two sides, each drawn.
    const fall = clamp(1 - along);
    for (let c = 0; c < 3; c++) out[c] = out[c]! * (0.5 + 1.3 * fall);
    return ez * 0.3 * fall * fall;
  }
  // A column of light is thickest through its middle: it falls off to its edge by how its surface faces the eye.
  const body = facing * facing;
  const core = smooth(0.55, 1, facing);
  if (row === GLOW_JET) {
    // A plume: bright at the bell and gone by its end, in bands that travel out, with a white heart.
    const fuel = clamp(1 - along);
    const bands = 0.5 + 0.5 * Math.cos(38 * along - 21 * ex + look);
    const heart = fuel * fuel * core * (0.6 + 0.4 * bands);
    for (let c = 0; c < 3; c++) out[c] = out[c]! * (0.4 + 2.6 * fuel * body) + 5 * heart * heart;
    return ez * fuel * fuel * (3 - 2 * fuel) * Math.min(0.96, 1.4 * body) * (0.8 + 0.2 * bands);
  }
  const tube = row === GLOW_SHAFT || row === GLOW_SHEATH;
  // The set that runs down fades once it has landed, and the standing set climbs from the foot behind its own front.
  const inbound = 1 - smooth(0, INBOUND_FADE, ex);
  const front = clamp((PULSE_SPEED * Math.max(ex, 0) - along) / 8 + 1);
  const pulse = tube ? inbound * shaftPulse(along, ex, count, false) + smooth(STANDING_FROM, STANDING_FULL, ex) * front * shaftPulse(along, ex, count, true) : 0;
  const filament = Math.pow(0.5 + 0.5 * Math.cos(along * 0.9 + 6.2831853 * fract(look * 0.618034) + 2.2 * body), 6);
  // A shaft fades into the sky over its last stretch.
  const strength = (row === GLOW_SHEATH ? 0.35 : row === GLOW_SHAFT ? 1 : 0.7) * (tube ? 1 - smooth(600 - SHAFT_TOP, 600, along) : 1);
  const glow = strength * (0.6 + 2.1 * pulse + 0.12 * filament);
  // The colour is the tier's, which is what the shaft is for: its white heart is narrow, and widens in a pulse.
  const heart = core * core * core * core;
  for (let c = 0; c < 3; c++) out[c] = out[c]! * glow * (0.7 + 2.2 * body) + (row === GLOW_SHEATH ? 0 : heart * (0.25 + 1.3 * pulse));
  return ez * strength * Math.min(0.92, (0.24 + 0.5 * pulse) * (0.25 + 0.75 * body) + 0.32 * core);
}

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** The same in GLSL, for a fragment text that declares `uniform vec4 uEffect`. */
export const DROP_GLSL = `
vec3 dropTint(float rgb) {
  return pow(vec3(floor(rgb/65536.0), mod(floor(rgb/256.0),256.0), mod(rgb,256.0))/255.0, vec3(2.2));
}
float lampBeat(float seconds, float count) {
  float t = mod(seconds, ${f(LAMP_PERIOD)});
  float k = floor(t/${f(LAMP_BEAT)}), within = fract(t/${f(LAMP_BEAT)});
  return k < count ? 0.12 + 0.88*smoothstep(0.0,0.08,within)*(1.0-smoothstep(0.3,0.55,within)) : 0.12;
}
float shaftPulse(float metres, float seconds, float count, bool standing) {
  float span = count*${f(PULSE_GAP)} + ${f(PULSE_REST)};
  float along = mod(metres + (standing ? -1.0 : 1.0)*${f(PULSE_SPEED)}*seconds, span);
  if (floor(along/${f(PULSE_GAP)}) >= count) return 0.0;
  float within = fract(along/${f(PULSE_GAP)});
  return smoothstep(0.0,0.22,within)*(1.0-smoothstep(0.22,0.6,within));
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
  float along = row == ${f(GLOW_JET)} || row == ${f(GLOW_FOOT)} ? u : u*${f(GLOW_METRES)};
  float count = mod(e.w,16.0), look = floor(e.w/32.0);
  if (row == ${f(GLOW_FOOT)}) {
    float fall = clamp(1.0-along,0.0,1.0);
    return vec4(tint*(0.5 + 1.3*fall), e.z*0.3*fall*fall);
  }
  float body = facing*facing, core = smoothstep(0.55,1.0,facing);
  if (row == ${f(GLOW_JET)}) {
    float fuel = clamp(1.0-along,0.0,1.0);
    float bands = 0.5 + 0.5*cos(38.0*along - 21.0*e.x + look);
    float heart = fuel*fuel*core*(0.6 + 0.4*bands);
    return vec4(tint*(0.4 + 2.6*fuel*body) + 5.0*heart*heart, e.z*fuel*fuel*(3.0-2.0*fuel)*min(0.96,1.4*body)*(0.8 + 0.2*bands));
  }
  bool tube = row == ${f(GLOW_SHAFT)} || row == ${f(GLOW_SHEATH)};
  float inbound = 1.0 - smoothstep(0.0,${f(INBOUND_FADE)},e.x);
  float front = clamp((${f(PULSE_SPEED)}*max(e.x,0.0) - along)/8.0 + 1.0,0.0,1.0);
  float pulse = tube ? inbound*shaftPulse(along, e.x, count, false) + smoothstep(${f(STANDING_FROM)},${f(STANDING_FULL)},e.x)*front*shaftPulse(along, e.x, count, true) : 0.0;
  float filament = pow(0.5 + 0.5*cos(along*0.9 + 6.2831853*fract(look*0.618034) + 2.2*body), 6.0);
  float strength = (row == ${f(GLOW_SHEATH)} ? 0.35 : row == ${f(GLOW_SHAFT)} ? 1.0 : 0.7)*(tube ? 1.0 - smoothstep(${f(600 - SHAFT_TOP)},600.0,along) : 1.0);
  float glow = strength*(0.6 + 2.1*pulse + 0.12*filament);
  float heart = core*core*core*core;
  return vec4(tint*glow*(0.7 + 2.2*body) + (row == ${f(GLOW_SHEATH)} ? 0.0 : heart*(0.25 + 1.3*pulse)),
              e.z*strength*min(0.92,(0.24 + 0.5*pulse)*(0.25 + 0.75*body) + 0.32*core));
}`;
