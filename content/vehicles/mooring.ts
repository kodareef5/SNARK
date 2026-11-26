const HULL_PREFIX = "core:zzzzhull_";

/** The static kind of a vessel in its mooring paint. */
export const mooredKind = (vessel: string, paint: number): string => `${vessel.replace("core:", HULL_PREFIX)}_${paint}`;
export const burningKind = (vessel: string): string => `${vessel.replace("core:", HULL_PREFIX)}_burning`;
export const isMoored = (kind: string): boolean => kind.startsWith(HULL_PREFIX);
export const mooredVessel = (kind: string): string => kind.slice(0, kind.lastIndexOf("_")).replace(HULL_PREFIX, "core:");
