// A wild creature's level and torpor as the server works them out (server/spawner.ts, server/survival.ts), here so that
// the wiki's page applies the same numbers to a server's settings.

/** The value of ARK's later maps. With ARK's default offset it gives wild creatures up to level 150. */
export const MAP_DIFFICULTY = 5;

/** The difficulty: `override` where it is above 0, else the offset through ARK's formula for the map. */
export function difficulty(offset: number, override: number): number {
  return override > 0 ? override : Math.max(0, offset * (MAP_DIFFICULTY - 0.5) + 0.5);
}

/** `step` is 1 to 30. */
export function wildLevel(step: number, difficulty: number): number {
  return Math.max(1, Math.floor(step * difficulty));
}

/** The most torpor of a body with `levels` wild levels, from its torpidity curve's base and gain a level. */
export function torporAt(base: number, gain: number, levels: number): number {
  return base * (1 + gain * levels);
}

/** Torpor lost per second. The species' rate rises with wild levels by ARK's curve. */
export function drainAt(base: number, levels: number): number {
  return levels > 0 && base > 0 ? base + Math.pow(levels, 0.800403041) / (22.39671632 / base) : base;
}
