// What the water meets at its edge, and how the edge looks for it. The beach is sand, and keeps the wash and the wide
// foam it has (swash.ts, water.ts). Elsewhere the four samples of ground round a point of the water say what is there.
// Over the water a sample is the bank: a soft one of grass, earth or mud, or a built one of stone, paving or asphalt; and
// a bank steeper than STEEP is a wall whatever it is made of. Under the water a sample is the bed: grass under it is a
// marsh's still pool, and mud makes it murky. Water at a bank laps in a thin line LAP metres wide and keeps little of the
// beach's wash; near a soft bank or over a still or muddy bed it is murkier, and at the foot of a wall it is shaded.
// Still water has no surf, only a faint line at its edge, and turns from see-through to a mirror over STILL_SHORE of
// depth, not the sea's 30 cm. On land, the ground just over the sea and the bed under it are wet: darker and glossier,
// over a band WET_BAND high that reaches WET_REACH metres in from the waterline, by the ground's slope. Sand is left as
// the beach has it.
//
// The maths is here twice, as GLSL and as functions on numbers, from the same constants, as water.ts has it.

import { SURFACE_NAMES, surfaceIndex } from "../../../content/surfaces.ts";

/** What a sample of ground is to the water: sand, soft earth, a built finish, grass, or mud. */
export const BANK_SAND = 0, BANK_SOFT = 1, BANK_BUILT = 2, BANK_GRASS = 3, BANK_MUD = 4;
/** By ground tint (shared/pack/palette.ts), its kind, from its finish as the ground's cover reads it. */
export const BANK_OF: readonly number[] = Array.from({ length: 256 }, (_, t) => {
  const name = SURFACE_NAMES[surfaceIndex(t, true)]!;
  return name === "sand" ? BANK_SAND : name === "grass" ? BANK_GRASS : name === "mud" ? BANK_MUD : name === "dirt" || name === "gravel" ? BANK_SOFT : BANK_BUILT;
});
/** The slope (rise over run) over which a bank turns into a wall. */
export const STEEP = [0.55, 1.1] as const;
/** Metres out from the waterline over which a bank's foam line runs, and its strength against the beach's foam. */
export const LAP = 0.5;
export const LAP_MOST = 0.55;
/** The shallowest slope a bank's foam line is measured on, so a flat bank's line is not endless. */
const LAP_FLAT = 0.01;
/** How much of the beach's wash a soft bank keeps; a wall and still water keep none. */
const SOFT_WASH = 0.4;
/** How much of a bank's foam line still water takes away, and the metres of depth over which it turns from see-through to a mirror. */
const STILL_FOAM = 0.75;
export const STILL_SHORE = 0.06;
/** Metres from the eye over which what the bank does fades out, by the last quarter: past it a bank's line is under a pixel. */
export const BANK_FAR = 400;

/** The share of what the bank does at `dist` metres from the eye. */
export function bankNear(dist: number): number {
  return 1 - smooth(BANK_FAR * 0.75, BANK_FAR, dist);
}
/** The colour murky water scatters, lit as the water's own colour is, and how much faster it hides the bed. */
export const MURK = [0.06, 0.08, 0.05] as const;
export const MURK_CLEAR = 4;
/** How much of the sky's mirror a wall's foot takes away, and the metres out from it the shade reaches. */
export const WALL_SHADE = 0.35;
const WALL_REACH = 1.2;
/** Metres over the sea that the ground is wet up to, and metres in from the waterline that it reaches, by its slope. */
export const WET_BAND = 0.3;
export const WET_REACH = 1.6;
/** What wet ground's light is multiplied by, and its roughness; under the water all of it. */
export const WET_DARK = 0.62;
export const WET_ROUGH = 0.55;

const smooth = (lo: number, hi: number, v: number): number => {
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

/**
 * The ground round a point of the water: shares of soft bank, of built or steep bank, of a still bed and of a muddy one;
 * and the slope of its cell, from its corners' lowest to their highest across the cell's diagonal, the same over the
 * whole cell, so what is measured by it does not jump at the edges of the ground's triangles.
 */
export interface Bank {
  soft: number;
  built: number;
  still: number;
  muddy: number;
  grade: number;
}

/**
 * The ground round a point of the water `fx`, `fz` across a cell `cell` metres a side, from its four corners (0, 0),
 * (1, 0), (0, 1) and (1, 1): their heights and tints, in the heights' units of `step` metres, and the surface's height
 * `level` in them. Each corner counts by its weight at the point. Times `fine`, the share of the depth that is the window's.
 */
export function shoreBank(heights: ArrayLike<number>, tints: ArrayLike<number>, fx: number, fz: number, level: number, cell: number, step: number, fine: number, out: Bank): Bank {
  let soft = 0, built = 0, sand = 0, still = 0, muddy = 0;
  const grade = ((Math.max(heights[0]!, heights[1]!, heights[2]!, heights[3]!) - Math.min(heights[0]!, heights[1]!, heights[2]!, heights[3]!)) * step) / (cell * Math.SQRT2);
  for (let k = 0; k < 4; k++) {
    const w = (k & 1 ? fx : 1 - fx) * (k & 2 ? fz : 1 - fz);
    const kind = BANK_OF[tints[k]!]!;
    if (heights[k]! > level) {
      if (kind === BANK_BUILT) built += w;
      else if (kind === BANK_SAND) sand += w;
      else soft += w;
    } else if (kind === BANK_GRASS) still += w;
    else if (kind === BANK_MUD) muddy += w;
  }
  const steep = smooth(STEEP[0], STEEP[1], grade);
  out.soft = soft * (1 - steep) * fine;
  out.built = (built + (soft + sand) * steep) * fine;
  out.still = still * fine;
  out.muddy = muddy * fine;
  out.grade = grade;
  return out;
}

/** How much of the beach's wash the water keeps at a bank. */
export function bankWash(b: Bank): number {
  return Math.max(0, 1 - b.soft * (1 - SOFT_WASH) - b.built - b.still - b.muddy * (1 - SOFT_WASH));
}

/**
 * What the depth handed to the foam (water.ts seaFoam) is multiplied by, where the beach's foam lies over `foam` metres
 * of depth: away from sand it lies over LAP metres out from the waterline instead, however steep the bank.
 */
export function bankFoamScale(b: Bank, foam: number): number {
  return 1 + (foam / LAP / Math.max(b.grade, LAP_FLAT) - 1) * Math.min(1, b.soft + b.built + b.still + b.muddy);
}

/** What the foam is multiplied by: a bank's line is fainter than the beach's, and still water's fainter again. */
export function bankFoamGain(b: Bank): number {
  return (1 - (1 - LAP_MOST) * Math.min(1, b.soft + b.built + b.muddy)) * (1 - STILL_FOAM * Math.min(1, b.still));
}

/** The metres of depth over which the water turns from see-through to its own colour and mirror, the sea's being `shore`. */
export function bankFade(b: Bank, shore: number): number {
  return shore + (STILL_SHORE - shore) * Math.min(1, b.still);
}

/** How murky the water is: near a soft bank and over a still or muddy bed, and a little at a wall. */
export function bankMurk(b: Bank): number {
  return Math.min(1, b.soft + b.still + b.muddy + 0.5 * b.built);
}

/** The share of the mirror a wall's foot takes away, `depth` metres deep. */
export function bankShade(b: Bank, depth: number): number {
  return WALL_SHADE * Math.min(1, b.built) * (1 - smooth(0, WALL_REACH, depth / Math.max(b.grade, LAP_FLAT)));
}

/**
 * How wet the ground is at a point `above` metres over the sea where its slope is `grade`, of finish `finish`
 * (content/surfaces.ts SURFACE_NAMES): all of it under the water, and over it within WET_BAND of the sea and WET_REACH
 * of the waterline. Sand is the beach's, and is none.
 */
export function shoreWet(above: number, grade: number, finish: number): number {
  if (SURFACE_NAMES[finish] === "sand") return 0;
  if (above <= 0) return 1;
  return (1 - smooth(0, WET_BAND, above)) * (1 - smooth(WET_REACH * 0.5, WET_REACH, above / Math.max(grade, 1e-3)));
}

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The GLSL of shoreBank and its effects, for the WATER program, which reads the window's tints on uWindowTint; `foam`
 * as for bankFoamScale. A bank is a vec4 of soft, built, still and muddy.
 */
export const bankGlsl = (foam: number): string => `uniform highp usampler2D uWindowTint;
const int BANK_OF[256] = int[256](${BANK_OF.join(",")});
// The twin of shoreBank at the point 'rel' from the camera, the slope of its cell into 'grade'.
vec4 shoreBank(vec3 rel, float fine, out float grade) {
  vec2 last = vec2(textureSize(uWindowHeight, 0) - 1);
  vec2 c = clamp(fGround.xy + rel.xz * fSea.z, vec2(0.0), last);
  ivec2 k = ivec2(min(floor(c), last - 1.0));
  vec2 at = c - vec2(k);
  float level = fSea.x + (fHaze.z + rel.y) / fSea.y;
  float soft = 0.0, built = 0.0, sand = 0.0, still = 0.0, muddy = 0.0, low = 65535.0, high = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 o = ivec2(i & 1, i >> 1);
    float w = (o.x == 1 ? at.x : 1.0 - at.x) * (o.y == 1 ? at.y : 1.0 - at.y);
    ivec2 t = (k + o + ivec2(fWindow.xy)) % textureSize(uWindowHeight, 0);
    int kind = BANK_OF[texelFetch(uWindowTint, t, 0).r];
    float h = float(texelFetch(uWindowHeight, t, 0).r);
    low = min(low, h);
    high = max(high, h);
    if (h > level) {
      if (kind == ${BANK_BUILT}) built += w;
      else if (kind == ${BANK_SAND}) sand += w;
      else soft += w;
    } else if (kind == ${BANK_GRASS}) still += w;
    else if (kind == ${BANK_MUD}) muddy += w;
  }
  grade = (high - low) * fSea.y * fSea.z * ${f(Math.SQRT1_2)};
  float steep = smoothstep(${f(STEEP[0])}, ${f(STEEP[1])}, grade);
  return vec4(soft * (1.0 - steep), built + (soft + sand) * steep, still, muddy) * fine;
}
float bankWash(vec4 b) { return max(0.0, 1.0 - b.x * ${f(1 - SOFT_WASH)} - b.y - b.z - b.w * ${f(1 - SOFT_WASH)}); }
float bankFoamScale(vec4 b, float grade) { return 1.0 + (${f(foam / LAP)} / max(grade, ${f(LAP_FLAT)}) - 1.0) * min(1.0, b.x + b.y + b.z + b.w); }
float bankFoamGain(vec4 b) { return (1.0 - ${f(1 - LAP_MOST)} * min(1.0, b.x + b.y + b.w)) * (1.0 - ${f(STILL_FOAM)} * min(1.0, b.z)); }
float bankFade(vec4 b, float shore) { return mix(shore, ${f(STILL_SHORE)}, min(1.0, b.z)); }
float bankMurk(vec4 b) { return min(1.0, b.x + b.z + b.w + 0.5 * b.y); }
float bankShade(vec4 b, float depth, float grade) { return ${f(WALL_SHADE)} * min(1.0, b.y) * (1.0 - smoothstep(0.0, ${f(WALL_REACH)}, depth / max(grade, ${f(LAP_FLAT)}))); }
`;

/** The GLSL of shoreWet, for the lit ground, which has the frame block; it is on where fShore.x says the frame has a sea over the camera's feet. */
export const WET_GLSL = `float shoreWet(float above, vec3 face, int finish) {
  if (fShore.x < 0.5 || finish == ${SURFACE_NAMES.indexOf("sand")}) return 0.0;
  if (above <= 0.0) return 1.0;
  float grade = length(face.xz) / max(abs(face.y), 0.001);
  return (1.0 - smoothstep(0.0, ${f(WET_BAND)}, above)) * (1.0 - smoothstep(${f(WET_REACH * 0.5)}, ${f(WET_REACH)}, above / max(grade, 0.001)));
}
`;
