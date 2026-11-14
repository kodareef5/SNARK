// The sky on lit tiers. The sun keeps one path through the day: it rises in the east (-X), passes north of overhead (+Z)
// as high as low poly's sun at noon, and sets in the west (+X). The moon stands opposite it.

/** How far the sun's path leans toward +Z: its noon height is atan(1 / 0.43), low poly's, 66.7 degrees. */
const TILT = Math.atan(0.43);
/** Degrees of the sun's travel the light's direction moves by at a time, so shadows step rarely and evenly. */
export const SUN_STEP = 0.05;

/** Degrees the sun has travelled since it rose, at an hour of 0 to 24, in whole steps: 0 at six, 180 at eighteen. */
export function sunTravel(hour: number): number {
  const deg = (((hour - 6) * 15) % 360 + 360) % 360;
  return (Math.round(deg / SUN_STEP) * SUN_STEP) % 360;
}

/** A unit vector toward the sun at an hour. */
export function sunDirection(hour: number, out: Float32Array | Float64Array | number[]): void {
  const t = (sunTravel(hour) * Math.PI) / 180;
  out[0] = -Math.cos(t);
  out[1] = Math.sin(t) * Math.cos(TILT);
  out[2] = Math.sin(t) * Math.sin(TILT);
}

/** The sun's height above the horizon in degrees at an hour. */
export function sunHeight(hour: number): number {
  return (Math.asin(Math.sin((sunTravel(hour) * Math.PI) / 180) * Math.cos(TILT)) * 180) / Math.PI;
}

/** The hour at which the sun stands `height` degrees up, before noon or after it, on the nearest step. */
export function hourOfSun(height: number, evening: boolean): number {
  const t = (Math.asin(Math.sin((height * Math.PI) / 180) / Math.cos(TILT)) * 180) / Math.PI;
  const travel = Math.round((evening ? 180 - t : t) / SUN_STEP) * SUN_STEP;
  return 6 + travel / 15;
}
