// The look of a lit frame by the time of day, which every lit tier's shaders, a light target's finishing pass
// (client/core/render/post.ts) and the software rasterizer apply alike. Keys run from the sun lowest to highest; between two keys each number is
// blended by the sun's height, morning and evening alike.

export interface GradeKey {
  /** The sun's height, degrees, at which this key is the grade. */
  readonly sun: number;
  /** What light is multiplied by before the tone curve: its warmth and brightness, red, green and blue. */
  readonly gain: readonly [number, number, number];
  /** How far a colour keeps from its grey after the curve: 1 as it is, 0 grey. */
  readonly saturation: number;
  /** The power the toned light is raised to, which leaves black and white where they are: under 1 lifts the dark. */
  readonly gamma: number;
}

// Fitted to an art director's paint-overs of the high tier's Miami at noon, an hour before sunset and at night, each
// eased: noon brighter by most of a stop with its darks kept deep, the hour before sunset darker, more coloured and
// toward gold, night less blue, less coloured and lifted.
export const GRADE: readonly GradeKey[] = [
  // Night: the dark lifted so a doorway and a creature read, colour held back, the moon's blue eased.
  { sun: -18, gain: [0.8, 0.98, 1.02], saturation: 0.8, gamma: 0.84 },
  // Dusk and dawn, the sun just down.
  { sun: -5, gain: [0.8, 0.92, 0.98], saturation: 0.9, gamma: 0.92 },
  // The sun on the horizon and the hour before sunset: gold, more coloured, the darks deep and long.
  { sun: 3, gain: [0.82, 0.86, 0.86], saturation: 1.12, gamma: 1.1 },
  { sun: 14, gain: [0.78, 0.86, 0.9], saturation: 1.15, gamma: 1.12 },
  // Afternoon to noon: clean and bright, near neutral, a little warm.
  { sun: 35, gain: [1.45, 1.42, 1.36], saturation: 1.08, gamma: 1.1 },
  { sun: 67, gain: [1.82, 1.8, 1.74], saturation: 1.06, gamma: 1.12 },
];
