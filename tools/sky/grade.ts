// The grade: a few numbers per mood key, by the sun's height, that turn the physical sky into the painted one. Between
// keys they are blended by height; past the first and last they hold. Its shape is near the one the art director's
// own measure of the keys stands in for it with (a tint, a saturation, a lift toward the horizon and a glow by
// nearness to the light), so a key that measure says can be fitted can be.

export interface Grade {
  name: string;
  /** The sun's height it is set at, degrees. */
  height: number;
  /** Multiplies the light haze scatters once from the sun or moon, the bloom round them: 1 leaves it. */
  haze: number;
  /** Multiplies the dome's colour. */
  tint: readonly [number, number, number];
  /** About each colour's luminance, after the tint: 1 leaves it, more is more saturated. */
  saturation: number;
  /**
   * Light toward the horizon, by (1 - sin elevation) squared, as a power of e: 0 leaves it. `horizon` is on the sun's
   * side and `farHorizon` on the other, blended between by the angle from the sun.
   */
  horizon: number;
  farHorizon: number;
  /** Light toward the zenith, by sin elevation cubed, as a power of e: 0 leaves it. */
  zenith: number;
  /** Light toward the sun, and toward the moon, by exp(-angle / 30 degrees), as a power of e: 0 leaves it. */
  glow: number;
  moonGlow: number;
  /** Light close round the sun, by exp(-angle / 10 degrees), as a power of e: the size of its bloom. 0 leaves it. */
  halo: number;
  /** Multiplies the sun's light on surfaces, or the moon's at night. */
  sun: readonly [number, number, number];
  /** Multiplies the sky's light on surfaces. */
  sky: number;
  /** How strong the afterglow the sun's slot carries through twilight is, as a share of the sky's light above: 0 to 1. */
  afterglow: number;
}

/**
 * The keys of the plan's A2, by height, fitted by tools/sky/fit.ts to the accepted keys (assets/source/core/sky/keys,
 * round five) and looked at beside them. Dawn (2 degrees) and sunset (0) share heights with the evening and morning,
 * as the table does. Noon's light is the anchors' and stays white.
 */
export const GRADES: readonly Grade[] = [
  { name: "night", height: -66.73, haze: 0.427, tint: [1.023, 2.345, 4], saturation: 0.811, horizon: -0.346, farHorizon: -0.308, zenith: -0.653, glow: 0, moonGlow: -0.478, halo: 0.091, sun: [0.619, 0.59, 0.983], sky: 0.869, afterglow: 0.554 },
  { name: "dusk", height: -8, haze: 0.37, tint: [1.777, 2.193, 1.415], saturation: 1.852, horizon: -1.099, farHorizon: -0.257, zenith: -0.062, glow: -0.916, moonGlow: 0, halo: 0, sun: [0.926, 0.952, 0.94], sky: 0.575, afterglow: 0.98 },
  { name: "sunset", height: 0, haze: 0.845, tint: [0.887, 0.919, 1.356], saturation: 0.909, horizon: -0.009, farHorizon: 0.107, zenith: 0.008, glow: -0.916, moonGlow: 0, halo: 0, sun: [1.571, 1.25, 1.549], sky: 0.506, afterglow: 1 },
  { name: "dawn", height: 2, haze: 0.635, tint: [2.163, 2.485, 3.237], saturation: 0.684, horizon: 0.192, farHorizon: -0.656, zenith: 0.331, glow: -0.49, moonGlow: 0, halo: 0, sun: [1.263, 2.344, 0.834], sky: 0.5, afterglow: 0 },
  { name: "golden", height: 8, haze: 1.198, tint: [2.274, 1.647, 1.378], saturation: 1.451, horizon: -0.806, farHorizon: -1.067, zenith: 0.119, glow: -0.916, moonGlow: 0, halo: 0, sun: [1.033, 1.116, 0.836], sky: 0.593, afterglow: 0.42 },
  { name: "morning", height: 15, haze: 0.124, tint: [1.145, 1.092, 1.074], saturation: 1.628, horizon: -0.265, farHorizon: -0.521, zenith: 0.916, glow: -0.568, moonGlow: 0, halo: 0, sun: [0.793, 1.166, 1.125], sky: 0.5, afterglow: 1 },
  { name: "afternoon", height: 35, haze: 0.185, tint: [2.033, 1.66, 1.35], saturation: 1.258, horizon: -0.121, farHorizon: -0.454, zenith: 0.916, glow: -0.469, moonGlow: 0, halo: 0, sun: [0.854, 0.933, 1.608], sky: 1.22, afterglow: 0.217 },
  { name: "noon", height: 66.73, haze: 0.1, tint: [1.583, 1.248, 1.013], saturation: 2, horizon: 0.916, farHorizon: 0.217, zenith: 0.435, glow: 0.061, moonGlow: 0, halo: 0, sun: [1, 1, 1], sky: 1, afterglow: 0.5 },
];

/** The grade at a sun height. */
export function gradeAt(height: number, grades: readonly Grade[] = GRADES): Grade {
  if (height <= grades[0]!.height) return grades[0]!;
  for (let i = 1; i < grades.length; i++) {
    const b = grades[i]!;
    if (height > b.height) continue;
    const a = grades[i - 1]!;
    const f = (height - a.height) / (b.height - a.height);
    const mix = (x: number, y: number): number => x + (y - x) * f;
    const mix3 = (x: readonly number[], y: readonly number[]): [number, number, number] => [mix(x[0]!, y[0]!), mix(x[1]!, y[1]!), mix(x[2]!, y[2]!)];
    return { name: `${a.name}-${b.name}`, height, haze: mix(a.haze, b.haze), tint: mix3(a.tint, b.tint), saturation: mix(a.saturation, b.saturation), horizon: mix(a.horizon, b.horizon), farHorizon: mix(a.farHorizon, b.farHorizon), zenith: mix(a.zenith, b.zenith), glow: mix(a.glow, b.glow), moonGlow: mix(a.moonGlow, b.moonGlow), halo: mix(a.halo, b.halo), sun: mix3(a.sun, b.sun), sky: mix(a.sky, b.sky), afterglow: mix(a.afterglow, b.afterglow) };
  }
  return grades[grades.length - 1]!;
}

/** Grades the dome's light `c` in place: seen at `elevation` degrees, `toSun` degrees from the sun (the moon is opposite). */
export function gradeDome(c: Float64Array | number[], g: Grade, elevation: number, toSun: number): void {
  for (let i = 0; i < 3; i++) c[i]! *= g.tint[i]!;
  const y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const low = (1 - Math.sin((Math.max(0, elevation) * Math.PI) / 180)) ** 2;
  const far = (1 - Math.cos((toSun * Math.PI) / 180)) / 2;
  const high = Math.sin((Math.max(0, elevation) * Math.PI) / 180) ** 3;
  const k = Math.exp((g.horizon + (g.farHorizon - g.horizon) * far) * low + g.zenith * high + g.glow * Math.exp(-toSun / 30) + g.halo * Math.exp(-toSun / 10) + g.moonGlow * Math.exp(-(180 - toSun) / 30));
  for (let i = 0; i < 3; i++) c[i] = Math.max(0, y + g.saturation * (c[i]! - y)) * k;
}
