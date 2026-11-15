// How loud and how dull a sound is from where it is heard. The browser's panner only says which way: the distance is
// worked out here, so the rule is tested and the same on every browser.

/** A sound is at its full loudness within this share of its range, and at no less than a metre. */
const NEAR = 0.06;
/** Over the last share of its range it fades to nothing. */
const EDGE = 0.25;
/** The low-pass at the range, as a share of the top of hearing: a far sound is duller. */
const FAR_DULL = 0.25;
export const TOP_HZ = 20000;

/** Gain of a sound of `range` metres heard from `d` metres: full near, halving with each doubling of distance, then faded out to the range. */
export function distanceGain(d: number, range: number): number {
  if (!(d < range)) return 0;
  const near = Math.max(1, range * NEAR);
  const g = d <= near ? 1 : near / d;
  const edge = range * (1 - EDGE);
  if (d <= edge) return g;
  const t = (range - d) / (range - edge);
  return g * t * t * (3 - 2 * t);
}

/** The low-pass frequency, in Hz, of a sound of `range` metres heard from `d` metres. */
export function lowpassAt(d: number, range: number): number {
  const share = d <= 0 ? 0 : d >= range ? 1 : d / range;
  return TOP_HZ * FAR_DULL ** share;
}

/**
 * Fills `out` with the ear's facing and up for a view `yaw` radians round (0 looks along +Z, with -X on its right) and
 * `pitch` radians up. Its right is facing cross up, as the browser's listener has it.
 */
export function earAxes(yaw: number, pitch: number, out: number[]): void {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  out[0] = sy * cp;
  out[1] = sp;
  out[2] = cy * cp;
  out[3] = -sy * sp;
  out[4] = cp;
  out[5] = -cy * sp;
}

/** Playback rate that moves a sound by `semitones`. */
export function semitones(n: number): number {
  return 2 ** (n / 12);
}
