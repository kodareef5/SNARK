// The grade: a few numbers per mood key, by the sun's height, that turn the physical sky into the painted one. Between
// keys they are blended by height; past the first and last they hold. A key whose numbers are all 1 (glow 0) leaves
// the sky as physics has it.

export interface Grade {
  name: string;
  /** The sun's height it is set at, degrees. */
  height: number;
  /** Multiplies the dome's colour. */
  tint: readonly [number, number, number];
  /** About each colour's luminance: 1 leaves it, more is more saturated. */
  saturation: number;
  /** Multiplies the dome's light at the horizon, fading to nothing at the zenith. */
  horizon: number;
  /** Light added toward the sun, as a share of the dome's there. */
  glow: number;
  /** Multiplies the whole dome. */
  gain: number;
  /** Multiplies the sun's light on surfaces, or the moon's at night. */
  sun: readonly [number, number, number];
  /** Multiplies the sky's light on surfaces. */
  sky: number;
}

const PHYSICAL = { tint: [1, 1, 1], saturation: 1, horizon: 1, glow: 0, gain: 1, sun: [1, 1, 1], sky: 1 } as const;

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
    return { name: `${a.name}-${b.name}`, height, tint: mix3(a.tint, b.tint), saturation: mix(a.saturation, b.saturation), horizon: mix(a.horizon, b.horizon), glow: mix(a.glow, b.glow), gain: mix(a.gain, b.gain), sun: mix3(a.sun, b.sun), sky: mix(a.sky, b.sky) };
  }
  return grades[grades.length - 1]!;
}

/**
 * Grades the dome's light `c` in place: seen at `elevation` degrees, `toSun` the cosine of its angle from the sun.
 */
export function gradeDome(c: Float64Array | number[], g: Grade, elevation: number, toSun: number): void {
  const w = Math.sqrt(Math.max(0, Math.sin((elevation * Math.PI) / 180)));
  const lobe = ((1 + toSun) / 2) ** 8;
  const k = g.gain * (g.horizon + (1 - g.horizon) * w) * (1 + g.glow * lobe);
  for (let i = 0; i < 3; i++) c[i]! *= k;
  const y = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  for (let i = 0; i < 3; i++) c[i] = Math.max(0, y + g.saturation * (c[i]! - y)) * g.tint[i]!;
}
