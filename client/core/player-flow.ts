import type { EntrySurvivor } from "./entry-state.ts";

interface PlayableWorld {
  address: string;
  players: number;
  max: number;
  online?: boolean;
  password?: boolean;
}

/** Opens the world hosting the page, or the first open local world with room. */
export function playWorld<W extends PlayableWorld>(worlds: readonly W[], here: string | null, origin: string): W | null {
  const local = worlds.filter((w) => w.online !== false && w.address.startsWith(origin + "/"));
  return (here ? local.find((w) => w.address === here) : null)
    ?? local.find((w) => w.password !== true && (w.max === 0 || w.players < w.max))
    ?? null;
}

export function playSurvivor(rows: readonly EntrySurvivor[], named: string): EntrySurvivor | undefined {
  if (named) return rows.find((r) => r.name === named);
  return rows.reduce<EntrySurvivor | undefined>((chosen, row) =>
    !chosen || (row.lastLogin ?? 0) > (chosen.lastLogin ?? 0) ? row : chosen, undefined);
}

interface SpawnChoice { name: string; x: number; z: number }

/** A remembered choice is reusable by name even if the map reordered its public spawn points. */
export function defaultEntrySpawn(points: readonly SpawnChoice[], last: string | null): number {
  const usable = (p: SpawnChoice): boolean => p.name.trim() !== "" && Number.isFinite(p.x) && Number.isFinite(p.z);
  const recalled = last ? points.findIndex((p) => p.name === last && usable(p)) : -1;
  return recalled >= 0 ? recalled : points.findIndex(usable);
}
