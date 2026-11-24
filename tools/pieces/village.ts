// One building that uses the forms past the first nine together, each piece posed as the game would place it.

import type { Placed } from "./layout.ts";

/** A view of the village: its name, the point looked at, the radius held, and degrees round and above. */
export type VillageShot = readonly [name: string, centre: readonly [number, number, number], radius: number, around: number, above: number];
export const VILLAGE_SHOTS: readonly VillageShot[] = [];

export function village(_tier: string): Placed[] {
  return [];
}
