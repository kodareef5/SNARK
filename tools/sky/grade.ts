// The grade: a few numbers per mood key, by the sun's height, that turn the physical sky into the painted one. Between
// keys they are blended by height; past the first and last they hold. Its shape is near the one the art director's
// own measure of the keys stands in for it with (a tint, a saturation, a lift toward the horizon and a glow by
// nearness to the light), so a key that measure says can be fitted can be.

export interface Grade {
  name: string;
  /** The sun's height it is set at, degrees. */
  height: number;
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
  /** Light toward the sun, and toward the moon, by exp(-angle / 30 degrees), as a power of e: 0 leaves it. */
  glow: number;
  moonGlow: number;
  /** Multiplies the sun's light on surfaces, or the moon's at night. */
  sun: readonly [number, number, number];
  /** Multiplies the sky's light on surfaces. */
  sky: number;
}

const PHYSICAL = { tint: [1, 1, 1], saturation: 1, horizon: 0, farHorizon: 0, glow: 0, moonGlow: 0, sun: [1, 1, 1], sky: 1 } as const;

/** The keys of the plan's A2, by height. Dawn (2 degrees) and sunset (0) share heights with the evening and morning, as the table does. */
export const GRADES: readonly Grade[] = [
  { name: "night", height: -66.73, ...PHYSICAL },
  { name: "dusk", height: -8, ...PHYSICAL },
  { name: "sunset", height: 0, ...PHYSICAL },
  { name: "dawn", height: 2, ...PHYSICAL },
  { name: "golden", height: 8, ...PHYSICAL },
  { name: "morning", height: 15, ...PHYSICAL },
  { name: "afternoon", height: 35, ...PHYSICAL },
  { name: "noon", height: 66.73, ...PHYSICAL },
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
    return { name: `${a.name}-${b.name}`, height, tint: mix3(a.tint, b.tint), saturation: mix(a.saturation, b.saturation), horizon: mix(a.horizon, b.horizon), farHorizon: mix(a.farHorizon, b.farHorizon), glow: mix(a.glow, b.glow), moonGlow: mix(a.moonGlow, b.moonGlow), sun: mix3(a.sun, b.sun), sky: mix(a.sky, b.sky) };
  }
  return grades[grades.length - 1]!;
}

/** Grades the dome's light `c` in place: seen at `elevation` degrees, `toSun` degrees from the sun (the moon is opposite). */
export function gradeDome(c: Float64Array | number[], g: Grade, elevation: number, toSun: number): void {
  for (let i = 0; i < 3; i++) c[i]! *= g.tint[i]!;
  const y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const low = (1 - Math.sin((Math.max(0, elevation) * Math.PI) / 180)) ** 2;
  const far = (1 - Math.cos((toSun * Math.PI) / 180)) / 2;
  const k = Math.exp((g.horizon + (g.farHorizon - g.horizon) * far) * low + g.glow * Math.exp(-toSun / 30) + g.moonGlow * Math.exp(-(180 - toSun) / 30));
  for (let i = 0; i < 3; i++) c[i] = Math.max(0, y + g.saturation * (c[i]! - y)) * k;
}
