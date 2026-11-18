// The look of a lit frame by the time of day, on a tier that finishes its frame in one pass (client/core/render/post.ts),
// which the software rasterizer applies too. Keys run from the sun lowest to highest; between two keys each number is
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

export const GRADE: readonly GradeKey[] = [
  // Night: cool, the dark lifted so a doorway and a creature read, colour held back.
  { sun: -18, gain: [0.9, 0.97, 1.15], saturation: 0.82, gamma: 0.86 },
  // Dusk and dawn, the sun just down: blue, a little lifted.
  { sun: -5, gain: [0.95, 0.98, 1.08], saturation: 0.92, gamma: 0.94 },
  // The sun on the horizon and the hour before sunset: warm, the shadows deep and long.
  { sun: 3, gain: [1.1, 1, 0.86], saturation: 1.08, gamma: 1.06 },
  { sun: 14, gain: [1.07, 1, 0.9], saturation: 1.07, gamma: 1.06 },
  // Afternoon to noon: clean and bright, the light near white.
  { sun: 35, gain: [1.02, 1, 0.97], saturation: 1.04, gamma: 1.02 },
  { sun: 67, gain: [1, 1, 0.99], saturation: 1.04, gamma: 1 },
];
