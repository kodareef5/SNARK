// The grade: what the table shows of the sky, and the light the sky and the sun give. At each mood key's hour the dome
// is the key's own clear sky (keys.ts), over the whole dome. The morning and the evening each pass through keys of
// their own; between two keys the dome is the two blended by the sun's height, each carried along with the sun near
// it, so a glow moves with the sun rather than staying where its key had it. The physical sky (atmosphere.ts) sets how
// strong the light is; a few numbers per key tint it, fitted by tools/sky/fit.ts to the key's grey cards.

export interface Grade {
  name: string;
  /** The sun's height at the key's hour, degrees, from which its look holds. */
  height: number;
  /** Multiplies the sun's light on surfaces, or the moon's at night. */
  sun: readonly [number, number, number];
  /** Multiplies the sky's light on surfaces. */
  sky: number;
  /** How strong the afterglow the sun's slot carries through twilight is, as a share of the sky's light above: 0 to 1. */
  afterglow: number;
}

/** The sun's height at which twilight ends, degrees. */
export const TWILIGHT = -18;

/**
 * The keys of the plan's A2, by height, their light fitted by tools/sky/fit.ts to the accepted keys' cards
 * (assets/source/core/sky/keys, round five). The night key holds from the end of twilight. Noon's light is the
 * anchors' and stays white.
 */
export const GRADES: readonly Grade[] = [
  { name: "night", height: TWILIGHT, sun: [0.948, 0.96, 0.805], sky: 1.366, afterglow: 0.554 },
  { name: "dusk", height: -7.99, sun: [0.995, 0.991, 1], sky: 1.014, afterglow: 1 },
  { name: "sunset", height: 0, sun: [3, 1.513, 0.999], sky: 0.333, afterglow: 1 },
  { name: "dawn", height: 2.02, sun: [1.185, 1.9, 1.333], sky: 0.333, afterglow: 0 },
  { name: "golden", height: 7.99, sun: [1.386, 1.309, 0.814], sky: 0.677, afterglow: 0.42 },
  { name: "morning", height: 14.99, sun: [1.127, 1.242, 1.265], sky: 0.564, afterglow: 1 },
  { name: "afternoon", height: 35.01, sun: [0.893, 0.945, 1.241], sky: 0.955, afterglow: 0.217 },
  { name: "noon", height: 66.73, sun: [1, 1, 1], sky: 1, afterglow: 0.5 },
];

/**
 * The keys the morning and the evening pass through, by name, in order of height. The low sun's keys are each half's
 * own, dawn's the morning's and golden hour's and sunset's the evening's, and dusk's stands for the twilight before
 * dawn too. The day's keys, and night and noon, are both's, so the two halves meet at the ends of the sun's path.
 */
export const MORNING = ["night", "dusk", "dawn", "morning", "afternoon", "noon"] as const;
export const EVENING = ["night", "dusk", "sunset", "golden", "morning", "afternoon", "noon"] as const;

/** The keys either side of a sun height and how far it lies from the first to the second, 0 to 1. Past the ends, the end twice. */
export function bracket(height: number, grades: readonly Grade[] = GRADES): { a: number; b: number; f: number } {
  if (height <= grades[0]!.height) return { a: 0, b: 0, f: 0 };
  for (let i = 1; i < grades.length; i++) {
    if (height > grades[i]!.height) continue;
    return { a: i - 1, b: i, f: (height - grades[i - 1]!.height) / (grades[i]!.height - grades[i - 1]!.height) };
  }
  return { a: grades.length - 1, b: grades.length - 1, f: 0 };
}

/** The light's grade at a sun height. */
export function gradeAt(height: number, grades: readonly Grade[] = GRADES): Grade {
  const { a, b, f } = bracket(height, grades);
  const x = grades[a]!, y = grades[b]!;
  if (a === b || f === 0) return x;
  const mix = (p: number, q: number): number => p + (q - p) * f;
  return { name: `${x.name}-${y.name}`, height, sun: [mix(x.sun[0], y.sun[0]), mix(x.sun[1], y.sun[1]), mix(x.sun[2], y.sun[2])], sky: mix(x.sky, y.sky), afterglow: mix(x.afterglow, y.afterglow) };
}

/** Degrees from the sun over which a key's sky is carried along with it. */
export const CARRY = 25;
const DEG = Math.PI / 180;

/**
 * Where, with the sun at `keyHeight`, to read a key's sky for the view `elevation` up and `around` degrees round from
 * the sun with the sun at `height`: the view turned about the level axis across the sun's path by the sun's change of
 * height, fully next to the sun and less by exp(-angle / CARRY) away from it. A key whose sun is past twilight has
 * no glow round it to carry. Into out[0] (elevation) and out[1] (around), degrees.
 */
export function carried(height: number, keyHeight: number, elevation: number, around: number, out: number[]): void {
  const e = elevation * DEG, a = around * DEG, h = height * DEG;
  const x = Math.cos(e) * Math.cos(a), y = Math.sin(e), z = Math.cos(e) * Math.sin(a);
  const toSun = Math.acos(Math.max(-1, Math.min(1, x * Math.cos(h) + y * Math.sin(h)))) / DEG;
  const w = keyHeight < TWILIGHT ? 0 : Math.exp(-toSun / CARRY);
  const t = w * (keyHeight - height) * DEG;
  const x2 = x * Math.cos(t) - y * Math.sin(t), y2 = x * Math.sin(t) + y * Math.cos(t);
  out[0] = Math.asin(Math.max(-1, Math.min(1, y2))) / DEG;
  out[1] = Math.atan2(Math.abs(z), x2) / DEG;
}
