// How bright a screen's white is by the frame's exposure: the orb's and every screen on a prop's (screens.ts), kept
// apart from the orb's file, which comes after the first frame. Tune these from real frames.

/** White at noon, when exposure is 1: under bloom's threshold, pucks and all, so the picture reads in the sun. */
export const ORB_NOON = 1.15;
/** White on a dark night: at bloom's threshold, so a scene's whites and what it makes brighter than white glow, and its colours are not washed out. */
export const ORB_NIGHT = 2;
/** The stops of exposure over noon's between which the level rises from the one to the other. */
export const ORB_DAY_STOPS = 1.5;
export const ORB_NIGHT_STOPS = 9;
/** White on low poly, which has no exposure and shows it through the tone curve alone. */
export const ORB_FLAT = 1;

/**
 * The screen's white as light after exposure, at a frame's exposure (1 at noon, some tens of thousands on a dark
 * night): ORB_NOON by day, rising with the stops of exposure to ORB_NIGHT. Low poly has no exposure and takes ORB_FLAT.
 */
export function orbLevel(exposure: number): number {
  if (!(exposure > 0)) return ORB_FLAT;
  const t = Math.min(1, Math.max(0, (Math.log2(Math.max(1, exposure)) - ORB_DAY_STOPS) / (ORB_NIGHT_STOPS - ORB_DAY_STOPS)));
  return ORB_NOON + (ORB_NIGHT - ORB_NOON) * t * t * (3 - 2 * t);
}
/** The same as light before exposure, which is what the screen gives out: a real screen turned far down by night. */
export const orbRaw = (exposure: number): number => (exposure > 0 ? orbLevel(exposure) / exposure : ORB_FLAT);
